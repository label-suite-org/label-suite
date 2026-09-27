import { HttpError, NotFoundError } from "./errors";
import { searchYouTubeCreatorCandidates } from "./youtube-creator-discovery";
import { z } from "zod";

export const YOUTUBE_DISCOVERY_QUERY_COST_UNITS = 100;
export const DEFAULT_DISCOVERY_QUERY_COUNT = 4;
export const MAX_DISCOVERY_QUERY_COUNT = 6;
export const DISCOVERY_REJECTION_REASONS = [
  "wrong_music",
  "wrong_format",
  "inactive",
  "insufficient_evidence",
  "duplicate",
  "unsuitable_contact_model",
] as const;

export type DiscoveryReviewState = "unreviewed" | "shortlisted" | "rejected" | "promoted";
export type DiscoveryRejectionReason = typeof DISCOVERY_REJECTION_REASONS[number];

const runCommandSchema = z.object({
  type: z.literal("run"),
  queries: z.array(z.object({
    query: z.string().trim().min(1).max(200),
    enabled: z.boolean(),
  }).strict()).min(1).max(MAX_DISCOVERY_QUERY_COUNT),
}).strict();
const reviewCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shortlist"), channel_id: z.string().trim().min(1).max(300), expected_revision: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("reject"), channel_id: z.string().trim().min(1).max(300), expected_revision: z.number().int().min(0), reason: z.enum(DISCOVERY_REJECTION_REASONS) }).strict(),
  z.object({ type: z.literal("reconsider"), channel_id: z.string().trim().min(1).max(300), expected_revision: z.number().int().min(0) }).strict(),
  z.object({
    type: z.literal("promote"),
    channel_id: z.string().trim().min(1).max(300),
    expected_revision: z.number().int().min(0),
    evidence_ids: z.array(z.string().trim().min(1).max(300)).min(1).max(10)
      .refine((ids) => new Set(ids).size === ids.length, "Evidence must be selected once"),
  }).strict(),
]);
export const campaignDiscoveryCommandSchema = z.union([runCommandSchema, reviewCommandSchema]);
/** Native is intentionally review-only: it must not trigger provider discovery. */
export const nativeCampaignDiscoveryReviewCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("shortlist"), channel_id: z.string().trim().min(1).max(300), expected_revision: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("reject"), channel_id: z.string().trim().min(1).max(300), expected_revision: z.number().int().min(0), reason: z.enum(DISCOVERY_REJECTION_REASONS) }).strict(),
  z.object({
    type: z.literal("promote"),
    channel_id: z.string().trim().min(1).max(300),
    expected_revision: z.number().int().min(0),
    evidence_ids: z.array(z.string().trim().min(1).max(300)).min(1).max(10)
      .refine((ids) => new Set(ids).size === ids.length, "Evidence must be selected once"),
  }).strict(),
]);
export type CampaignDiscoveryCommand = z.infer<typeof campaignDiscoveryCommandSchema>;
type DiscoveryReviewResponse = Awaited<ReturnType<typeof loadCampaignDiscoveryWorkspace>> & { reviewed_channel_id: string; review: DiscoveryReview };

type CampaignDiscoveryContext = {
  id: string;
  campaign_name: string;
  artist_name: string | null;
  release_title: string | null;
  goal: string | null;
  tracks: string[];
};

type DiscoveryEvidence = {
  provider_item_id: string;
  provider: "youtube_data_api_v3";
  query: string;
  title: string;
  url: string;
  published_at: string;
  retrieved_at: string;
};

type DiscoveryChannel = {
  provider_channel_id: string;
  title: string;
  url: string;
  evidence: DiscoveryEvidence[];
  exact_match_evidence: DiscoveryEvidence[];
  prospective_fit: {
    qualifies: boolean;
    signals: Array<"musical_editorial_compatibility" | "matching_content_format" | "recent_relevant_activity" | "related_artist_coverage">;
  };
  activity_freshness: { state: "fresh" | "stale"; latest_activity_at: string | null; expires_at: string };
  relevance: { exactness: number; editorial_fit: number; activity: number; evidence_strength: number; total: number };
  review: DiscoveryReview;
};

export type DiscoveryReviewHistoryEntry = {
  state: DiscoveryReviewState;
  reason: DiscoveryRejectionReason | null;
  actor_user_id: string | null;
  decided_at: string;
  revision: number;
  promoted_lead_id?: string | null;
  promotion_outcome?: "created" | "existing" | null;
  promoted_evidence?: DiscoveryPromotionEvidence[];
};

export type DiscoveryPromotionEvidence = Pick<DiscoveryEvidence, "provider_item_id" | "provider" | "query" | "title" | "url" | "published_at" | "retrieved_at">;

export type DiscoveryReview = {
  state: DiscoveryReviewState;
  reason: DiscoveryRejectionReason | null;
  actor_user_id: string | null;
  decided_at: string | null;
  revision: number;
  history: DiscoveryReviewHistoryEntry[];
  promoted_lead_id: string | null;
  promotion_outcome: "created" | "existing" | null;
  promoted_evidence: DiscoveryPromotionEvidence[];
  prior_campaign_decisions: Array<{
    campaign_id: string;
    state: DiscoveryReviewState;
    reason: DiscoveryRejectionReason | null;
    decided_at: string | null;
  }>;
  prior_campaign_decisions_truncated?: boolean;
};

export type DiscoveryRun = {
  id: string;
  status: "completed" | "partial" | "failed";
  created_at: string;
  estimated_cost_units: number;
  queries: Array<{
    query: string;
    enabled: boolean;
    status: "completed" | "failed" | "disabled";
    error: string | null;
  }>;
  channels: DiscoveryChannel[];
  exact_match_channels: DiscoveryChannel[];
  prospective_fit_channels: DiscoveryChannel[];
};

export type DiscoveryReadOptions = {
  cursor?: string;
  runLimit?: number;
  candidateLimit?: number;
  evidenceLimit?: number;
};

type DiscoveryRunReadOptions = Pick<DiscoveryReadOptions, "cursor" | "runLimit" | "candidateLimit" | "evidenceLimit"> & { providerChannelId?: string; evidenceIds?: string[] };

export interface CampaignDiscoveryRepository {
  listRuns(orgId: string, campaignId: string, options?: DiscoveryRunReadOptions): Promise<DiscoveryRun[]>;
  saveRun(orgId: string, campaignId: string, run: DiscoveryRun): Promise<void>;
  listReviews(orgId: string, campaignId: string, providerChannelIds?: string[]): Promise<DiscoveryReviewRecord[]>;
  listPriorReviews(orgId: string, campaignId: string, providerChannelIds: string[], limit?: number): Promise<DiscoveryReviewRecord[]>;
  saveReview(input: SaveDiscoveryReviewInput): Promise<DiscoveryReviewRecord>;
}

export type DiscoveryReviewRecord = DiscoveryReview & {
  id: string;
  org_id: string;
  campaign_id: string;
  provider: string;
  provider_channel_id: string;
  promoted_lead_id: string | null;
  promotion_outcome: "created" | "existing" | null;
  promoted_evidence: DiscoveryPromotionEvidence[];
};

export type SaveDiscoveryReviewInput = {
  orgId: string;
  campaignId: string;
  provider: string;
  providerChannelId: string;
  nextState: DiscoveryReviewState;
  reason: DiscoveryRejectionReason | null;
  actorUserId: string;
  expectedRevision: number;
  decidedAt: string;
  promotedLeadId?: string | null;
  promotionOutcome?: "created" | "existing" | null;
  promotedEvidence?: DiscoveryPromotionEvidence[];
};

export type PromotionInput = {
  campaignId: string;
  channel: Pick<DiscoveryChannel, "provider_channel_id" | "title" | "url">;
  evidence: DiscoveryPromotionEvidence[];
};
export type PromotionResult = { leadId: string; outcome: "created" | "existing" };

type Search = typeof searchYouTubeCreatorCandidates;
type Dependencies = {
  loadContext: (orgId: string, campaignId: string) => Promise<CampaignDiscoveryContext | null>;
  repository: CampaignDiscoveryRepository;
  search: Search;
  now: () => Date;
  createId: () => string;
  promoteLead: (orgId: string, input: PromotionInput) => Promise<PromotionResult>;
  promoteReview: (input: SaveDiscoveryReviewInput & { promotion: PromotionInput }) => Promise<DiscoveryReviewRecord>;
  atomicPromotion: boolean;
  actorUserId?: string | null;
};

export async function loadCampaignDiscoveryWorkspace(
  orgId: string,
  campaignId: string,
  dependencies: Partial<Dependencies> = {},
  readOptions: DiscoveryReadOptions = {},
) {
  const deps = resolveDependencies(dependencies);
  const context = await deps.loadContext(orgId, campaignId);
  if (!context) throw new NotFoundError("Campaign not found");
  const runLimit = readOptions.runLimit;
  const candidateLimit = readOptions.candidateLimit;
  const evidenceLimit = readOptions.evidenceLimit;
  const queries = buildQueryPreview(context);
  const available = Boolean(context.artist_name && context.release_title && queries.length);
  // Native callers request one sentinel item in each JSON array. Drop sentinels
  // before classification so bounded reads never score an unbounded run payload.
  const persistedRunPage = await deps.repository.listRuns(orgId, campaignId, {
    cursor: readOptions.cursor,
    runLimit: runLimit === undefined ? undefined : runLimit + 1,
    candidateLimit: candidateLimit === undefined ? undefined : candidateLimit + 1,
    evidenceLimit: evidenceLimit === undefined ? undefined : evidenceLimit + 1,
  });
  const hasMoreRuns = runLimit !== undefined && persistedRunPage.length > runLimit;
  const persistedRuns = runLimit === undefined ? persistedRunPage : persistedRunPage.slice(0, runLimit);
  const selectedRuns = persistedRuns.map((run) => ({
    ...run,
    channels: candidateLimit === undefined ? run.channels : run.channels.slice(0, candidateLimit),
  }));
  const channelIds = [...new Set(selectedRuns.flatMap((run) => run.channels.map(({ provider_channel_id }) => provider_channel_id)))];
  const reviewRecords = await deps.repository.listReviews(orgId, campaignId, channelIds);
  const reviewByChannel = new Map(reviewRecords.map((review) => [`${review.provider}:${review.provider_channel_id}`, review]));
  const priorLimit = 100;
  const priorRecordPage = await deps.repository.listPriorReviews(orgId, campaignId, channelIds, priorLimit + 1);
  const priorRecords = priorRecordPage.slice(0, priorLimit);
  const priorByChannel = new Map<string, DiscoveryReviewRecord[]>();
  for (const review of priorRecords) {
    const key = `${review.provider}:${review.provider_channel_id}`;
    priorByChannel.set(key, [...(priorByChannel.get(key) ?? []), review]);
  }
  const runs = selectedRuns.map((run, runIndex) => {
    const sourceRun = persistedRuns[runIndex]!;
    const classified = classifyPersistedRun(run, context, deps.now());
    const channels = classified.channels.map((channel) => {
      const limitedEvidence = evidenceLimit === undefined ? channel.evidence : channel.evidence.slice(0, evidenceLimit);
      return enrichReviewedChannel(
        { ...channel, evidence: limitedEvidence, exact_match_evidence: channel.exact_match_evidence.filter((item) => limitedEvidence.some(({ provider_item_id }) => provider_item_id === item.provider_item_id)) },
        reviewByChannel.get(`youtube:${channel.provider_channel_id}`),
        priorByChannel.get(`youtube:${channel.provider_channel_id}`) ?? [],
        priorRecordPage.length > priorLimit,
      );
    });
    return {
      ...classified,
      channels,
      exact_match_channels: channels.filter(({ exact_match_evidence }) => exact_match_evidence.length > 0),
      prospective_fit_channels: channels.filter(({ prospective_fit }) => prospective_fit.qualifies),
      truncation: candidateLimit === undefined && evidenceLimit === undefined ? undefined : {
        candidates: { returned: channels.length, total: null, truncated: candidateLimit !== undefined && sourceRun.channels.length > candidateLimit },
        evidence_limit: evidenceLimit ?? null,
        evidence_truncated: evidenceLimit !== undefined && sourceRun.channels.slice(0, candidateLimit ?? Infinity).some((channel) => channel.evidence.length > evidenceLimit),
      },
    };
  });
  return {
    availability: { available, reason: available ? null : "Link a release with an artist and tracks before running discovery." },
    query_preview: queries,
    estimated_cost_units: queries.filter((query) => query.enabled).length * YOUTUBE_DISCOVERY_QUERY_COST_UNITS,
    runs,
    page: runLimit === undefined ? undefined : {
      limit: runLimit,
      next_cursor: hasMoreRuns && runs.at(-1) ? Buffer.from(JSON.stringify({ created_at: runs.at(-1)!.created_at, id: runs.at(-1)!.id })).toString("base64url") : null,
      has_more: hasMoreRuns,
    },
  };
}

function classifyPersistedRun(run: DiscoveryRun, context: CampaignDiscoveryContext, now: Date): DiscoveryRun {
  const channels = run.channels.map((channel) => classifyChannel(channel, context, now))
    .sort((a, b) => b.relevance.total - a.relevance.total || a.title.localeCompare(b.title));
  return {
    ...run,
    channels,
    exact_match_channels: channels.filter(({ exact_match_evidence }) => exact_match_evidence.length > 0),
    prospective_fit_channels: channels.filter(({ prospective_fit }) => prospective_fit.qualifies),
  };
}

function defaultReview(
  priorCampaignDecisions: DiscoveryReview["prior_campaign_decisions"] = [],
  priorCampaignDecisionsTruncated = false,
): DiscoveryReview {
  return {
    state: "unreviewed",
    reason: null,
    actor_user_id: null,
    decided_at: null,
    revision: 0,
    history: [],
    promoted_lead_id: null,
    promotion_outcome: null,
    promoted_evidence: [],
    prior_campaign_decisions: priorCampaignDecisions,
    prior_campaign_decisions_truncated: priorCampaignDecisionsTruncated,
  };
}

function enrichReviewedChannel(
  channel: DiscoveryChannel,
  current: DiscoveryReviewRecord | undefined,
  prior: DiscoveryReviewRecord[],
  priorCampaignDecisionsTruncated = false,
): DiscoveryChannel {
  const priorCampaignDecisions = prior.map((review) => ({
    campaign_id: review.campaign_id,
    state: review.state,
    reason: review.reason,
    decided_at: review.decided_at,
  }));
  return {
    ...channel,
    review: current ? {
      state: current.state,
      reason: current.reason,
      actor_user_id: current.actor_user_id,
      decided_at: current.decided_at,
      revision: current.revision,
      history: current.history,
      promoted_lead_id: current.promoted_lead_id,
      promotion_outcome: current.promotion_outcome,
      promoted_evidence: current.promoted_evidence,
      prior_campaign_decisions: priorCampaignDecisions,
      prior_campaign_decisions_truncated: priorCampaignDecisionsTruncated,
    } : defaultReview(priorCampaignDecisions, priorCampaignDecisionsTruncated),
  };
}

export function executeCampaignDiscoveryCommand(
  orgId: string,
  campaignId: string,
  command: Extract<CampaignDiscoveryCommand, { type: "run" }>,
  dependencies?: Partial<Dependencies>,
  readOptions?: DiscoveryReadOptions,
): Promise<DiscoveryRun>;
export function executeCampaignDiscoveryCommand(
  orgId: string,
  campaignId: string,
  command: Exclude<CampaignDiscoveryCommand, { type: "run" }>,
  dependencies?: Partial<Dependencies>,
  readOptions?: DiscoveryReadOptions,
): Promise<DiscoveryReviewResponse>;
export async function executeCampaignDiscoveryCommand(
  orgId: string,
  campaignId: string,
  command: CampaignDiscoveryCommand,
  dependencies: Partial<Dependencies> = {},
  readOptions: DiscoveryReadOptions = {},
): Promise<DiscoveryRun | DiscoveryReviewResponse> {
  const deps = resolveDependencies(dependencies);
  const context = await deps.loadContext(orgId, campaignId);
  if (!context) throw new NotFoundError("Campaign not found");
  if (command.type !== "run") return executeReviewCommand(orgId, campaignId, command, deps, readOptions);
  if (!context.artist_name || !context.release_title) {
    throw new HttpError("Campaign discovery needs a linked release and artist", 409);
  }

  const submittedQueries = command.queries.map(({ query, enabled }) => ({ query: query.trim(), enabled }));
  const enabledQueries = submittedQueries.filter(({ enabled }) => enabled);
  if (!enabledQueries.length || submittedQueries.length > MAX_DISCOVERY_QUERY_COUNT) {
    throw new HttpError("Choose between 1 and 6 discovery queries", 400);
  }

  const retrievedAt = deps.now().toISOString();
  const outcomes: DiscoveryRun["queries"] = [];
  const channels = new Map<string, Pick<DiscoveryChannel, "provider_channel_id" | "title" | "url" | "evidence">>();

  for (const submitted of submittedQueries) {
    const query = submitted.query;
    if (!submitted.enabled) {
      outcomes.push({ query, enabled: false, status: "disabled", error: null });
      continue;
    }
    try {
      const result = await deps.search(orgId, campaignId, { query, max_results: 10 });
      outcomes.push({ query, enabled: true, status: "completed", error: null });
      for (const candidate of result.candidates) {
        const channel = channels.get(candidate.channel_id) ?? {
          provider_channel_id: candidate.channel_id,
          title: candidate.channel_title,
          url: candidate.channel_url,
          evidence: [],
        };
        channel.evidence.push(...candidate.evidence.map((evidence) => ({
          provider_item_id: evidence.video_id,
          provider: "youtube_data_api_v3" as const,
          query,
          title: evidence.title,
          url: evidence.url,
          published_at: evidence.published_at,
          retrieved_at: result.source.retrieved_at,
        })));
        channels.set(candidate.channel_id, channel);
      }
    } catch (error) {
      outcomes.push({ query, enabled: true, status: "failed", error: safeQueryFailure(error) });
    }
  }

  const executedOutcomes = outcomes.filter(({ status }) => status !== "disabled");
  const completed = executedOutcomes.filter(({ status }) => status === "completed").length;
  const classifiedChannels = [...channels.values()]
    .map((channel) => classifyChannel(channel, context, deps.now()))
    .sort((a, b) => b.relevance.total - a.relevance.total || a.title.localeCompare(b.title));
  const run: DiscoveryRun = {
    id: deps.createId(),
    status: completed === executedOutcomes.length ? "completed" : completed ? "partial" : "failed",
    created_at: retrievedAt,
    estimated_cost_units: enabledQueries.length * YOUTUBE_DISCOVERY_QUERY_COST_UNITS,
    queries: outcomes,
    channels: classifiedChannels,
    exact_match_channels: classifiedChannels.filter(({ exact_match_evidence }) => exact_match_evidence.length > 0),
    prospective_fit_channels: classifiedChannels.filter(({ prospective_fit }) => prospective_fit.qualifies),
  };
  await deps.repository.saveRun(orgId, campaignId, run);
  return run;
}

async function executeReviewCommand(
  orgId: string,
  campaignId: string,
  command: Exclude<CampaignDiscoveryCommand, { type: "run" }>,
  deps: Dependencies,
  readOptions: DiscoveryReadOptions,
) {
  if (!deps.actorUserId) throw new HttpError("Authenticated review actor is required", 401);
  const runs = await deps.repository.listRuns(orgId, campaignId, {
    providerChannelId: command.channel_id, runLimit: 1, candidateLimit: 1,
    evidenceLimit: 10, evidenceIds: command.type === "promote" ? command.evidence_ids : [],
  });
  const channel = runs.flatMap((run) => run.channels).find(({ provider_channel_id }) => provider_channel_id === command.channel_id);
  if (!channel) throw new NotFoundError("Discovery candidate not found");
  const current = (await deps.repository.listReviews(orgId, campaignId, [command.channel_id])).find((review) => (
    review.provider === "youtube" && review.provider_channel_id === command.channel_id
  ));
  const currentState = current?.state ?? "unreviewed";
  if (current && current.revision !== command.expected_revision) throw new HttpError("Discovery candidate changed; reload before reviewing", 409);
  if (!current && command.expected_revision !== 0) throw new HttpError("Discovery candidate changed; reload before reviewing", 409);
  if (command.type === "reconsider" && currentState !== "rejected") throw new HttpError("Only rejected candidates can be reconsidered", 409);
  if (currentState === "promoted" && command.type !== "promote") throw new HttpError("Promoted candidates cannot be moved backwards", 409);
  if (command.type === "promote" && currentState !== "shortlisted" && currentState !== "promoted") throw new HttpError("Only shortlisted candidates can be promoted", 409);
  let promotion: PromotionResult | null = null;
  let promotedEvidence: DiscoveryPromotionEvidence[] = [];
  if (command.type === "promote") {
    const evidenceById = new Map(channel.evidence.map((evidence) => [evidence.provider_item_id, evidence]));
    promotedEvidence = command.evidence_ids.map((id) => evidenceById.get(id)).filter((evidence): evidence is DiscoveryPromotionEvidence => Boolean(evidence));
    if (promotedEvidence.length !== command.evidence_ids.length) throw new HttpError("Selected discovery evidence is no longer available", 409);
    if (!deps.atomicPromotion) promotion = await deps.promoteLead(orgId, {
      campaignId,
      channel: {
        provider_channel_id: channel.provider_channel_id,
        title: channel.title,
        url: channel.url,
      },
      evidence: promotedEvidence,
    });
  }
  const nextState: DiscoveryReviewState = command.type === "shortlist"
    ? "shortlisted"
    : command.type === "reject" ? "rejected" : command.type === "promote" ? "promoted" : "unreviewed";
  const reviewInput: SaveDiscoveryReviewInput = {
    orgId,
    campaignId,
    provider: "youtube",
    providerChannelId: channel.provider_channel_id,
    nextState,
    reason: command.type === "reject" ? command.reason : null,
    actorUserId: deps.actorUserId,
    expectedRevision: command.expected_revision,
    decidedAt: deps.now().toISOString(),
    promotedLeadId: promotion?.leadId ?? null,
    promotionOutcome: promotion?.outcome ?? null,
    promotedEvidence,
  };
  const saved = command.type === "promote" && deps.atomicPromotion
    ? await deps.promoteReview({
      ...reviewInput,
      promotion: {
        campaignId,
        channel: { provider_channel_id: channel.provider_channel_id, title: channel.title, url: channel.url },
        evidence: promotedEvidence,
      },
    })
    : await deps.repository.saveReview(reviewInput);
  const workspace = await loadCampaignDiscoveryWorkspace(orgId, campaignId, deps, readOptions);
  return {
    ...workspace,
    reviewed_channel_id: command.channel_id,
    review: { ...saved, prior_campaign_decisions: [] },
  };
}

function classifyChannel(
  channel: Pick<DiscoveryChannel, "provider_channel_id" | "title" | "url" | "evidence">,
  context: CampaignDiscoveryContext,
  now: Date,
): DiscoveryChannel {
  const exactMatchEvidence = channel.evidence.filter((evidence) => isExactMatch(evidence.title, context));
  const evidence = [...channel.evidence].sort((left, right) => {
    const exactDifference = Number(isExactMatch(right.title, context)) - Number(isExactMatch(left.title, context));
    return exactDifference || Date.parse(right.published_at) - Date.parse(left.published_at);
  });
  const latestActivity = evidence.reduce<string | null>((latest, item) => (
    !latest || Date.parse(item.published_at) > Date.parse(latest) ? item.published_at : latest
  ), null);
  const recent = Boolean(latestActivity && now.getTime() - Date.parse(latestActivity) <= 365 * 24 * 60 * 60 * 1000);
  const allTitles = evidence.map(({ title }) => normalize(title)).join(" ");
  const signals: DiscoveryChannel["prospective_fit"]["signals"] = [];
  if (/\b(premiere|mix|review|session|playlist|radio|dj set)\b/.test(allTitles)) signals.push("matching_content_format");
  if (recent) signals.push("recent_relevant_activity");
  if (matchesRelatedMusicalLanguage(allTitles, context)) signals.push("musical_editorial_compatibility");
  const qualifies = !isArtistOwnedChannel(channel.title, context.artist_name) && signals.length >= 2;
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  const relevance = {
    exactness: exactMatchEvidence.length ? 1 : 0,
    editorial_fit: qualifies ? 1 : 0,
    activity: recent ? 1 : 0,
    evidence_strength: Math.min(evidence.length, 3),
    total: 0,
  };
  relevance.total = relevance.exactness * 4 + relevance.editorial_fit * 2 + relevance.activity + relevance.evidence_strength;
  return {
    ...channel,
    evidence,
    exact_match_evidence: evidence.filter((item) => exactMatchEvidence.some(({ provider_item_id }) => provider_item_id === item.provider_item_id)),
    prospective_fit: { qualifies, signals },
    activity_freshness: { state: recent ? "fresh" : "stale", latest_activity_at: latestActivity, expires_at: expiresAt },
    relevance,
    review: defaultReview(),
  };
}

function isExactMatch(title: string, context: CampaignDiscoveryContext) {
  const normalizedTitle = normalize(title);
  const artist = normalize(context.artist_name ?? "");
  if (!artist || !containsPhrase(normalizedTitle, artist)) return false;
  return context.tracks.some((track) => {
    const normalizedTrack = normalize(track);
    const distinctiveTrack = normalizedTrack.replace(/\b(edit|remix|version|mix)\b/g, "").replace(/\s+/g, " ").trim();
    return distinctiveTrack !== artist && distinctiveTrack.length > 2 && containsPhrase(normalizedTitle, normalizedTrack);
  });
}

function matchesRelatedMusicalLanguage(titles: string, context: CampaignDiscoveryContext) {
  const terms = [context.artist_name, ...context.tracks]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => normalize(value).split(" "))
    .filter((value) => value.length > 4 && !["fountain", "edits", "original", "tracks"].includes(value));
  return terms.some((term) => containsPhrase(titles, term));
}

function normalize(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function containsPhrase(haystack: string, needle: string) {
  return (` ${haystack} `).includes(` ${needle} `);
}

function isArtistOwnedChannel(channelTitle: string, artistName: string | null) {
  const channel = normalize(channelTitle);
  const artist = normalize(artistName ?? "");
  if (!artist) return false;
  return channel === artist
    || channel === `${artist} topic`
    || channel === `${artist} official`
    || channel === `${artist} official artist channel`;
}

function buildQueryPreview(context: CampaignDiscoveryContext) {
  if (!context.artist_name || !context.release_title) return [];
  const candidates = [
    ...context.tracks,
    [context.release_title, context.goal].filter(Boolean).join(" "),
  ].filter((subject): subject is string => Boolean(subject?.trim()));
  return [...new Set(candidates.map((subject) => (
    `${context.artist_name} ${subject} premiere|review|radio -Topic`
  )))]
    .slice(0, DEFAULT_DISCOVERY_QUERY_COUNT)
    .map((query) => ({
    query: query.slice(0, 200),
    enabled: true,
    editable: true,
  }));
}

function safeQueryFailure(error: unknown) {
  if (error instanceof HttpError && error.status === 429) return "YouTube quota is exhausted";
  return "YouTube search was temporarily unavailable";
}

function resolveDependencies(dependencies: Partial<Dependencies>): Dependencies {
  return {
    loadContext: dependencies.loadContext ?? defaultLoadContext,
    repository: dependencies.repository ?? defaultRepository,
    search: dependencies.search ?? searchYouTubeCreatorCandidates,
    now: dependencies.now ?? (() => new Date()),
    createId: dependencies.createId ?? (() => `discovery_run_${crypto.randomUUID()}`),
    promoteLead: dependencies.promoteLead ?? defaultPromoteLead,
    promoteReview: dependencies.promoteReview ?? defaultPromoteReview,
    atomicPromotion: !dependencies.promoteLead && !dependencies.repository,
    actorUserId: dependencies.actorUserId ?? null,
  };
}

async function defaultLoadContext(orgId: string, campaignId: string): Promise<CampaignDiscoveryContext | null> {
  const { loadCampaignDiscoveryContext } = await import("./campaign-discovery-db");
  return loadCampaignDiscoveryContext(orgId, campaignId);
}

async function defaultPromoteLead(orgId: string, input: PromotionInput): Promise<PromotionResult> {
  const { promoteCampaignDiscoveryLead } = await import("./campaign-discovery-db");
  return promoteCampaignDiscoveryLead(orgId, input);
}

async function defaultPromoteReview(input: SaveDiscoveryReviewInput & { promotion: PromotionInput }): Promise<DiscoveryReviewRecord> {
  const { promoteAndSaveCampaignDiscoveryReview } = await import("./campaign-discovery-db");
  return promoteAndSaveCampaignDiscoveryReview(input);
}

const defaultRepository: CampaignDiscoveryRepository = {
  async listRuns(orgId, campaignId, options) {
    const { listCampaignDiscoveryRuns } = await import("./campaign-discovery-db");
    return listCampaignDiscoveryRuns(orgId, campaignId, options);
  },
  async saveRun(orgId, campaignId, run) {
    const { saveCampaignDiscoveryRun } = await import("./campaign-discovery-db");
    await saveCampaignDiscoveryRun(orgId, campaignId, run);
  },
  async listReviews(orgId, campaignId, providerChannelIds) {
    const { listCampaignDiscoveryReviews } = await import("./campaign-discovery-db");
    return listCampaignDiscoveryReviews(orgId, campaignId, providerChannelIds);
  },
  async listPriorReviews(orgId, campaignId, providerChannelIds, limit) {
    const { listPriorCampaignDiscoveryReviews } = await import("./campaign-discovery-db");
    return listPriorCampaignDiscoveryReviews(orgId, campaignId, providerChannelIds, limit);
  },
  async saveReview(input) {
    const { saveCampaignDiscoveryReview } = await import("./campaign-discovery-db");
    return saveCampaignDiscoveryReview(input);
  },
};
