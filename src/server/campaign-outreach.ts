import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  campaign_dogfood_entries,
  campaign_public_pages,
  campaign_public_page_revisions,
  campaign_enrichment_runs,
  campaign_leads,
  campaign_outreach_drafts,
  campaign_sources,
  campaigns,
  contacts,
  ops_tasks,
  radio_stations,
  tracks,
  media_assets,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { hasOwn } from "./validation";
import {
  buildCampaignLeadDedupeKey,
  campaignPipelineStageSchema,
  createCampaignDogfoodEntrySchema,
  createCampaignLeadSchema,
  scoreCampaignLeadPriority,
  updateCampaignDogfoodEntrySchema,
  updateCampaignLeadSchema,
  type CreateCampaignDogfoodEntryInput,
  type CreateCampaignLeadInput,
  type UpdateCampaignDogfoodEntryInput,
  type UpdateCampaignLeadInput,
} from "./campaign-outreach-core";
import { getCommunicatorContext, presentCampaignDraftBody } from "./campaign-communicator";
import { groupLeadQueue } from "./campaign-communicator-core";
import { getCampaignPublicPageEditor } from "./campaign-public-page";
import { getCampaignActivitySnapshot } from "./campaign-activity";

export {
  CAMPAIGN_PIPELINE_STAGES,
  CAMPAIGN_TARGET_TYPES,
  createCampaignDogfoodEntrySchema,
  createCampaignLeadSchema,
  scoreCampaignLeadPriority,
  updateCampaignDogfoodEntrySchema,
  updateCampaignLeadSchema,
} from "./campaign-outreach-core";

export async function getCampaignOutreachFeatureAvailability(orgId: string) {
  try {
    await db.select({ id: campaign_leads.id }).from(campaign_leads).limit(1);
    await db.select({ id: campaign_sources.id }).from(campaign_sources).limit(1);
    await db.select({ id: campaign_dogfood_entries.id }).from(campaign_dogfood_entries).limit(1);
    await db.select({ id: ops_tasks.linked_campaign_lead_id }).from(ops_tasks).where(eq(ops_tasks.org_id, orgId)).limit(1);
    return true;
  } catch (error) {
    if (isCampaignOutreachSchemaUnavailable(error)) return false;
    throw error;
  }
}

export async function getCampaignOutreachWorkspace(orgId: string, campaignId: string) {
  const campaign = await loadCampaign(orgId, campaignId);

  const [leadRows, sources, dogfood, taskRows, trackRows, artworkOptions, publicPage, communicator, activity] = await Promise.all([
    db
      .select({
        id: campaign_leads.id,
        campaign_id: campaign_leads.campaign_id,
        source_id: campaign_leads.source_id,
        source_title: campaign_sources.title,
        contact_id: campaign_leads.contact_id,
        contact_name: contacts.name,
        station_id: campaign_leads.station_id,
        station_name: radio_stations.name,
        exact_edit_track_id: campaign_leads.exact_edit_track_id,
        exact_edit_title: tracks.title,
        dedupe_key: campaign_leads.dedupe_key,
        target_name: campaign_leads.target_name,
        target_type: campaign_leads.target_type,
        target_url: campaign_leads.target_url,
        contact_route: campaign_leads.contact_route,
        contact_route_verified_at: campaign_leads.contact_route_verified_at,
        discovery_source: campaign_leads.discovery_source,
        recommending_person: campaign_leads.recommending_person,
        introduction_available: campaign_leads.introduction_available,
        musical_fit: campaign_leads.musical_fit,
        relationship_warmth: campaign_leads.relationship_warmth,
        editorial_fit: campaign_leads.editorial_fit,
        useful_reach: campaign_leads.useful_reach,
        direct_free_access: campaign_leads.direct_free_access,
        pipeline_stage: campaign_leads.pipeline_stage,
        pitch_angle: campaign_leads.pitch_angle,
        last_contacted_at: campaign_leads.last_contacted_at,
        follow_up_at: campaign_leads.follow_up_at,
        outcome: campaign_leads.outcome,
        evidence_url: campaign_leads.evidence_url,
        published_at: campaign_leads.published_at,
        notes: campaign_leads.notes,
        readiness_task_waiver_reason: campaign_leads.readiness_task_waiver_reason,
        updated_at: campaign_leads.updated_at,
      })
      .from(campaign_leads)
      .leftJoin(campaign_sources, and(eq(campaign_leads.source_id, campaign_sources.id), eq(campaign_sources.org_id, orgId)))
      .leftJoin(contacts, and(eq(campaign_leads.contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .leftJoin(radio_stations, and(eq(campaign_leads.station_id, radio_stations.id), eq(radio_stations.org_id, orgId)))
      .leftJoin(tracks, and(eq(campaign_leads.exact_edit_track_id, tracks.id), eq(tracks.org_id, orgId)))
      .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId))),
    db
      .select()
      .from(campaign_sources)
      .where(and(eq(campaign_sources.org_id, orgId), eq(campaign_sources.campaign_id, campaignId)))
      .orderBy(asc(campaign_sources.title)),
    db
      .select()
      .from(campaign_dogfood_entries)
      .where(and(eq(campaign_dogfood_entries.org_id, orgId), eq(campaign_dogfood_entries.campaign_id, campaignId)))
      .orderBy(asc(campaign_dogfood_entries.severity), desc(campaign_dogfood_entries.updated_at)),
    db
      .select({
        id: ops_tasks.id,
        linked_campaign_lead_id: ops_tasks.linked_campaign_lead_id,
        task_name: ops_tasks.task_name,
        status: ops_tasks.status,
        priority: ops_tasks.priority,
        due_date: ops_tasks.due_date,
        next_action: ops_tasks.next_action,
      })
      .from(ops_tasks)
      .where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_campaign_id, campaignId)))
      .orderBy(asc(ops_tasks.due_date)),
    campaign.linked_release_id
      ? db
        .select({ id: tracks.id, title: tracks.title, audio_url: tracks.audio_url, position: tracks.position })
        .from(tracks)
        .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, campaign.linked_release_id)))
        .orderBy(asc(tracks.position))
      : Promise.resolve([]),
    campaign.linked_release_id
      ? db
        .select({ id: media_assets.id, asset_name: media_assets.asset_name, version: media_assets.version, file_link: media_assets.file_link, approval_status: media_assets.approval_status })
        .from(media_assets)
        .where(and(eq(media_assets.org_id, orgId), eq(media_assets.linked_release_id, campaign.linked_release_id), eq(media_assets.approval_status, "approved")))
        .orderBy(asc(media_assets.asset_name), asc(media_assets.version))
      : Promise.resolve([]),
    campaign.linked_release_id
      ? getCampaignPublicPageEditor(orgId, campaignId)
      : Promise.resolve({ page: null, draft: null, revisions: [] }),
    getCommunicatorContext(orgId, campaignId),
    getCampaignActivitySnapshot(orgId, campaignId),
  ]);

  const tasksByLead = new Map<string, typeof taskRows>();
  for (const task of taskRows) {
    if (!task.linked_campaign_lead_id) continue;
    const leadTasks = tasksByLead.get(task.linked_campaign_lead_id) ?? [];
    leadTasks.push(task);
    tasksByLead.set(task.linked_campaign_lead_id, leadTasks);
  }

  const leads = leadRows
    .map((lead) => {
      const communicatorLead = communicator.leads[lead.id] ?? {
        suggestions: [],
        draft_versions: [],
        ready_blockers: [],
        activity: [],
      };
      return {
        ...lead,
        pipeline_stage: campaignPipelineStageSchema.parse(lead.pipeline_stage),
        priority_score: scoreCampaignLeadPriority({
          relationship_warmth: lead.relationship_warmth,
          editorial_fit: lead.editorial_fit,
          useful_reach: lead.useful_reach,
          direct_free_access: lead.direct_free_access,
        }),
        tasks: tasksByLead.get(lead.id) ?? [],
        latest_suggestions: latestSuggestions(communicatorLead.suggestions),
        draft_versions: communicatorLead.draft_versions.map(presentDraft),
        ready_blockers: communicatorLead.ready_blockers,
        activity: communicatorLead.activity,
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score || a.target_name.localeCompare(b.target_name));

  const leadsById = new Map(leads.map((lead) => [lead.id, lead]));
  const groupedQueue = groupLeadQueue(leads, new Date());
  const queue = {
    now: groupedQueue.now.flatMap((item) => leadsById.get(item.id) ?? []),
    followUp: groupedQueue.followUp.flatMap((item) => leadsById.get(item.id) ?? []),
    waiting: groupedQueue.waiting.flatMap((item) => leadsById.get(item.id) ?? []),
    completed: groupedQueue.completed.flatMap((item) => leadsById.get(item.id) ?? []),
  };

  return {
    campaign: {
      id: campaign.id,
      name: campaign.campaign_name,
      linked_release_id: campaign.linked_release_id,
    },
    prompt: communicator.prompt,
    activity,
    queue,
    leads,
    sources,
    dogfood,
    tracks: trackRows,
    radioUpdate: {
      page: {
        page: publicPage.page,
        draft: redactRadioRevision(publicPage.draft),
        revisions: publicPage.revisions.flatMap((revision) => {
          const redacted = redactRadioRevision(revision);
          return redacted ? [redacted] : [];
        }),
      },
      artwork_options: artworkOptions.filter((asset) => isHttpsUrl(asset.file_link)),
      tracks: trackRows,
      radio_drafts: (communicator.radio_drafts ?? []).map(presentDraft),
    },
    unlinked_tasks: taskRows.filter((task) => !task.linked_campaign_lead_id),
  };
}

function redactRadioRevision(revision: {
  id: string;
  version: number;
  content: unknown;
  review_status: string;
  content_hash: string | null;
  author_id?: string | null;
  reviewer_id?: string | null;
  authored_at?: Date | null;
  reviewed_at?: Date | null;
  created_at?: Date | null;
  updated_at?: Date | null;
} | null) {
  if (!revision) return null;
  return {
    id: revision.id,
    version: revision.version,
    content: revision.content,
    review_status: revision.review_status,
    content_hash: revision.content_hash,
    authored_at: revision.authored_at ?? null,
    reviewed_at: revision.reviewed_at ?? null,
    created_at: revision.created_at ?? null,
    updated_at: revision.updated_at ?? null,
  };
}

export type CampaignOutreachWorkspaceData = Awaited<ReturnType<typeof getCampaignOutreachWorkspace>>;

function presentDraft<T extends { body?: string; body_document?: unknown; body_html?: string | null; body_document_repair_required?: boolean; body_document_repair_reason?: "malformed" | "over_limit" }>(draft: T): T {
  if (typeof draft.body !== "string") return draft;
  const derived = presentCampaignDraftBody({ body_document: draft.body_document, body: draft.body }, 20_000);
  return { ...draft, body: derived.body, body_document: derived.document, body_html: derived.html, body_document_repair_required: draft.body_document_repair_required || derived.repair_required || undefined, body_document_repair_reason: draft.body_document_repair_reason ?? derived.repair_reason };
}

export async function createCampaignLead(orgId: string, input: CreateCampaignLeadInput) {
  const payload = createCampaignLeadSchema.parse(input);
  await loadCampaign(orgId, payload.campaign_id);
  await assertLeadReferences(orgId, payload);

  const id = payload.id ?? crypto.randomUUID();
  const dedupeKey = payload.dedupe_key ?? buildCampaignLeadDedupeKey(payload);
  const inserted = await db.insert(campaign_leads).values({
    ...leadInsertValues(payload),
    id,
    org_id: orgId,
    dedupe_key: dedupeKey,
  }).onConflictDoNothing().returning({ id: campaign_leads.id });

  if (!inserted.length) throw new ConflictError("This target is already linked to the campaign");
  return { id, ok: true, priority_score: scoreCampaignLeadPriority(payload) };
}

export async function updateCampaignLead(orgId: string, input: UpdateCampaignLeadInput) {
  const payload = updateCampaignLeadSchema.parse(input);
  await assertLeadReferences(orgId, payload);

  return db.transaction(async (tx) => {
    const existing = (await tx.select().from(campaign_leads).where(and(
      eq(campaign_leads.id, payload.id),
      eq(campaign_leads.org_id, orgId),
      eq(campaign_leads.campaign_id, payload.campaign_id),
    )).for("update").limit(1))[0];
    if (!existing) throw new NotFoundError("Campaign lead not found");

    const now = new Date();
    const updates: Record<string, unknown> = { updated_at: now };
    const fields = [
      "source_id", "contact_id", "station_id", "exact_edit_track_id", "target_name", "target_type",
      "target_url", "contact_route", "discovery_source", "recommending_person", "introduction_available",
      "musical_fit", "relationship_warmth", "editorial_fit", "useful_reach", "direct_free_access",
      "pitch_angle", "outcome", "evidence_url", "notes",
    ] as const;
    for (const field of fields) if (hasOwn(payload, field)) updates[field] = payload[field];
    const routeChanged = hasOwn(payload, "contact_route") && payload.contact_route !== existing.contact_route;
    if (routeChanged) {
      updates.contact_route_verified_at = null;
      if (existing.pipeline_stage === "ready") updates.pipeline_stage = "qualified";
      await tx.update(campaign_outreach_drafts).set({ status: "superseded", updated_at: now }).where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, payload.campaign_id),
        eq(campaign_outreach_drafts.lead_id, payload.id),
        ne(campaign_outreach_drafts.status, "superseded"),
      ));
    }
    for (const field of ["last_contacted_at", "follow_up_at", "published_at"] as const) {
      if (hasOwn(payload, field)) updates[field] = parseOptionalTimestamp(payload[field]);
    }

    const dedupeInputsChanged = ["station_id", "contact_id", "target_url", "target_name"].some((field) => hasOwn(payload, field));
    if (dedupeInputsChanged) {
      updates.dedupe_key = buildCampaignLeadDedupeKey({
        station_id: hasOwn(payload, "station_id") ? payload.station_id : existing.station_id,
        contact_id: hasOwn(payload, "contact_id") ? payload.contact_id : existing.contact_id,
        target_url: hasOwn(payload, "target_url") ? payload.target_url : existing.target_url,
        target_name: hasOwn(payload, "target_name") ? payload.target_name! : existing.target_name,
      });
    }

    const updated = await tx.update(campaign_leads).set(updates).where(and(
      eq(campaign_leads.id, payload.id),
      eq(campaign_leads.org_id, orgId),
      eq(campaign_leads.campaign_id, payload.campaign_id),
    )).returning({ id: campaign_leads.id });
    if (!updated.length) throw new ConflictError("Campaign lead changed while updating it");
    return { ok: true };
  });
}

export async function createCampaignDogfoodEntry(orgId: string, input: CreateCampaignDogfoodEntryInput) {
  const payload = createCampaignDogfoodEntrySchema.parse(input);
  await loadCampaign(orgId, payload.campaign_id);
  await assertDogfoodReferences(orgId, payload.campaign_id, payload);
  const id = payload.id ?? crypto.randomUUID();
  await db.insert(campaign_dogfood_entries).values({
    id,
    org_id: orgId,
    campaign_id: payload.campaign_id,
    entry_type: payload.entry_type,
    severity: payload.severity,
    title: payload.title,
    details: payload.details ?? null,
    ui_surface: payload.ui_surface ?? null,
    status: payload.status,
    evidence_url: payload.evidence_url ?? null,
    linked_lead_id: payload.linked_lead_id ?? null,
    linked_draft_id: payload.linked_draft_id ?? null,
    linked_enrichment_run_id: payload.linked_enrichment_run_id ?? null,
    linked_page_revision_id: payload.linked_page_revision_id ?? null,
  });
  return { id, ok: true };
}

export async function updateCampaignDogfoodEntry(orgId: string, input: UpdateCampaignDogfoodEntryInput) {
  const payload = updateCampaignDogfoodEntrySchema.parse(input);
  const existing = await db.select({ id: campaign_dogfood_entries.id }).from(campaign_dogfood_entries).where(and(
    eq(campaign_dogfood_entries.id, payload.id),
    eq(campaign_dogfood_entries.org_id, orgId),
    eq(campaign_dogfood_entries.campaign_id, payload.campaign_id),
  ));
  if (!existing.length) throw new NotFoundError("Dogfood entry not found");
  await assertDogfoodReferences(orgId, payload.campaign_id, payload);

  const updates: Record<string, unknown> = { updated_at: new Date() };
  for (const field of [
    "severity", "title", "details", "ui_surface", "status", "evidence_url",
    "linked_lead_id", "linked_draft_id", "linked_enrichment_run_id", "linked_page_revision_id",
  ] as const) {
    if (hasOwn(payload, field)) updates[field] = payload[field];
  }
  await db.update(campaign_dogfood_entries).set(updates).where(and(
    eq(campaign_dogfood_entries.id, payload.id),
    eq(campaign_dogfood_entries.org_id, orgId),
    eq(campaign_dogfood_entries.campaign_id, payload.campaign_id),
  ));
  return { ok: true };
}

function leadInsertValues(payload: CreateCampaignLeadInput) {
  return {
    campaign_id: payload.campaign_id,
    source_id: payload.source_id ?? null,
    contact_id: payload.contact_id ?? null,
    station_id: payload.station_id ?? null,
    exact_edit_track_id: payload.exact_edit_track_id ?? null,
    target_name: payload.target_name,
    target_type: payload.target_type,
    target_url: payload.target_url ?? null,
    contact_route: payload.contact_route ?? null,
    discovery_source: payload.discovery_source,
    recommending_person: payload.recommending_person ?? null,
    introduction_available: payload.introduction_available ?? null,
    musical_fit: payload.musical_fit ?? null,
    relationship_warmth: payload.relationship_warmth,
    editorial_fit: payload.editorial_fit,
    useful_reach: payload.useful_reach,
    direct_free_access: payload.direct_free_access,
    pipeline_stage: payload.pipeline_stage,
    pitch_angle: payload.pitch_angle ?? null,
    last_contacted_at: parseOptionalTimestamp(payload.last_contacted_at),
    follow_up_at: parseOptionalTimestamp(payload.follow_up_at),
    outcome: payload.outcome ?? null,
    evidence_url: payload.evidence_url ?? null,
    published_at: parseOptionalTimestamp(payload.published_at),
    notes: payload.notes ?? null,
  };
}

async function loadCampaign(orgId: string, campaignId: string) {
  const campaign = (await db.select({
    id: campaigns.id,
    campaign_name: campaigns.campaign_name,
    linked_release_id: campaigns.linked_release_id,
  }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))))[0];
  if (!campaign) throw new NotFoundError("Campaign not found");
  return campaign;
}

async function assertLeadReferences(
  orgId: string,
  input: Partial<CreateCampaignLeadInput | UpdateCampaignLeadInput>,
) {
  const checks: Promise<unknown>[] = [];
  if (input.source_id && input.campaign_id) checks.push(assertCampaignSource(input.source_id, input.campaign_id, orgId));
  if (input.contact_id) checks.push(assertReference(contacts, input.contact_id, orgId, "Contact"));
  if (input.station_id) checks.push(assertReference(radio_stations, input.station_id, orgId, "Station"));
  if (input.exact_edit_track_id && input.campaign_id) checks.push(assertCampaignTrack(input.exact_edit_track_id, input.campaign_id, orgId));
  await Promise.all(checks);
}

async function assertReference(
  table: typeof contacts | typeof radio_stations,
  id: string,
  orgId: string,
  label: string,
) {
  const row = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.org_id, orgId))).limit(1);
  if (!row.length) throw new NotFoundError(`${label} not found`);
}

async function assertCampaignSource(sourceId: string, campaignId: string, orgId: string) {
  const row = await db.select({ id: campaign_sources.id }).from(campaign_sources).where(and(
    eq(campaign_sources.id, sourceId),
    eq(campaign_sources.campaign_id, campaignId),
    eq(campaign_sources.org_id, orgId),
  )).limit(1);
  if (!row.length) throw new NotFoundError("Campaign source not found");
}

async function assertCampaignTrack(trackId: string, campaignId: string, orgId: string) {
  const row = await db.select({ id: tracks.id }).from(tracks).innerJoin(campaigns, and(
    eq(campaigns.linked_release_id, tracks.release_id),
    eq(campaigns.org_id, orgId),
  )).where(and(
    eq(tracks.id, trackId),
    eq(tracks.org_id, orgId),
    eq(campaigns.id, campaignId),
  )).limit(1);
  if (!row.length) throw new NotFoundError("Campaign release track not found");
}

function parseOptionalTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError("Invalid campaign timestamp");
  return parsed;
}

function isHttpsUrl(value: string | null): value is string {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

async function assertDogfoodReferences(
  orgId: string,
  campaignId: string,
  input: {
    linked_lead_id?: string | null;
    linked_draft_id?: string | null;
    linked_enrichment_run_id?: string | null;
    linked_page_revision_id?: string | null;
  },
) {
  const checks: Promise<unknown>[] = [];
  if (input.linked_lead_id) checks.push(assertCampaignReference(
    campaign_leads,
    input.linked_lead_id,
    orgId,
    campaignId,
    "Campaign lead",
  ));
  if (input.linked_draft_id) checks.push(assertCampaignReference(
    campaign_outreach_drafts,
    input.linked_draft_id,
    orgId,
    campaignId,
    "Campaign draft",
  ));
  if (input.linked_enrichment_run_id) checks.push(assertCampaignReference(
    campaign_enrichment_runs,
    input.linked_enrichment_run_id,
    orgId,
    campaignId,
    "Campaign enrichment run",
  ));
  if (input.linked_page_revision_id) checks.push(assertCampaignPageRevision(input.linked_page_revision_id, campaignId, orgId));
  await Promise.all(checks);
}

async function assertCampaignPageRevision(id: string, campaignId: string, orgId: string) {
  const row = await db.select({ id: campaign_public_page_revisions.id }).from(campaign_public_page_revisions)
    .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
    .where(and(
      eq(campaign_public_page_revisions.id, id),
      eq(campaign_public_page_revisions.org_id, orgId),
      eq(campaign_public_pages.org_id, orgId),
      eq(campaign_public_pages.campaign_id, campaignId),
    )).limit(1);
  if (!row.length) throw new NotFoundError("Campaign page revision not found");
}

async function assertCampaignReference(
  table: typeof campaign_leads | typeof campaign_outreach_drafts | typeof campaign_enrichment_runs,
  id: string,
  orgId: string,
  campaignId: string,
  label: string,
) {
  const row = await db.select({ id: table.id }).from(table).where(and(
    eq(table.id, id),
    eq(table.org_id, orgId),
    eq(table.campaign_id, campaignId),
  )).limit(1);
  if (!row.length) throw new NotFoundError(`${label} not found`);
}

function latestSuggestions<T extends { suggestion_type: string; created_at: Date }>(suggestions: T[]) {
  const latest = new Map<string, T>();
  for (const suggestion of [...suggestions].sort((left, right) => right.created_at.getTime() - left.created_at.getTime())) {
    if (!latest.has(suggestion.suggestion_type)) latest.set(suggestion.suggestion_type, suggestion);
  }
  return [...latest.values()];
}

export function isCampaignOutreachSchemaUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const err = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err.code ?? err.cause?.code;
  const message = (err.message ?? err.cause?.message ?? "").toLowerCase();
  return code === "42P01" || code === "42703" || message.includes("campaign_lead") || message.includes("campaign_source") || message.includes("campaign_dogfood");
}
