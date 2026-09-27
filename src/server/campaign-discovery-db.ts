import { and, asc, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { campaign_discovery_reviews, campaign_discovery_runs, campaign_leads, creator_channels, tracks } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { writeAuditLog } from "./audit";
import type { DiscoveryReviewRecord, DiscoveryRun, PromotionInput, PromotionResult, SaveDiscoveryReviewInput } from "./campaign-discovery";
import { ConflictError, HttpError } from "./errors";
import { getCampaignDetail } from "./campaigns";
import { buildCampaignLeadDedupeKey, type CreateCampaignLeadInput } from "./campaign-outreach-core";
import { createCampaignLead } from "./campaign-outreach";

export async function promoteCampaignDiscoveryLead(orgId: string, input: PromotionInput): Promise<PromotionResult> {
  const dedupeKey = buildCampaignLeadDedupeKey({ target_url: input.channel.url, target_name: input.channel.title });
  const leadInput: CreateCampaignLeadInput = {
    campaign_id: input.campaignId,
    dedupe_key: dedupeKey,
    target_name: input.channel.title,
    target_type: "youtube_channel",
    target_url: input.channel.url,
    discovery_source: "campaign_discovery",
    relationship_warmth: 0,
    editorial_fit: 0,
    useful_reach: 0,
    direct_free_access: 0,
    pipeline_stage: "identified",
    evidence_url: input.evidence[0]?.url ?? null,
    source_id: null,
    contact_id: null,
    station_id: null,
    exact_edit_track_id: null,
    contact_route: null,
    recommending_person: null,
    introduction_available: null,
    musical_fit: null,
    pitch_angle: null,
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    published_at: null,
    notes: null,
  };
  try {
    const created = await createCampaignLead(orgId, leadInput);
    return { leadId: created.id, outcome: "created" };
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    const existing = (await db.select({ id: campaign_leads.id }).from(campaign_leads).where(and(
      eq(campaign_leads.org_id, orgId),
      eq(campaign_leads.campaign_id, input.campaignId),
      eq(campaign_leads.dedupe_key, dedupeKey),
    )).limit(1))[0];
    if (!existing) throw error;
    return { leadId: existing.id, outcome: "existing" };
  }
}

/** Keeps canonical lead creation, revision check, review write, and audit in one rollback scope. */
export async function promoteAndSaveCampaignDiscoveryReview(
  input: SaveDiscoveryReviewInput & { promotion: PromotionInput },
): Promise<DiscoveryReviewRecord> {
  // Establish the transaction context even for callers outside a request wrapper.
  return runWithDatabaseContext({ userId: input.actorUserId, orgId: input.orgId }, async () => {
    const promotion = await promoteCampaignDiscoveryLead(input.orgId, input.promotion);
    return saveCampaignDiscoveryReview({
      ...input,
      promotedLeadId: promotion.leadId,
      promotionOutcome: promotion.outcome,
    });
  });
}

export async function loadCampaignDiscoveryContext(orgId: string, campaignId: string) {
  const campaign = await getCampaignDetail(orgId, campaignId);
  if (!campaign) return null;
  const campaignTracks = campaign.linked_release_id
    ? await db.select({ title: tracks.title }).from(tracks).where(and(
      eq(tracks.org_id, orgId),
      eq(tracks.release_id, campaign.linked_release_id),
    )).orderBy(asc(tracks.position), asc(tracks.title))
    : [];
  return {
    id: campaign.id,
    campaign_name: campaign.campaign_name,
    artist_name: campaign.artist_name,
    release_title: campaign.release_title,
    goal: campaign.goal,
    tracks: campaignTracks.map(({ title }) => title),
  };
}

type DiscoveryRunCursor = { created_at: string; id: string };

export function encodeDiscoveryRunCursor(run: Pick<DiscoveryRun, "created_at" | "id">): string {
  return Buffer.from(JSON.stringify({ created_at: run.created_at, id: run.id })).toString("base64url");
}

function decodeDiscoveryRunCursor(cursor: string | undefined): DiscoveryRunCursor | null {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as DiscoveryRunCursor;
    if (!value?.id || !value.created_at || Number.isNaN(Date.parse(value.created_at))) throw new Error("invalid");
    return value;
  } catch {
    throw new HttpError("cursor must be a discovery run cursor", 400);
  }
}

function projectDiscoveryChannels(candidateLimit?: number, evidenceLimit?: number, providerChannelId?: string, evidenceIds?: string[]) {
  if (candidateLimit === undefined && evidenceLimit === undefined && providerChannelId === undefined && evidenceIds === undefined) return campaign_discovery_runs.channels;
  const candidateCount = candidateLimit ?? 2147483647;
  const evidenceCount = evidenceLimit ?? 2147483647;
  return sql<DiscoveryRun["channels"]>`coalesce((
    select jsonb_agg(projected.channel order by projected.ordinality)
    from (
      select channel.ordinality, jsonb_set(channel.value, '{evidence}', coalesce((
        select jsonb_agg(evidence.value order by evidence.ordinality)
        from (
          select value, ordinality
          from jsonb_array_elements(channel.value->'evidence') with ordinality as entries(value, ordinality)
          where ${evidenceIds === undefined ? sql`true` : (evidenceIds.length ? inArray(sql`value->>'provider_item_id'`, evidenceIds) : sql`false`)}
          order by ordinality
          limit ${evidenceCount}
        ) as evidence
      ), '[]'::jsonb)) as channel
      from jsonb_array_elements(${campaign_discovery_runs.channels}) with ordinality as channel(value, ordinality)
      where ${providerChannelId === undefined ? sql`true` : sql`channel.value->>'provider_channel_id' = ${providerChannelId}`}
      order by channel.ordinality
      limit ${candidateCount}
    ) as projected
  ), '[]'::jsonb)`;
}

export async function listCampaignDiscoveryRuns(
  orgId: string,
  campaignId: string,
  options: { cursor?: string; runLimit?: number; candidateLimit?: number; evidenceLimit?: number; providerChannelId?: string; evidenceIds?: string[] } = {},
): Promise<DiscoveryRun[]> {
  const cursor = decodeDiscoveryRunCursor(options.cursor);
  const where = and(
    eq(campaign_discovery_runs.org_id, orgId),
    eq(campaign_discovery_runs.campaign_id, campaignId),
    ...(options.providerChannelId === undefined ? [] : [sql`${campaign_discovery_runs.channels} @> ${JSON.stringify([{ provider_channel_id: options.providerChannelId }])}::jsonb`]),
    ...(cursor ? [or(
      lt(campaign_discovery_runs.created_at, new Date(cursor.created_at)),
      and(eq(campaign_discovery_runs.created_at, new Date(cursor.created_at)), lt(campaign_discovery_runs.id, cursor.id)),
    )] : []),
  );
  const query = db.select({
    id: campaign_discovery_runs.id,
    status: campaign_discovery_runs.status,
    estimated_cost_units: campaign_discovery_runs.estimated_cost_units,
    queries: campaign_discovery_runs.queries,
    channels: projectDiscoveryChannels(options.candidateLimit, options.evidenceLimit, options.providerChannelId, options.evidenceIds),
    created_at: campaign_discovery_runs.created_at,
  }).from(campaign_discovery_runs).where(where).orderBy(desc(campaign_discovery_runs.created_at), desc(campaign_discovery_runs.id));
  const rows = options.runLimit === undefined ? await query : await query.limit(options.runLimit);
  const latestChannels = rows[0]?.channels as DiscoveryRun["channels"] | undefined;
  if (options.providerChannelId && options.evidenceIds?.length && latestChannels?.[0]) {
    // Keep explicit citations from older runs without loading the campaign history into the app.
    const selected = await db.execute<{ evidence: DiscoveryRun["channels"][number]["evidence"][number] }>(sql`
      select distinct on (evidence.value->>'provider_item_id') evidence.value as evidence
      from ${campaign_discovery_runs} as history
      cross join lateral jsonb_array_elements(history.channels) as channel(value)
      cross join lateral jsonb_array_elements(channel.value->'evidence') as evidence(value)
      where history.org_id = ${orgId} and history.campaign_id = ${campaignId}
        and channel.value->>'provider_channel_id' = ${options.providerChannelId}
        and ${inArray(sql`evidence.value->>'provider_item_id'`, options.evidenceIds)}
      order by evidence.value->>'provider_item_id', history.created_at desc, history.id desc
      limit 10
    `);
    latestChannels[0].evidence = selected.rows.map((row) => row.evidence);
  }
  return rows.map((row) => ({
    id: row.id,
    status: row.status as DiscoveryRun["status"],
    estimated_cost_units: row.estimated_cost_units,
    queries: row.queries as DiscoveryRun["queries"],
    channels: row.channels as DiscoveryRun["channels"],
    exact_match_channels: [],
    prospective_fit_channels: [],
    created_at: row.created_at.toISOString(),
  }));
}

export async function saveCampaignDiscoveryRun(orgId: string, campaignId: string, run: DiscoveryRun) {
  await db.transaction(async (tx) => {
    for (const channel of run.channels) {
      const id = `${orgId}:youtube_channel:${channel.provider_channel_id}`;
      await tx.insert(creator_channels).values({
        id,
        org_id: orgId,
        provider: "youtube",
        provider_channel_id: channel.provider_channel_id,
        title: channel.title,
        url: channel.url,
        updated_at: new Date(run.created_at),
      }).onConflictDoUpdate({
        target: [creator_channels.org_id, creator_channels.provider, creator_channels.provider_channel_id],
        set: { title: channel.title, url: channel.url, updated_at: new Date(run.created_at) },
      });
    }
    await tx.insert(campaign_discovery_runs).values({
      id: run.id,
      org_id: orgId,
      campaign_id: campaignId,
      status: run.status,
      estimated_cost_units: run.estimated_cost_units,
      queries: run.queries,
      channels: run.channels,
      created_at: new Date(run.created_at),
    });
  });
}

export async function listCampaignDiscoveryReviews(
  orgId: string,
  campaignId: string,
  providerChannelIds?: string[],
): Promise<DiscoveryReviewRecord[]> {
  if (providerChannelIds && !providerChannelIds.length) return [];
  const rows = await db.select().from(campaign_discovery_reviews).where(and(
    eq(campaign_discovery_reviews.org_id, orgId),
    eq(campaign_discovery_reviews.campaign_id, campaignId),
    ...(providerChannelIds ? [inArray(campaign_discovery_reviews.provider_channel_id, providerChannelIds)] : []),
  ));
  return rows.map(toReviewRecord);
}

export async function listPriorCampaignDiscoveryReviews(
  orgId: string,
  campaignId: string,
  providerChannelIds: string[],
  limit?: number,
): Promise<DiscoveryReviewRecord[]> {
  if (!providerChannelIds.length) return [];
  const query = db.select().from(campaign_discovery_reviews).where(and(
    eq(campaign_discovery_reviews.org_id, orgId),
    eq(campaign_discovery_reviews.provider, "youtube"),
    inArray(campaign_discovery_reviews.provider_channel_id, providerChannelIds),
    ne(campaign_discovery_reviews.campaign_id, campaignId),
  )).orderBy(desc(campaign_discovery_reviews.updated_at), desc(campaign_discovery_reviews.id));
  const rows = limit === undefined ? await query : await query.limit(limit);
  return rows.map(toReviewRecord);
}

export async function saveCampaignDiscoveryReview(input: SaveDiscoveryReviewInput): Promise<DiscoveryReviewRecord> {
  return db.transaction(async (tx) => {
    const where = and(
      eq(campaign_discovery_reviews.org_id, input.orgId),
      eq(campaign_discovery_reviews.campaign_id, input.campaignId),
      eq(campaign_discovery_reviews.provider, input.provider),
      eq(campaign_discovery_reviews.provider_channel_id, input.providerChannelId),
    );
    const existing = (await tx.select().from(campaign_discovery_reviews).where(where).limit(1))[0];
    if (existing && existing.revision !== input.expectedRevision) {
      throw new HttpError("Discovery candidate changed; reload before reviewing", 409);
    }
    const history = [
      ...((existing?.history as DiscoveryReviewRecord["history"]) ?? []),
      {
        state: input.nextState,
        reason: input.reason,
        actor_user_id: input.actorUserId,
        decided_at: input.decidedAt,
        revision: input.expectedRevision + 1,
        promoted_lead_id: input.promotedLeadId ?? null,
        promotion_outcome: input.promotionOutcome ?? null,
        promoted_evidence: input.promotedEvidence ?? [],
      },
    ];
    const values = {
      id: existing?.id ?? `discovery_review:${input.orgId}:${input.campaignId}:${input.provider}:${input.providerChannelId}`,
      org_id: input.orgId,
      campaign_id: input.campaignId,
      provider: input.provider,
      provider_channel_id: input.providerChannelId,
      state: input.nextState,
      rejection_reason: input.reason,
      revision: input.expectedRevision + 1,
      actor_user_id: input.actorUserId,
      promoted_lead_id: input.promotedLeadId ?? null,
      promotion_outcome: input.promotionOutcome ?? null,
      promoted_evidence: input.promotedEvidence ?? [],
      decided_at: new Date(input.decidedAt),
      history,
      updated_at: new Date(input.decidedAt),
    };
    let row;
    try {
      row = existing
        ? (await tx.update(campaign_discovery_reviews).set(values).where(and(eq(campaign_discovery_reviews.id, existing.id), eq(campaign_discovery_reviews.revision, input.expectedRevision))).returning())[0]
        : (await tx.insert(campaign_discovery_reviews).values(values).returning())[0];
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) throw new HttpError("Discovery candidate changed; reload before reviewing", 409);
      throw error;
    }
    if (!row) throw new HttpError("Discovery candidate changed; reload before reviewing", 409);
    await writeAuditLog({
      orgId: input.orgId,
      actorUserId: input.actorUserId,
      action: "campaign.discovery.reviewed",
      entityType: "campaign_discovery_review",
      entityId: row.id,
      beforeData: existing ? { state: existing.state, revision: existing.revision } : null,
      afterData: { state: row.state, rejection_reason: row.rejection_reason, revision: row.revision, promoted_lead_id: row.promoted_lead_id, promotion_outcome: row.promotion_outcome },
      metadata: { campaign_id: input.campaignId, provider: input.provider, provider_channel_id: input.providerChannelId },
    }, tx);
    return toReviewRecord(row);
  });
}

function toReviewRecord(row: typeof campaign_discovery_reviews.$inferSelect): DiscoveryReviewRecord {
  return {
    id: row.id,
    org_id: row.org_id,
    campaign_id: row.campaign_id,
    provider: row.provider,
    provider_channel_id: row.provider_channel_id,
    state: row.state as DiscoveryReviewRecord["state"],
    reason: row.rejection_reason as DiscoveryReviewRecord["reason"],
    actor_user_id: row.actor_user_id,
    decided_at: row.decided_at?.toISOString() ?? null,
    revision: row.revision,
    history: row.history as DiscoveryReviewRecord["history"],
    promoted_lead_id: row.promoted_lead_id,
    promotion_outcome: row.promotion_outcome as DiscoveryReviewRecord["promotion_outcome"],
    promoted_evidence: row.promoted_evidence as DiscoveryReviewRecord["promoted_evidence"],
    prior_campaign_decisions: [],
  };
}
