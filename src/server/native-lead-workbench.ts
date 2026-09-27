import { and, asc, desc, eq } from "drizzle-orm";
import {
  campaign_enrichment_suggestions,
  campaign_leads,
  campaign_outreach_drafts,
  campaign_outreach_events,
  campaign_sources,
  campaigns,
  contacts,
  ops_tasks,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import { getLeadReadyBlockers } from "./campaign-communicator-core";
import { campaignPipelineStageSchema, scoreCampaignLeadPriority } from "./campaign-outreach-core";
import { NotFoundError } from "./errors";

const MAX_ACTIVITY_PAGE = 50;

function decodeOffset(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function encodeOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function pageSize(value: string | null | undefined): number {
  const parsed = Number(value ?? 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_ACTIVITY_PAGE) : 10;
}

async function findLead(orgId: string, campaignId: string, leadId: string) {
  const rows = await db
    .select({
      id: campaign_leads.id,
      campaign_id: campaign_leads.campaign_id,
      campaign_name: campaigns.campaign_name,
      target_name: campaign_leads.target_name,
      target_type: campaign_leads.target_type,
      target_url: campaign_leads.target_url,
      discovery_source: campaign_leads.discovery_source,
      source_id: campaign_leads.source_id,
      source_title: campaign_sources.title,
      source_type: campaign_sources.source_type,
      source_url: campaign_sources.url,
      contact_id: campaign_leads.contact_id,
      contact_name: contacts.name,
      exact_edit_track_id: campaign_leads.exact_edit_track_id,
      exact_edit_title: tracks.title,
      contact_route: campaign_leads.contact_route,
      contact_route_verified_at: campaign_leads.contact_route_verified_at,
      recommending_person: campaign_leads.recommending_person,
      introduction_available: campaign_leads.introduction_available,
      musical_fit: campaign_leads.musical_fit,
      pitch_angle: campaign_leads.pitch_angle,
      readiness_task_waiver_reason: campaign_leads.readiness_task_waiver_reason,
      relationship_warmth: campaign_leads.relationship_warmth,
      editorial_fit: campaign_leads.editorial_fit,
      useful_reach: campaign_leads.useful_reach,
      direct_free_access: campaign_leads.direct_free_access,
      pipeline_stage: campaign_leads.pipeline_stage,
      last_contacted_at: campaign_leads.last_contacted_at,
      follow_up_at: campaign_leads.follow_up_at,
      updated_at: campaign_leads.updated_at,
    })
    .from(campaign_leads)
    .innerJoin(campaigns, and(eq(campaign_leads.campaign_id, campaigns.id), eq(campaigns.org_id, orgId)))
    .leftJoin(campaign_sources, and(eq(campaign_leads.source_id, campaign_sources.id), eq(campaign_sources.org_id, orgId)))
    .leftJoin(contacts, and(eq(campaign_leads.contact_id, contacts.id), eq(contacts.org_id, orgId)))
    .leftJoin(tracks, and(eq(campaign_leads.exact_edit_track_id, tracks.id), eq(tracks.org_id, orgId)))
    .where(and(eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId), eq(campaign_leads.id, leadId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getNativeLeadWorkbench(
  orgId: string,
  campaignId: string,
  leadId: string,
  options: { activityCursor?: string | null; activityLimit?: string | null } = {},
) {
  const lead = await findLead(orgId, campaignId, leadId);
  if (!lead) throw new NotFoundError("Campaign lead not found");

  const [tasks, drafts, suggestions, activity] = await Promise.all([
    db.select({
      id: ops_tasks.id,
      task_name: ops_tasks.task_name,
      status: ops_tasks.status,
      priority: ops_tasks.priority,
      due_date: ops_tasks.due_date,
      next_action: ops_tasks.next_action,
    }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_campaign_id, campaignId), eq(ops_tasks.linked_campaign_lead_id, leadId))).orderBy(asc(ops_tasks.due_date), asc(ops_tasks.id)),
    db.select({
      id: campaign_outreach_drafts.id,
      version: campaign_outreach_drafts.version,
      status: campaign_outreach_drafts.status,
      scope: campaign_outreach_drafts.scope,
      subject: campaign_outreach_drafts.subject,
      body: campaign_outreach_drafts.body,
      body_document: campaign_outreach_drafts.body_document,
      created_at: campaign_outreach_drafts.created_at,
      updated_at: campaign_outreach_drafts.updated_at,
    }).from(campaign_outreach_drafts).where(and(eq(campaign_outreach_drafts.org_id, orgId), eq(campaign_outreach_drafts.campaign_id, campaignId), eq(campaign_outreach_drafts.lead_id, leadId))).orderBy(desc(campaign_outreach_drafts.version)),
    db.select({
      id: campaign_enrichment_suggestions.id,
      suggestion_type: campaign_enrichment_suggestions.suggestion_type,
      suggested_value: campaign_enrichment_suggestions.suggested_value,
      evidence: campaign_enrichment_suggestions.evidence,
      status: campaign_enrichment_suggestions.status,
      created_at: campaign_enrichment_suggestions.created_at,
    }).from(campaign_enrichment_suggestions).where(and(eq(campaign_enrichment_suggestions.org_id, orgId), eq(campaign_enrichment_suggestions.campaign_id, campaignId), eq(campaign_enrichment_suggestions.lead_id, leadId))).orderBy(desc(campaign_enrichment_suggestions.created_at)).limit(20),
    listNativeLeadActivity(orgId, campaignId, leadId, { cursor: options.activityCursor, limit: options.activityLimit }),
  ]);

  const pipelineStage = campaignPipelineStageSchema.parse(lead.pipeline_stage);
  const approvedDraft = drafts.find((draft) => draft.status === "approved");
  const blockers = getLeadReadyBlockers({
    contact_route: lead.contact_route,
    contact_route_verified_at: lead.contact_route_verified_at,
    exact_edit_track_id: lead.exact_edit_track_id,
    musical_fit: lead.musical_fit,
    pitch_angle: lead.pitch_angle,
    recommending_person: lead.recommending_person,
    introduction_available: lead.introduction_available,
    approved_draft_id: approvedDraft?.id ?? null,
    tasks,
    readiness_task_waiver_reason: lead.readiness_task_waiver_reason,
  });

  return {
    campaign: { id: lead.campaign_id, name: lead.campaign_name },
    lead: {
      ...lead,
      pipeline_stage: pipelineStage,
      priority_score: scoreCampaignLeadPriority(lead),
      priority_inputs: {
        relationship_warmth: lead.relationship_warmth,
        editorial_fit: lead.editorial_fit,
        useful_reach: lead.useful_reach,
        direct_free_access: lead.direct_free_access,
      },
      availability: {
        source: lead.source_id ? "available" : "unavailable",
        exact_edit: lead.exact_edit_track_id ? "available" : "unavailable",
        contact_route: lead.contact_route_verified_at ? "verified" : lead.contact_route ? "unverified" : "unavailable",
        musical_fit: lead.musical_fit ? "available" : "unavailable",
        pitch_angle: lead.pitch_angle ? "available" : "unavailable",
      },
      readiness: { stage: pipelineStage, blockers },
    },
    tasks,
    drafts: drafts.map((draft) => ({ ...draft, is_rich: draft.body_document !== null && draft.body_document !== undefined })),
    suggestions,
    activity,
  };
}

export async function listNativeLeadActivity(
  orgId: string,
  campaignId: string,
  leadId: string,
  options: { cursor?: string | null; limit?: string | null } = {},
) {
  const limit = pageSize(options.limit);
  const offset = decodeOffset(options.cursor ?? null);
  const rows = await db.select({
    id: campaign_outreach_events.id,
    event_type: campaign_outreach_events.event_type,
    actor_user_id: campaign_outreach_events.actor_user_id,
    occurred_at: campaign_outreach_events.occurred_at,
    details: campaign_outreach_events.details,
  }).from(campaign_outreach_events).where(and(
    eq(campaign_outreach_events.org_id, orgId),
    eq(campaign_outreach_events.campaign_id, campaignId),
    eq(campaign_outreach_events.lead_id, leadId),
  )).orderBy(desc(campaign_outreach_events.occurred_at), desc(campaign_outreach_events.id)).limit(limit + 1).offset(offset);
  const items = rows.slice(0, limit);
  return {
    items,
    partial: true,
    next_cursor: rows.length > limit ? encodeOffset(offset + limit) : null,
  };
}
