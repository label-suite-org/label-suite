import { describe, expect, it, vi } from "vitest";
import {
  executeCampaignDiscoveryCommand,
  loadCampaignDiscoveryWorkspace,
  type DiscoveryReviewRecord,
  type CampaignDiscoveryRepository,
} from "./campaign-discovery";

function memoryRepository(): CampaignDiscoveryRepository {
  const runs: Array<any> = [];
  const reviews: DiscoveryReviewRecord[] = [];
  return {
    listRuns: vi.fn(async () => runs),
    saveRun: vi.fn(async (_orgId, _campaignId, run) => { runs.unshift(run); }),
    listReviews: vi.fn(async (orgId, campaignId) => reviews.filter((review) => review.org_id === orgId && review.campaign_id === campaignId)),
    listPriorReviews: vi.fn(async (orgId, campaignId, providerChannelIds) => reviews.filter((review) => review.org_id === orgId && providerChannelIds.includes(review.provider_channel_id) && review.campaign_id !== campaignId)),
    saveReview: vi.fn(async (input) => {
      const existing = reviews.find((review) => review.org_id === input.orgId && review.campaign_id === input.campaignId && review.provider === input.provider && review.provider_channel_id === input.providerChannelId);
      if (existing && existing.revision !== input.expectedRevision) throw new Error("stale");
      const next = {
        id: existing?.id ?? "review-1", org_id: input.orgId, campaign_id: input.campaignId, provider: input.provider, provider_channel_id: input.providerChannelId,
        state: input.nextState, reason: input.reason, actor_user_id: input.actorUserId, decided_at: input.decidedAt, revision: input.expectedRevision + 1,
        promoted_lead_id: input.promotedLeadId ?? null, promotion_outcome: input.promotionOutcome ?? null, promoted_evidence: input.promotedEvidence ?? [],
        history: [...(existing?.history ?? []), { state: input.nextState, reason: input.reason, actor_user_id: input.actorUserId, decided_at: input.decidedAt, revision: input.expectedRevision + 1, promoted_lead_id: input.promotedLeadId ?? null, promotion_outcome: input.promotionOutcome ?? null, promoted_evidence: input.promotedEvidence ?? [] }], prior_campaign_decisions: [],
      } as DiscoveryReviewRecord;
      if (existing) reviews[reviews.indexOf(existing)] = next; else reviews.push(next);
      return next;
    }),
  };
}

const context = {
  id: "campaign-1",
  campaign_name: "Fountain Edits pilot",
  artist_name: "Fountain",
  release_title: "Fountain Edits",
  goal: "Find YouTube channels already supporting the original tracks",
  tracks: ["Fountain (Edit)", "Cascade (Edit)", "Spring (Edit)", "Source (Edit)"],
};

const fountainContext = {
  id: "campaign-fountain",
  campaign_name: "Fountain Edits",
  artist_name: "True Blue",
  release_title: "Fountain Edits",
  goal: "Find independent editorial support",
  tracks: [
    "Fountain (Make it Known) - Former Actress Edit",
    "Fountain - DJ Python Remix",
    "Fountain - Harmony Index edit",
    "Fountain - Vanessa Amara Edit",
    "Proof She's Picked Her Poison",
  ],
};

describe("campaign discovery workspace", () => {
  it("previews four bounded track-first searches in canonical release order", async () => {
    const repository = memoryRepository();

    const workspace = await loadCampaignDiscoveryWorkspace("org-1", "campaign-1", {
      loadContext: vi.fn(async () => fountainContext),
      repository,
    });

    expect(workspace.availability).toEqual({ available: true, reason: null });
    expect(workspace.query_preview).toHaveLength(4);
    expect(workspace.query_preview.map(({ query }) => query)).toEqual([
      "True Blue Fountain (Make it Known) - Former Actress Edit premiere|review|radio -Topic",
      "True Blue Fountain - DJ Python Remix premiere|review|radio -Topic",
      "True Blue Fountain - Harmony Index edit premiere|review|radio -Topic",
      "True Blue Fountain - Vanessa Amara Edit premiere|review|radio -Topic",
    ]);
    expect(workspace.query_preview.every(({ enabled, editable }) => enabled && editable)).toBe(true);
    expect(workspace.estimated_cost_units).toBe(400);
    expect(workspace.runs).toEqual([]);
  });

  it("does not qualify the campaign artist's own Topic channel as prospective fit", async () => {
    const repository = memoryRepository();
    const search = vi.fn().mockResolvedValue({
      source: { provider: "youtube_data_api_v3", query: "True Blue Fountain Edits", retrieved_at: "2026-08-27T12:00:00.000Z" },
      candidates: [{
        channel_id: "true-blue-topic",
        channel_title: "True Blue - Topic",
        channel_url: "https://www.youtube.com/channel/true-blue-topic",
        evidence: [{ video_id: "official", title: "Fountain - DJ Python Remix", url: "https://youtube.test/official", published_at: "2026-08-27T10:00:00.000Z" }],
      }],
    });

    const run = await executeCampaignDiscoveryCommand("org-1", "campaign-fountain", {
      type: "run",
      queries: [{ query: "True Blue Fountain - DJ Python Remix", enabled: true }],
    }, {
      loadContext: vi.fn(async () => fountainContext), repository, search,
      now: () => new Date("2026-08-27T12:00:00.000Z"), createId: () => "run-owned-channel",
    });

    expect(run.channels[0].prospective_fit.qualifies).toBe(false);
    expect(run.prospective_fit_channels).toEqual([]);
  });

  it("keeps successful evidence when another immutable query fails", async () => {
    const repository = memoryRepository();
    const search = vi.fn()
      .mockResolvedValueOnce({
        source: { provider: "youtube_data_api_v3", query: "Fountain Fountain (Edit)", retrieved_at: "2026-08-15T12:00:00.000Z" },
        candidates: [{
          channel_id: "channel-1",
          channel_title: "Selectors",
          channel_url: "https://www.youtube.com/channel/channel-1",
          evidence: [{ video_id: "video-1", title: "Fountain edit premiere", url: "https://www.youtube.com/watch?v=video-1", published_at: "2026-08-01T10:00:00.000Z" }],
        }],
      })
      .mockRejectedValueOnce(new Error("quota"));

    const run = await executeCampaignDiscoveryCommand("org-1", "campaign-1", {
      type: "run",
      queries: [
        { query: "Fountain Fountain (Edit)", enabled: true },
        { query: "Fountain Cascade (Edit)", enabled: true },
        { query: "Fountain Spring (Edit)", enabled: false },
      ],
    }, {
      loadContext: vi.fn(async () => context),
      repository,
      search,
      now: () => new Date("2026-08-15T12:00:00.000Z"),
      createId: () => "run-1",
    });

    expect(run.status).toBe("partial");
    expect(run.queries.map(({ query }) => query)).toEqual([
      "Fountain Fountain (Edit)",
      "Fountain Cascade (Edit)",
      "Fountain Spring (Edit)",
    ]);
    expect(run.queries[2]).toMatchObject({ enabled: false, status: "disabled" });
    expect(run.channels).toHaveLength(1);
    expect(run.channels[0].evidence[0]).toMatchObject({
      query: "Fountain Fountain (Edit)",
      provider: "youtube_data_api_v3",
      title: "Fountain edit premiere",
    });
    expect((await repository.listRuns("org-1", "campaign-1"))[0]).toEqual(run);
  });

  it("separates exact edits from explainable prospective fit and orders strongest evidence first", async () => {
    const repository = memoryRepository();
    const search = vi.fn().mockResolvedValue({
      source: { provider: "youtube_data_api_v3", query: "Fountain edits", retrieved_at: "2026-08-15T12:00:00.000Z" },
      candidates: [
        {
          channel_id: "exact",
          channel_title: "Exact selector",
          channel_url: "https://www.youtube.com/channel/exact",
          evidence: [
            { video_id: "ambiguous", title: "Fountain edit premiere", url: "https://youtube.test/ambiguous", published_at: "2026-08-10T00:00:00.000Z" },
            { video_id: "exact-edit", title: "Fountain — Cascade (Edit) premiere", url: "https://youtube.test/exact", published_at: "2026-08-12T00:00:00.000Z" },
          ],
        },
        {
          channel_id: "prospect",
          channel_title: "Fresh mixes",
          channel_url: "https://www.youtube.com/channel/prospect",
          evidence: [{ video_id: "mix", title: "New ambient electronic guest mix", url: "https://youtube.test/mix", published_at: "2026-08-14T00:00:00.000Z" }],
        },
        {
          channel_id: "stale",
          channel_title: "Old mixes",
          channel_url: "https://www.youtube.com/channel/stale",
          evidence: [{ video_id: "old", title: "Ambient guest mix", url: "https://youtube.test/old", published_at: "2023-01-01T00:00:00.000Z" }],
        },
      ],
    });

    const run = await executeCampaignDiscoveryCommand("org-1", "campaign-1", {
      type: "run",
      queries: [{ query: "Fountain edits", enabled: true }],
    }, {
      loadContext: vi.fn(async () => context), repository, search,
      now: () => new Date("2026-08-15T12:00:00.000Z"), createId: () => "run-2",
    });

    const exact = run.channels.find(({ provider_channel_id }) => provider_channel_id === "exact")!;
    expect(exact.evidence.map(({ provider_item_id }) => provider_item_id)).toEqual(["exact-edit", "ambiguous"]);
    expect(exact.exact_match_evidence.map(({ provider_item_id }) => provider_item_id)).toEqual(["exact-edit"]);
    expect(exact.relevance).toMatchObject({ exactness: 1, editorial_fit: 1, activity: 1, evidence_strength: 2 });
    expect(run.exact_match_channels.map(({ provider_channel_id }) => provider_channel_id)).toEqual(["exact"]);

    const prospect = run.channels.find(({ provider_channel_id }) => provider_channel_id === "prospect")!;
    expect(prospect.prospective_fit.signals).toEqual(["matching_content_format", "recent_relevant_activity"]);
    expect(prospect.prospective_fit.qualifies).toBe(true);
    expect(run.prospective_fit_channels.map(({ provider_channel_id }) => provider_channel_id)).toEqual(["exact", "prospect"]);

    const stale = run.channels.find(({ provider_channel_id }) => provider_channel_id === "stale")!;
    expect(stale.activity_freshness.state).toBe("stale");
    expect(stale.prospective_fit.qualifies).toBe(false);
    expect(run).not.toHaveProperty("relationship_warmth");
    expect(run).not.toHaveProperty("outreach_priority");
  });

  it("retains bounded review history, hides rejected candidates by default, and rejects stale decisions", async () => {
    const repository = memoryRepository();
    const search = vi.fn().mockResolvedValue({
      source: { provider: "youtube_data_api_v3", query: "Fountain edits", retrieved_at: "2026-08-15T12:00:00.000Z" },
      candidates: [{ channel_id: "channel-1", channel_title: "Selectors", channel_url: "https://youtube.test/channel-1", evidence: [{ video_id: "video-1", title: "Fountain — Cascade (Edit)", url: "https://youtube.test/video-1", published_at: "2026-08-15T10:00:00.000Z" }] }],
    });
    await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "run", queries: [{ query: "Fountain edits", enabled: true }] }, { loadContext: vi.fn(async () => context), repository, search, actorUserId: "operator-1", now: () => new Date("2026-08-15T12:00:00.000Z"), createId: () => "run-review" });
    const reviewed = await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "reject", channel_id: "channel-1", expected_revision: 0, reason: "wrong_format" }, { loadContext: vi.fn(async () => context), repository, actorUserId: "operator-1", now: () => new Date("2026-08-15T12:01:00.000Z") });
    expect(reviewed.review).toMatchObject({ state: "rejected", reason: "wrong_format", revision: 1 });
    const hidden = await loadCampaignDiscoveryWorkspace("org-1", "campaign-1", { loadContext: vi.fn(async () => context), repository });
    expect(hidden.runs[0].channels[0].review.history).toHaveLength(1);
    expect(hidden.runs[0].channels[0].review.actor_user_id).toBe("operator-1");
    await expect(executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "shortlist", channel_id: "channel-1", expected_revision: 0 }, { loadContext: vi.fn(async () => context), repository, actorUserId: "operator-1" })).rejects.toThrow("changed");
    const reconsidered = await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "reconsider", channel_id: "channel-1", expected_revision: 1 }, { loadContext: vi.fn(async () => context), repository, actorUserId: "operator-1", now: () => new Date("2026-08-15T12:02:00.000Z") });
    expect(reconsidered.review).toMatchObject({ state: "unreviewed", revision: 2 });
    expect(reconsidered.review.history).toHaveLength(2);
  });

  it("promotes only shortlisted candidates, retains selected evidence, and is idempotent", async () => {
    const repository = memoryRepository();
    const search = vi.fn().mockResolvedValue({
      source: { provider: "youtube_data_api_v3", query: "Fountain edits", retrieved_at: "2026-08-15T12:00:00.000Z" },
      candidates: [{ channel_id: "channel-1", channel_title: "Selectors", channel_url: "https://youtube.test/channel-1", evidence: [
        { video_id: "video-1", title: "Fountain — Cascade (Edit)", url: "https://youtube.test/video-1", published_at: "2026-08-15T10:00:00.000Z" },
        { video_id: "video-2", title: "Fountain guest mix", url: "https://youtube.test/video-2", published_at: "2026-08-14T10:00:00.000Z" },
      ] }],
    });
    const promoteLead = vi.fn()
      .mockResolvedValueOnce({ leadId: "lead-1", outcome: "created" })
      .mockResolvedValueOnce({ leadId: "lead-1", outcome: "existing" });
    const dependencies = { loadContext: vi.fn(async () => context), repository, search, actorUserId: "operator-1", promoteLead, now: () => new Date("2026-08-15T12:00:00.000Z"), createId: () => "run-promote" };
    await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "run", queries: [{ query: "Fountain edits", enabled: true }] }, dependencies);
    await expect(executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "promote", channel_id: "channel-1", expected_revision: 0, evidence_ids: ["video-1"] }, dependencies)).rejects.toThrow("Only shortlisted");
    await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "shortlist", channel_id: "channel-1", expected_revision: 0 }, dependencies);
    const promoted = await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "promote", channel_id: "channel-1", expected_revision: 1, evidence_ids: ["video-1"] }, dependencies);
    expect(promoted.review).toMatchObject({ state: "promoted", promoted_lead_id: "lead-1", promotion_outcome: "created" });
    expect(promoted.review.promoted_evidence).toHaveLength(1);
    expect(repository.listRuns).toHaveBeenCalledWith("org-1", "campaign-1", {
      providerChannelId: "channel-1", runLimit: 1, candidateLimit: 1, evidenceLimit: 10, evidenceIds: ["video-1"],
    });
    expect(repository.listReviews).toHaveBeenCalledWith("org-1", "campaign-1", ["channel-1"]);
    const repeated = await executeCampaignDiscoveryCommand("org-1", "campaign-1", { type: "promote", channel_id: "channel-1", expected_revision: 2, evidence_ids: ["video-1"] }, dependencies);
    expect(repeated.review).toMatchObject({ state: "promoted", promoted_lead_id: "lead-1", promotion_outcome: "existing" });
    expect(promoteLead).toHaveBeenCalledTimes(2);
  });

  it("keeps web reads unbounded unless the caller explicitly supplies read limits", async () => {
    const repository = memoryRepository();
    const listRuns = vi.spyOn(repository, "listRuns");
    await loadCampaignDiscoveryWorkspace("org-1", "campaign-1", { loadContext: vi.fn(async () => context), repository });
    expect(listRuns).toHaveBeenCalledWith("org-1", "campaign-1", {
      cursor: undefined, runLimit: undefined, candidateLimit: undefined, evidenceLimit: undefined,
    });
  });

  it("caps raw candidates and evidence before classification and only reads reviews for selected ids", async () => {
    const selected = {
      provider_channel_id: "selected", title: "Selectors", url: "https://youtube.test/selected",
      evidence: [{ provider_item_id: "selected-1", provider: "youtube_data_api_v3" as const, query: "q", title: "Fountain — Cascade (Edit)", url: "https://youtube.test/selected-1", published_at: "2026-08-15T10:00:00.000Z", retrieved_at: "2026-08-15T12:00:00.000Z" }],
    };
    const repository: CampaignDiscoveryRepository = {
      listRuns: vi.fn(async () => ([{ id: "run-1", status: "completed" as const, created_at: "2026-08-15T12:00:00.000Z", estimated_cost_units: 100, queries: [], channels: [selected, { provider_channel_id: "discarded", title: "Discarded", url: "https://youtube.test/discarded", evidence: [{ ...selected.evidence[0], provider_item_id: "bad", title: null }] as any }], exact_match_channels: [], prospective_fit_channels: [] }] as any)),
      listReviews: vi.fn(async () => []), listPriorReviews: vi.fn(async () => []), saveRun: vi.fn(), saveReview: vi.fn(),
    };

    const workspace = await loadCampaignDiscoveryWorkspace("org-1", "campaign-1", { loadContext: vi.fn(async () => context), repository }, { candidateLimit: 1, evidenceLimit: 1 });
    expect(workspace.runs[0].channels.map(({ provider_channel_id }) => provider_channel_id)).toEqual(["selected"]);
    expect(workspace.runs[0].truncation).toMatchObject({ candidates: { returned: 1, total: null, truncated: true } });
    expect(repository.listReviews).toHaveBeenCalledWith("org-1", "campaign-1", ["selected"]);
  });

  it("emits an opaque timestamp-and-id cursor so equal timestamps do not skip a run", async () => {
    const repository = memoryRepository();
    const runs = await repository.listRuns("org-1", "campaign-1");
    runs.push(...["run-c", "run-b", "run-a"].map((id) => ({ id, status: "completed" as const, created_at: "2026-08-15T12:00:00.000Z", estimated_cost_units: 100, queries: [], channels: [], exact_match_channels: [], prospective_fit_channels: [] })));
    const first = await loadCampaignDiscoveryWorkspace("org-1", "campaign-1", { loadContext: vi.fn(async () => context), repository }, { runLimit: 2 });
    const cursor = first.page!.next_cursor!;
    expect(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))).toEqual({ created_at: "2026-08-15T12:00:00.000Z", id: "run-b" });
  });
});
