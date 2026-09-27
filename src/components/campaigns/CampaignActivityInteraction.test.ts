import { describe, expect, test } from "vitest";
import type { CampaignActivitySnapshot } from "../../server/campaign-activity-core";
import {
  createCampaignActivityInteraction,
  createCampaignActivityHttpAdapter,
  createInMemoryCampaignActivityAdapter,
} from "./CampaignActivityInteraction";

describe("Campaign Activity interaction", () => {
  test("keeps the newest overlapping decision snapshot, feedback, and control lock", async () => {
    const older = deferred<CampaignActivitySnapshot>();
    const newer = deferred<CampaignActivitySnapshot>();
    const adapter = createInMemoryCampaignActivityAdapter({
      decisionResults: [older.promise, newer.promise],
    });
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter,
    });

    const first = interaction.decide(decision("proposal-old"));
    const second = interaction.decide(decision("proposal-new"));

    expect(adapter.decisions.map((input) => input.proposal_key)).toEqual(["proposal-old", "proposal-new"]);
    expect(interaction.getState().pending).toBe(true);

    newer.resolve(activitySnapshot("Newest Activity"));
    await expect(second).resolves.toBeUndefined();
    expect(interaction.getState()).toMatchObject({
      pending: false,
      feedback: "Recommendation dismissed.",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Newest Activity");

    older.reject(new Error("Older decision failed"));
    await expect(first).resolves.toBe("stale");
    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: null,
      feedback: "Recommendation dismissed.",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Newest Activity");
  });

  test("retains the last valid snapshot when Activity refresh fails after a successful primary mutation", async () => {
    const refresh = deferred<CampaignActivitySnapshot>();
    const adapter = createInMemoryCampaignActivityAdapter({
      refreshResults: [refresh.promise],
    });
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Last valid Activity"),
      adapter,
    });
    let contextRefreshes = 0;

    const result = interaction.beginWorkflow("stage").refreshAfterMutation({
      successNotice: "Stage overridden to qualified",
      refreshContext: async () => { contextRefreshes += 1; },
    });
    refresh.reject(new Error("Activity route unavailable"));
    await expect(result).resolves.toBe("failed");

    expect(contextRefreshes).toBe(1);
    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: "Stage overridden to qualified. Activity could not be refreshed",
      feedback: null,
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Last valid Activity");
  });

  test("rejects a malformed HTTP refresh without replacing the last valid snapshot", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const adapter = createCampaignActivityHttpAdapter({
      campaignId: "campaign-1",
      fetcher: async (input, init) => {
        requests.push({ url: String(input), method: String(init?.method) });
        return new Response(JSON.stringify({ items: [null], proposals: [], sourceStates: [] }), {
          headers: { "content-type": "application/json" },
        });
      },
    });
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Last valid Activity"),
      adapter,
    });

    await expect(interaction.beginWorkflow("stage").refreshAfterMutation({ successNotice: "Primary mutation saved" }))
      .resolves.toBe("failed");

    expect(requests).toEqual([{ url: "/api/campaigns/campaign-1/activity", method: "GET" }]);
    expect(interaction.getState().notice).toBe("Primary mutation saved. Activity could not be refreshed");
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Last valid Activity");
  });

  test("surfaces the current decision failure without replacing the last valid snapshot", async () => {
    const adapter = createCampaignActivityHttpAdapter({
      campaignId: "campaign-1",
      fetcher: async () => new Response(JSON.stringify({ error: "Newest PATCH failed" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    });
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Last valid Activity"),
      adapter,
    });

    await expect(interaction.decide(decision("proposal-1"))).rejects.toThrow("Newest PATCH failed");

    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: "Newest PATCH failed",
      feedback: "Could not record the recommendation decision.",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Last valid Activity");
  });

  test("notifies rendering subscribers for owned state transitions only", async () => {
    const settled = deferred<CampaignActivitySnapshot>();
    const adapter = createInMemoryCampaignActivityAdapter({ decisionResults: [settled.promise] });
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter,
    });
    const observed: Array<{ pending: boolean; title: string | undefined }> = [];
    const unsubscribe = interaction.subscribe(() => {
      const state = interaction.getState();
      observed.push({ pending: state.pending, title: state.snapshot.items[0]?.title });
    });

    const result = interaction.decide(decision("proposal-1"));
    settled.resolve(activitySnapshot("Settled Activity"));
    await result;

    expect(observed).toEqual([
      { pending: true, title: "Initial Activity" },
      { pending: false, title: "Settled Activity" },
    ]);

    unsubscribe();
  });

  test("prevents an older workflow from overwriting a newer notice or control lock", () => {
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter: createInMemoryCampaignActivityAdapter(),
    });

    const older = interaction.beginWorkflow("prompt");
    const newer = interaction.beginWorkflow("stage");

    older.setNotice("Older workflow completed");
    older.finish();
    expect(interaction.getState()).toMatchObject({
      busyAction: "stage",
      pending: true,
      notice: null,
    });

    newer.setNotice("Newest workflow completed");
    newer.finish();
    expect(interaction.getState()).toMatchObject({
      busyAction: null,
      pending: false,
      notice: "Newest workflow completed",
    });
  });

  test("keeps a newer refresh locked when an older decision settles", async () => {
    const decisionResult = deferred<CampaignActivitySnapshot>();
    const refreshResult = deferred<CampaignActivitySnapshot>();
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter: createInMemoryCampaignActivityAdapter({
        decisionResults: [decisionResult.promise],
        refreshResults: [refreshResult.promise],
      }),
    });

    const olderDecision = interaction.decide(decision("proposal-old"));
    const newerRefresh = interaction.beginWorkflow("stage").refreshAfterMutation({
      successNotice: "Stage overridden to qualified",
    });
    decisionResult.resolve(activitySnapshot("Stale decision Activity"));

    await expect(olderDecision).resolves.toBe("stale");
    expect(interaction.getState()).toMatchObject({ pending: true, busyAction: "stage" });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Initial Activity");

    refreshResult.resolve(activitySnapshot("Newest refresh Activity"));
    await expect(newerRefresh).resolves.toBe("updated");
    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: "Stage overridden to qualified",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Newest refresh Activity");
  });

  test("keeps a newer decision locked when an older refresh settles", async () => {
    const refreshResult = deferred<CampaignActivitySnapshot>();
    const decisionResult = deferred<CampaignActivitySnapshot>();
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter: createInMemoryCampaignActivityAdapter({
        refreshResults: [refreshResult.promise],
        decisionResults: [decisionResult.promise],
      }),
    });

    const olderRefresh = interaction.beginWorkflow("stage").refreshAfterMutation({
      successNotice: "Stage overridden to qualified",
    });
    const newerDecision = interaction.decide(decision("proposal-new"));
    refreshResult.resolve(activitySnapshot("Stale refresh Activity"));

    await expect(olderRefresh).resolves.toBe("stale");
    expect(interaction.getState()).toMatchObject({ pending: true, busyAction: "activity-decision" });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Initial Activity");

    decisionResult.resolve(activitySnapshot("Newest decision Activity"));
    await expect(newerDecision).resolves.toBeUndefined();
    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: null,
      feedback: "Recommendation dismissed.",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Newest decision Activity");
  });

  test("reports a failed base refresh after the Activity snapshot updates", async () => {
    const interaction = createCampaignActivityInteraction({
      initialSnapshot: activitySnapshot("Initial Activity"),
      adapter: createInMemoryCampaignActivityAdapter({
        refreshResults: [Promise.resolve(activitySnapshot("Updated Activity"))],
      }),
    });

    await expect(interaction.beginWorkflow("stage").refreshAfterMutation({
      successNotice: "Stage overridden to qualified",
      refreshContext: async () => { throw new Error("Lead context unavailable"); },
    })).resolves.toBe("updated");

    expect(interaction.getState()).toMatchObject({
      pending: false,
      notice: "Lead context could not be refreshed",
    });
    expect(interaction.getState().snapshot.items[0]?.title).toBe("Updated Activity");
  });
});

function decision(proposalKey: string) {
  return { proposal_key: proposalKey, decision: "dismissed" as const, reason: null };
}

function activitySnapshot(title: string): CampaignActivitySnapshot {
  return {
    items: [{
      key: `event:${title}`,
      category: "research",
      kind: "research_completed",
      occurredAt: new Date("2026-08-12T10:00:00.000Z"),
      title,
      summary: null,
      actor: { kind: "system", id: null, label: null },
      refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: null, draftId: null },
      evidence: [],
      source: { kind: "event", recordId: title },
    }],
    proposals: [],
    sourceStates: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
