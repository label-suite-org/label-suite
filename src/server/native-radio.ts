import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { audit_events, campaign_leads, campaign_outreach_drafts, campaign_outreach_events, campaign_sources, campaign_public_pages, campaign_public_page_revisions, campaign_stations, campaigns, contacts, org_memberships, radio_stations, tracks } from "../db/schema";
import { db } from "../lib/db";
import { users } from "../db/auth-schema";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { getLeadReadyBlockers } from "./campaign-communicator-core";
import { nativeRadioDraftContentHash, presentCampaignDraftBody } from "./campaign-communicator";

import { isCampaignPublicPageRevisionFresh } from "./campaign-public-page";

const stationFields = {
  id: campaign_stations.id, station_id: radio_stations.id, name: radio_stations.name,
  call_sign: radio_stations.call_sign, city: radio_stations.city, country: radio_stations.country,
  status: campaign_stations.status, priority: campaign_stations.priority, pitch_angle: campaign_stations.pitch_angle,
  feedback: campaign_stations.feedback, revision: sql<string>`${campaign_stations.updated_at}::text`,
};
async function campaign(orgId: string, id: string) {
  const [row] = await db.select({ id: campaigns.id, name: campaigns.campaign_name, status: campaigns.status })
    .from(campaigns).where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, id)));
  if (!row) throw new NotFoundError("Campaign not found");
  return row;
}
export async function listNativeRadioStations(orgId: string, campaignId: string, cursor: string | null, query: string | null) {
  const parent = await campaign(orgId, campaignId);
  const term = query?.trim().slice(0, 120);
  const rows = await db.select(stationFields).from(campaign_stations)
    .innerJoin(radio_stations, and(eq(radio_stations.id, campaign_stations.station_id), eq(radio_stations.org_id, orgId)))
    .where(and(eq(campaign_stations.org_id, orgId), eq(campaign_stations.campaign_id, campaignId),
      cursor ? sql`${campaign_stations.id} > ${cursor}` : undefined,
      term ? sql`position(lower(${term}) in lower(${radio_stations.name})) > 0` : undefined))
    .orderBy(asc(campaign_stations.id)).limit(26);
  const items = rows.slice(0, 25);
  return { campaign: parent, items, next_cursor: rows.length > 25 ? items.at(-1)!.id : null };
}
export async function getNativeRadioStation(orgId: string, campaignId: string, linkId: string) {
  const parent = await campaign(orgId, campaignId);
  const [station] = await db.select(stationFields).from(campaign_stations)
    .innerJoin(radio_stations, and(eq(radio_stations.id, campaign_stations.station_id), eq(radio_stations.org_id, orgId)))
    .where(and(eq(campaign_stations.org_id, orgId), eq(campaign_stations.campaign_id, campaignId), eq(campaign_stations.id, linkId)));
  if (!station) throw new NotFoundError("Campaign station not found");
  const leadRows = await db.select({ id: campaign_leads.id, revision: sql<string>`${campaign_leads.updated_at}::text`, name: campaign_leads.target_name, status: campaign_leads.pipeline_stage,
    contact_id: contacts.id, contact_name: contacts.name, route: campaign_leads.contact_route,
    route_verified_at: campaign_leads.contact_route_verified_at, source: campaign_leads.discovery_source,
    source_title: campaign_sources.title, musical_fit: campaign_leads.musical_fit, pitch_angle: campaign_leads.pitch_angle,
    exact_edit_id: tracks.id, recommending_person: campaign_leads.recommending_person, introduction_available: campaign_leads.introduction_available,
    task_waiver: campaign_leads.readiness_task_waiver_reason,
    has_open_task: sql<boolean>`exists (select 1 from label_suite.ops_tasks t where t.org_id = ${orgId} and t.linked_campaign_id = ${campaignId} and t.linked_campaign_lead_id = ${campaign_leads.id} and coalesce(lower(trim(t.status)), '') not in ('done', 'completed', 'cancelled', 'canceled'))`,
  }).from(campaign_leads)
    .leftJoin(contacts, and(eq(contacts.id, campaign_leads.contact_id), eq(contacts.org_id, orgId)))
    .leftJoin(campaign_sources, and(eq(campaign_sources.id, campaign_leads.source_id), eq(campaign_sources.org_id, orgId), eq(campaign_sources.campaign_id, campaignId)))
    .leftJoin(tracks, and(eq(tracks.id, campaign_leads.exact_edit_track_id), eq(tracks.org_id, orgId)))
    .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.station_id, station.station_id)))
    .orderBy(asc(campaign_leads.id)).limit(26);
  const leads = leadRows.slice(0, 25);
  const leadIds = leads.map(row => row.id);
  const draftRows = await db.select({ id: campaign_outreach_drafts.id, lead_id: campaign_outreach_drafts.lead_id,
    scope: campaign_outreach_drafts.scope, version: campaign_outreach_drafts.version, status: campaign_outreach_drafts.status,
    subject: campaign_outreach_drafts.subject, body: campaign_outreach_drafts.body, body_document: campaign_outreach_drafts.body_document, context_snapshot: campaign_outreach_drafts.context_snapshot,
    revision: sql<string>`${campaign_outreach_drafts.updated_at}::text`,
  }).from(campaign_outreach_drafts).where(and(eq(campaign_outreach_drafts.org_id, orgId), eq(campaign_outreach_drafts.campaign_id, campaignId),
    or(and(isNull(campaign_outreach_drafts.lead_id), eq(campaign_outreach_drafts.scope, "radio_update")), leadIds.length ? inArray(campaign_outreach_drafts.lead_id, leadIds) : undefined)))
    .orderBy(desc(campaign_outreach_drafts.updated_at), desc(campaign_outreach_drafts.id)).limit(26);
  const drafts = draftRows.slice(0, 25).map(row => {
    const body = presentCampaignDraftBody(row, 10_000);
    const recipient = leads.find(lead => lead.id === row.lead_id) ?? null;
    const blockers: string[] = [];
    if (!recipient) blockers.push("Campaign-wide draft: no station recipient is assigned.");
    else {
      if (!recipient.contact_id) blockers.push("No canonical Contact is linked.");
      blockers.push(...getLeadReadyBlockers({ contact_route: recipient.route, contact_route_verified_at: recipient.route_verified_at,
        exact_edit_track_id: recipient.exact_edit_id, campaign_wide_update: row.scope === "radio_update", batch_update_assigned: row.scope === "radio_update",
        musical_fit: recipient.musical_fit, pitch_angle: recipient.pitch_angle, recommending_person: recipient.recommending_person,
        introduction_available: recipient.introduction_available, approved_draft_id: row.status === "approved" ? row.id : null,
        has_open_task: recipient.has_open_task, readiness_task_waiver_reason: recipient.task_waiver,
      }).map(code => code.replaceAll("_", " ") + " requires review."));
    }
    if (body.repair_required) blockers.push("Draft content needs repair in the full editor.");
    if (row.status !== "approved") blockers.push("This content revision is not approved.");
    return { id: row.id, lead_id: row.lead_id, scope: row.scope, version: row.version, status: row.status, subject: row.subject,
      revision: row.revision, content_sha256: nativeRadioDraftContentHash(row),
      body_document: row.body_document && !body.repair_required ? body.document : null,
      body: body.body.slice(0, 10_000), body_truncated: body.body.length > 10_000,
      editable: row.status === "draft" && !body.repair_required && body.body.length <= 10_000,
      page_revision_id: row.scope === "radio_update" && typeof row.context_snapshot.page_revision_id === "string" ? row.context_snapshot.page_revision_id : null, blockers };
  });
  const pageRows = await db.select({ id: campaign_public_page_revisions.id, version: campaign_public_page_revisions.version,
    content_hash: campaign_public_page_revisions.content_hash }).from(campaign_public_page_revisions)
    .innerJoin(campaign_public_pages, and(eq(campaign_public_pages.id, campaign_public_page_revisions.page_id), eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId)))
    .where(and(eq(campaign_public_page_revisions.org_id, orgId), eq(campaign_public_page_revisions.review_status, "reviewed")))
    .orderBy(desc(campaign_public_page_revisions.version)).limit(11);
  const reviewed_pages = await Promise.all(pageRows.slice(0, 10).map(async row => ({ ...row,
    fresh: await isCampaignPublicPageRevisionFresh(orgId, campaignId, row.id) })));
  const [audits, events] = await Promise.all([
    db.select({ id: audit_events.id, event_type: audit_events.event_type, occurred_at: audit_events.created_at, actor_name: users.name, before: audit_events.before, after: audit_events.after })
      .from(audit_events).leftJoin(org_memberships, and(eq(org_memberships.user_id, audit_events.actor_user_id), eq(org_memberships.org_id, orgId))).leftJoin(users, eq(users.id, org_memberships.user_id)).where(and(eq(audit_events.org_id, orgId), eq(audit_events.object_type, "campaign_station"), eq(audit_events.object_id, linkId)))
      .orderBy(desc(audit_events.created_at), desc(audit_events.id)).limit(21),
    db.select({ id: campaign_outreach_events.id, event_type: campaign_outreach_events.event_type, occurred_at: campaign_outreach_events.occurred_at, actor_name: users.name, lead_id: campaign_outreach_events.lead_id, draft_id: campaign_outreach_events.draft_id })
      .from(campaign_outreach_events).leftJoin(org_memberships, and(eq(org_memberships.user_id, campaign_outreach_events.actor_user_id), eq(org_memberships.org_id, orgId))).leftJoin(users, eq(users.id, org_memberships.user_id)).where(and(eq(campaign_outreach_events.org_id, orgId), eq(campaign_outreach_events.campaign_id, campaignId), or(isNull(campaign_outreach_events.lead_id), leadIds.length ? inArray(campaign_outreach_events.lead_id, leadIds) : undefined)))
      .orderBy(desc(campaign_outreach_events.occurred_at), desc(campaign_outreach_events.id)).limit(21),
  ]);
  const activity = [...audits.map(({ before, after, ...row }) => ({ ...row, id: "audit:" + row.id,
      campaign_id: campaignId, station_id: station.station_id, lead_id: null, draft_id: null,
      changes: ["priority", "status", "pitch_angle", "feedback"].filter(key => before?.[key] !== after?.[key]).map(key => {
        const prior = typeof before?.[key] === "string" ? String(before[key]) : "None";
        const next = typeof after?.[key] === "string" ? String(after[key]) : "None";
        return `${key.replaceAll("_", " ")}: ${prior} → ${next}`;
      }) })), ...events.map(row => ({ ...row, id: "outreach:" + row.id,
      campaign_id: campaignId, station_id: row.lead_id ? station.station_id : null, changes: [] as string[] }))]
    .sort((a, b) => (b.occurred_at?.getTime() ?? 0) - (a.occurred_at?.getTime() ?? 0));
  return { campaign: parent, station, leads, drafts, reviewed_pages, has_more_reviewed_pages: pageRows.length > 10, activity: activity.slice(0, 20),
    has_more_leads: leadRows.length > 25, has_more_drafts: draftRows.length > 25, has_more_activity: activity.length > 20,
    notice: "Preparation only. No messages, provider actions, delivery recording or follow-up scheduling are available here." };
}

export const nativeRadioPreparationSchema = z.object({
  expected_revision: z.string().min(1), priority: z.enum(["high", "medium", "low"]),
  pitch_angle: z.string().trim().max(2000).nullable(), feedback: z.string().trim().max(2000).nullable(),
  status: z.enum(["selected", "drafted"]).optional(),
}).strict();
export async function updateNativeRadioPreparation(orgId: string, campaignId: string, linkId: string, actor: string, raw: unknown) {
  const input = nativeRadioPreparationSchema.parse(raw);
  await db.transaction(async tx => {
    const [member] = await tx.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, actor))).for("share");
    if (!member) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    if (!["owner", "operator"].includes(member.role)) throw new HttpError("Insufficient permissions", 403);
    const [parent] = await tx.select({ status: campaigns.status }).from(campaigns)
      .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId))).for("share");
    if (!parent) throw new NotFoundError("Campaign not found");
    if (parent.status === "archived") throw new ConflictError("Archived campaign is read-only");
    const [current] = await tx.select({ ...stationFields }).from(campaign_stations)
      .innerJoin(radio_stations, and(eq(radio_stations.id, campaign_stations.station_id), eq(radio_stations.org_id, orgId)))
      .where(and(eq(campaign_stations.org_id, orgId), eq(campaign_stations.campaign_id, campaignId), eq(campaign_stations.id, linkId)))
      .for("no key update");
    if (!current) throw new NotFoundError("Campaign station not found");
    if (current.revision !== input.expected_revision) throw new ConflictError("Station preparation changed. Refresh before saving.");
    if (input.status && !["pending", "selected", "drafted"].includes(current.status ?? "pending")) throw new ConflictError("Delivery workflow status cannot be changed from native preparation.");
    if (input.status === "drafted") {
      const [draft] = await tx.select({ id: campaign_outreach_drafts.id }).from(campaign_outreach_drafts)
        .innerJoin(campaign_leads, and(eq(campaign_leads.id, campaign_outreach_drafts.lead_id), eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.station_id, current.station_id)))
        .where(and(eq(campaign_outreach_drafts.org_id, orgId), eq(campaign_outreach_drafts.campaign_id, campaignId), inArray(campaign_outreach_drafts.status, ["draft", "approved"]))).limit(1);
      if (!draft) throw new ConflictError("Record a station-specific draft before marking it drafted.");
    }
    const [saved] = await tx.update(campaign_stations).set({ priority: input.priority, pitch_angle: input.pitch_angle, feedback: input.feedback,
      ...(input.status ? { status: input.status } : {}), updated_at: sql`greatest(clock_timestamp(), ${campaign_stations.updated_at} + interval '1 microsecond')` })
      .where(and(eq(campaign_stations.org_id, orgId), eq(campaign_stations.id, linkId))).returning({ revision: sql<string>`${campaign_stations.updated_at}::text` });
    await recordAuditEvent(orgId, { actor_user_id: actor, event_type: "radio.preparation.updated", object_type: "campaign_station", object_id: linkId,
      before: { priority: current.priority, pitch_angle: current.pitch_angle, feedback: current.feedback, status: current.status, revision: current.revision },
      after: { priority: input.priority, pitch_angle: input.pitch_angle, feedback: input.feedback, status: input.status ?? current.status, revision: saved.revision },
      metadata: { campaign_id: campaignId, station_id: current.station_id } }, tx);
  });
  return getNativeRadioStation(orgId, campaignId, linkId);
}
