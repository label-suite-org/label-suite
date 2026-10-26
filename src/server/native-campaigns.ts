import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, lte, ne, notInArray, sql } from "drizzle-orm";
import { campaign_leads, campaigns, tracks, artists, releases } from "../db/schema";
import { db } from "../lib/db";
import { getCampaignActivitySnapshot } from "./campaign-activity";
import type { CampaignActivityItem, CampaignActivitySnapshot } from "./campaign-activity-core";
import { HttpError, NotFoundError } from "./errors";
import { campaignPipelineStageSchema, campaignTargetTypeSchema } from "./campaign-outreach-core";

const TERMINAL_STAGES = ["confirmed", "published", "nurture"] as const;
const QUEUE_GROUPS = ["now", "follow_up", "waiting", "completed"] as const;
const MAX_PAGE_SIZE = 50;
const NATIVE_ACTIVITY_SOURCE_LIMIT = 100;

export type NativeLeadQueue = (typeof QUEUE_GROUPS)[number];

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof parsed.offset === "number" && Number.isInteger(parsed.offset) && parsed.offset >= 0 ? parsed.offset : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function pageSize(value: string | null): number {
  const parsed = Number(value ?? 25);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE) : 25;
}

const NATIVE_CAMPAIGN_SECTIONS = [
  ["overview", "Overview"], ["activity", "Activity"], ["leads", "Leads"],
] as const;

type NativeCampaignDetailSource = {
  id: string;
  campaign_name: string;
  status: string | null;
  campaign_type: string | null;
  owner: string | null;
  goal: string | null;
  updated_at: Date | null;
  artist_id: string | null;
  artist_name: string | null;
  release_id: string | null;
  release_title: string | null;
};

export function projectNativeCampaignDetail(source: NativeCampaignDetailSource, fetchedAt = new Date()) {
  const updatedAt = source.updated_at?.toISOString() ?? null;
  return {
    campaign: {
      id: source.id,
      name: source.campaign_name,
      status: source.status,
      campaign_type: source.campaign_type,
      owner: source.owner,
      goal: source.goal,
      archived: source.status === "archived",
      artist: source.artist_id && source.artist_name ? { id: source.artist_id, name: source.artist_name } : null,
      release: source.release_id && source.release_title ? { id: source.release_id, title: source.release_title } : null,
    },
    next_work: { label: "Review campaign activity", href: `/campaigns/${encodeURIComponent(source.id)}?section=activity` },
    sections: NATIVE_CAMPAIGN_SECTIONS.map(([key, title]) => ({ key, title })),
    freshness: { state: updatedAt ? "fresh" as const : "unknown" as const, updated_at: updatedAt, fetched_at: fetchedAt.toISOString() },
  };
}

export async function getNativeCampaignDetail(orgId: string, campaignId: string) {
  const rows = await db
    .select({
      id: campaigns.id, campaign_name: campaigns.campaign_name, status: campaigns.status, campaign_type: campaigns.campaign_type,
      owner: campaigns.owner, goal: campaigns.goal, updated_at: campaigns.updated_at,
      artist_id: artists.id, artist_name: artists.name, release_id: releases.id, release_title: releases.title,
    })
    .from(campaigns)
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)))
    .limit(1);
  if (!rows.length) throw new NotFoundError("Campaign not found");
  return projectNativeCampaignDetail(rows[0]);
}

export async function listNativeCampaignSummaries(
  orgId: string,
  options: { archived: boolean; cursor: string | null; limit: string | null },
) {
  const limit = pageSize(options.limit);
  const offset = decodeCursor(options.cursor);
  const rows = await db
    .select({
      id: campaigns.id,
      name: campaigns.campaign_name,
      status: campaigns.status,
      campaign_type: campaigns.campaign_type,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      owner: campaigns.owner,
      updated_at: campaigns.updated_at,
    })
    .from(campaigns)
    .where(and(eq(campaigns.org_id, orgId), options.archived ? eq(campaigns.status, "archived") : ne(campaigns.status, "archived")))
    .orderBy(desc(campaigns.updated_at), desc(campaigns.id))
    .limit(limit + 1)
    .offset(offset);

  const visible = rows.slice(0, limit);
  const ids = visible.map((row) => row.id);
  const counts = ids.length
    ? await db
      .select({ campaign_id: campaign_leads.campaign_id, count: sql<number>`count(*)::int` })
      .from(campaign_leads)
      .where(and(eq(campaign_leads.org_id, orgId), inArray(campaign_leads.campaign_id, ids)))
      .groupBy(campaign_leads.campaign_id)
    : [];
  const countByCampaign = new Map(counts.map((row) => [row.campaign_id, Number(row.count)]));

  return {
    items: visible.map((row) => ({
      ...row,
      lead_count: countByCampaign.get(row.id) ?? 0,
      archived: row.status === "archived",
    })),
    next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null,
  };
}

type NativeActivityCursor = { campaign_id: string; occurred_at: string | null; key: string; snapshot: string };

function orderedActivity(items: CampaignActivityItem[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    const rightTime = right.occurredAt?.getTime() ?? Number.NEGATIVE_INFINITY;
    return rightTime - leftTime || left.key.localeCompare(right.key);
  });
}

function snapshotFingerprint(snapshot: CampaignActivitySnapshot) {
  const canonical = orderedActivity(snapshot.items).map((item) => [item.key, item.occurredAt?.toISOString() ?? null]);
  return createHash("sha256").update(JSON.stringify({ canonical, sourceStates: snapshot.sourceStates })).digest("base64url");
}

function encodeActivityCursor(campaignId: string, item: CampaignActivityItem, snapshot: string) {
  const value: NativeActivityCursor = { campaign_id: campaignId, occurred_at: item.occurredAt?.toISOString() ?? null, key: item.key, snapshot };
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeActivityCursor(cursor: string, campaignId: string): NativeActivityCursor {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Partial<NativeActivityCursor>;
    if (parsed.campaign_id !== campaignId || typeof parsed.key !== "string" || !parsed.key || (parsed.occurred_at !== null && typeof parsed.occurred_at !== "string") || typeof parsed.snapshot !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(parsed.snapshot)) throw new Error("invalid");
    return { campaign_id: parsed.campaign_id, occurred_at: parsed.occurred_at, key: parsed.key, snapshot: parsed.snapshot };
  } catch {
    throw new HttpError("Invalid activity cursor", 400, "activity_cursor_invalid");
  }
}

export function paginateNativeCampaignActivity(
  campaignId: string,
  snapshot: CampaignActivitySnapshot,
  options: { cursor: string | null; limit: string | null },
) {
  const items = orderedActivity(snapshot.items);
  const fingerprint = snapshotFingerprint(snapshot);
  const limit = pageSize(options.limit);
  let start = 0;
  if (options.cursor) {
    const cursor = decodeActivityCursor(options.cursor, campaignId);
    if (cursor.snapshot !== fingerprint) {
      throw new HttpError("Activity cursor is stale; restart pagination", 409, "activity_cursor_stale");
    }
    const index = items.findIndex((item) => item.key === cursor.key && (item.occurredAt?.toISOString() ?? null) === cursor.occurred_at);
    if (index < 0) throw new HttpError("Invalid activity cursor", 400, "activity_cursor_invalid");
    start = index + 1;
  }
  const page = items.slice(start, start + limit);
  const finalItem = page.at(-1);
  return {
    campaign_id: campaignId,
    items: page,
    source_states: snapshot.sourceStates,
    next_cursor: finalItem && start + page.length < items.length ? encodeActivityCursor(campaignId, finalItem, fingerprint) : null,
  };
}

export async function getNativeCampaignActivity(
  orgId: string,
  campaignId: string,
  options: { cursor: string | null; limit: string | null },
) {
  return paginateNativeCampaignActivity(
    campaignId,
    await getCampaignActivitySnapshot(orgId, campaignId, {}, { sourceLimit: NATIVE_ACTIVITY_SOURCE_LIMIT }),
    options,
  );
}

export async function listNativeCampaignLeads(
  orgId: string,
  campaignId: string,
  options: {
    queue: NativeLeadQueue;
    channel: string | null;
    stage: string | null;
    cursor: string | null;
    limit: string | null;
    now?: Date;
  },
) {
  const campaign = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))).limit(1);
  if (!campaign.length) throw new NotFoundError("Campaign not found");

  const now = options.now ?? new Date();
  const filters = [eq(campaign_leads.org_id, orgId), eq(campaign_leads.campaign_id, campaignId)];
  if (options.channel) filters.push(eq(campaign_leads.target_type, campaignTargetTypeSchema.parse(options.channel)));
  if (options.stage) filters.push(eq(campaign_leads.pipeline_stage, campaignPipelineStageSchema.parse(options.stage)));

  const notTerminal = notInArray(campaign_leads.pipeline_stage, [...TERMINAL_STAGES]);
  const notDue = sql`(${campaign_leads.follow_up_at} is null or ${campaign_leads.follow_up_at} > ${now})`;
  if (options.queue === "completed") filters.push(inArray(campaign_leads.pipeline_stage, [...TERMINAL_STAGES]));
  if (options.queue === "follow_up") filters.push(notTerminal, lte(campaign_leads.follow_up_at, now));
  if (options.queue === "waiting") filters.push(eq(campaign_leads.pipeline_stage, "sent"), notDue);
  if (options.queue === "now") filters.push(notTerminal, notDue, ne(campaign_leads.pipeline_stage, "sent"));

  const priority = sql<number>`(${campaign_leads.relationship_warmth} + ${campaign_leads.editorial_fit} + ${campaign_leads.useful_reach} + ${campaign_leads.direct_free_access})`;
  const currentTimestamp = sql`coalesce(${campaign_leads.last_contacted_at}, ${campaign_leads.updated_at})`;
  const order = options.queue === "follow_up"
    ? [asc(campaign_leads.follow_up_at), desc(priority), asc(currentTimestamp), asc(campaign_leads.id)]
    : [desc(priority), asc(currentTimestamp), asc(campaign_leads.id)];
  const limit = pageSize(options.limit);
  const offset = decodeCursor(options.cursor);
  const rows = await db
    .select({
      id: campaign_leads.id,
      campaign_id: campaign_leads.campaign_id,
      target_name: campaign_leads.target_name,
      target_type: campaign_leads.target_type,
      target_url: campaign_leads.target_url,
      discovery_source: campaign_leads.discovery_source,
      pipeline_stage: campaign_leads.pipeline_stage,
      exact_edit_track_id: campaign_leads.exact_edit_track_id,
      exact_edit_title: tracks.title,
      contact_route: campaign_leads.contact_route,
      contact_route_verified_at: campaign_leads.contact_route_verified_at,
      musical_fit: campaign_leads.musical_fit,
      pitch_angle: campaign_leads.pitch_angle,
      readiness_task_waiver_reason: campaign_leads.readiness_task_waiver_reason,
      relationship_warmth: campaign_leads.relationship_warmth,
      editorial_fit: campaign_leads.editorial_fit,
      useful_reach: campaign_leads.useful_reach,
      direct_free_access: campaign_leads.direct_free_access,
      priority_score: priority,
      last_contacted_at: campaign_leads.last_contacted_at,
      follow_up_at: campaign_leads.follow_up_at,
      updated_at: sql<string | null>`to_char(${campaign_leads.updated_at}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(campaign_leads)
    .leftJoin(tracks, and(eq(campaign_leads.exact_edit_track_id, tracks.id), eq(tracks.org_id, orgId)))
    .where(and(...filters))
    .orderBy(...order)
    .limit(limit + 1)
    .offset(offset);

  const visible = rows.slice(0, limit);
  return {
    campaign_id: campaignId,
    queue: options.queue,
    items: visible.map((row) => ({
      ...row,
      priority_score: Number(row.priority_score),
      readiness: {
        stage: row.pipeline_stage,
        contact_route: Boolean(row.contact_route?.trim()),
        contact_route_verified: Boolean(row.contact_route_verified_at),
        exact_edit: Boolean(row.exact_edit_track_id),
        musical_fit: Boolean(row.musical_fit?.trim()),
        pitch_angle: Boolean(row.pitch_angle?.trim()),
        task_waiver: Boolean(row.readiness_task_waiver_reason?.trim()),
      },
      priority_inputs: {
        relationship_warmth: row.relationship_warmth,
        editorial_fit: row.editorial_fit,
        useful_reach: row.useful_reach,
        direct_free_access: row.direct_free_access,
      },
    })),
    next_cursor: rows.length > limit ? encodeCursor(offset + limit) : null,
  };
}
