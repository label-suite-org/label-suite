import { describe, expect, it, vi } from "vitest";
import type { CampaignDocument } from "../lib/campaign-rich-text";
import { hashCampaignEditorDocument, type CreateCampaignEditorAiRunInput } from "./campaign-editor-ai-core";
import { createCampaignEditorAiRun, decideCampaignEditorAiRun, type CampaignEditorAiRunStore } from "./campaign-editor-ai";
import { createTestCampaignEditorAiProvider } from "./campaign-editor-ai-provider";

const document = (text: string): CampaignDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const request = (): CreateCampaignEditorAiRunInput => {
  const current = document("Caller supplied copy");
  return {
    surface: "campaign_goal",
    operation: "improve",
    scope: "document",
    selection: null,
    current_document: current,
    input_document_hash: hashCampaignEditorDocument(current, "campaign_goal"),
    instruction: null,
    lead_id: null,
    draft_id: null,
    page_revision_id: null,
  };
};

function storeFixture(): CampaignEditorAiRunStore & { rows: unknown[]; ledger: string[] } {
  const rows: unknown[] = [];
  const ledger: string[] = [];
  return {
    rows,
    ledger,
    async loadContext(orgId, campaignId, input) {
      ledger.push(`context:${orgId}:${campaignId}:${input.surface}`);
      return {
        campaign: { id: campaignId, name: "Server campaign", goal: "Server goal", notes: "Server notes", version: 4, content_hash: "campaign-hash" },
        release: { id: "release-a", title: "Server release", artist_name: "Artist", track_titles: ["Track A"], version: 2, content_hash: "release-hash" },
        lead: null,
        draft: null,
        page_revision: null,
        prompt: { id: "prompt-a", version: 3, text: "Server prompt", content_hash: "prompt-hash" },
        research: [{
          id: "research-accepted", status: "accepted", value: "A reviewed fact", rationale: "Verified", citation_ids: ["citation-a"],
          evidence: [{ id: "citation-a", title: "Primary source", url: "https://example.test/source", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "Evidence" }],
        }, {
          id: "research-pending", status: "pending", value: "Unreviewed fact", rationale: "No", citation_ids: ["citation-pending"],
          evidence: [{ id: "citation-pending", title: "Pending", url: "https://example.test/pending", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "Pending" }],
        }],
      };
    },
    async insertRun(row) {
      ledger.push(`insert:${row.status}`);
      rows.push(row);
    },
    async updateRun(_orgId, _runId, expectedOrChanges: unknown, optionalChanges?: unknown) {
      const expected = typeof expectedOrChanges === "string" ? expectedOrChanges : "unconditional";
      const changes = (optionalChanges ?? expectedOrChanges) as { status?: string };
      ledger.push(`update:${expected}:${changes.status}`);
      const row = rows[0] as { status: string };
      if (expected !== "unconditional" && row.status !== expected) return false;
      Object.assign(row, changes);
      return true;
    },
    async findRun() { return null; },
  };
}

describe("campaign editor AI run service", () => {
  it("reloads authoritative same-org context, audits running before provider, and returns a ready proposal", async () => {
    const store = storeFixture();
    const transform = vi.fn(async () => {
      expect(store.ledger).toContain("insert:running");
      return { replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"] };
    });
    const provider = createTestCampaignEditorAiProvider(transform);

    const proposal = await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store,
      now: () => new Date("2026-08-08T10:00:00.000Z"),
      randomUUID: () => "run-a",
    });

    expect(proposal.status).toBe("ready");
    expect(transform).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ campaign: expect.objectContaining({ id: "campaign-a", name: "Server campaign" }) }),
    }));
    expect(transform.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    expect(store.ledger).toEqual(["context:org-a:campaign-a:campaign_goal", "insert:running", "update:running:ready"]);
    expect(store.rows[0]).toMatchObject({ id: "run-a", org_id: "org-a", campaign_id: "campaign-a", status: "ready", citation_ids: ["citation-a"] });
    expect(JSON.stringify(store.rows[0])).not.toContain("Unreviewed fact");
    expect(JSON.stringify(store.rows[0])).not.toContain("Server prompt");
  });

  it("writes a compact manifest even when a loader carries unrelated contact or provider data", async () => {
    const store = storeFixture();
    const loadContext = store.loadContext;
    store.loadContext = async (...args) => {
      const loaded = await loadContext(...args);
      if (!loaded) throw new Error("Fixture context is missing");
      return {
      ...loaded,
      manifest: { contacts: ["private@example.test"], raw_provider_response: "secret-response", tracks: [{ id: "track-a", hash: "track-hash" }] },
      };
    };
    const provider = createTestCampaignEditorAiProvider(async () => ({ replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"] }));

    await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store,
      now: () => new Date("2026-08-08T10:00:00.000Z"),
      randomUUID: () => "run-a",
    });

    expect(store.rows[0]).toMatchObject({ context_manifest: expect.objectContaining({ citation_ids: ["citation-a"] }) });
    expect(JSON.stringify(store.rows[0])).not.toContain("private@example.test");
    expect(JSON.stringify(store.rows[0])).not.toContain("secret-response");
  });

  it("returns only proposal-used accepted usable citations in the allowlisted display projection", async () => {
    const store = storeFixture();
    const loadContext = store.loadContext;
    store.loadContext = async (...args) => {
      const loaded = await loadContext(...args);
      if (!loaded) throw new Error("Fixture context is missing");
      return {
        ...loaded,
        research: [
          ...(loaded.research ?? []),
          {
            id: "research-unsafe",
            status: "accepted",
            value: "Unsafe evidence",
            rationale: "Do not expose it",
            citation_ids: ["citation-unsafe"],
            evidence: [{ id: "citation-unsafe", title: "Unsafe", url: "javascript:alert(1)", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "Unsafe" }],
          },
        ],
      };
    };
    const provider = createTestCampaignEditorAiProvider(async () => ({
      replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"],
    }), "review-model");

    const result = await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    });

    expect(result.display).toEqual({
      provider: "test",
      model: "review-model",
      context_manifest: expect.objectContaining({ citation_ids: ["citation-a"] }),
      citations: [{ id: "citation-a", title: "Primary source", url: "https://example.test/source" }],
    });
    expect(JSON.stringify(result.display)).not.toContain("citation-pending");
    expect(JSON.stringify(result.display)).not.toContain("citation-unsafe");
    expect(JSON.stringify(result.display)).not.toContain("A reviewed fact");
  });

  it("keeps valid accepted evidence when the database-derived citation_ids list is absent", async () => {
    const store = storeFixture();
    const loadContext = store.loadContext;
    store.loadContext = async (...args) => {
      const loaded = await loadContext(...args);
      if (!loaded) throw new Error("Fixture context is missing");
      return {
        ...loaded,
        research: (loaded.research ?? []).map((item) => item.id === "research-accepted" ? { ...item, citation_ids: undefined } : item),
      };
    };
    const provider = createTestCampaignEditorAiProvider(async () => ({
      replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"],
    }));

    const result = await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    });

    expect(result.display.citations).toEqual([{ id: "citation-a", title: "Primary source", url: "https://example.test/source" }]);
  });

  it("records only an allowlisted provider failure without retaining raw provider data", async () => {
    const store = storeFixture();
    const provider = createTestCampaignEditorAiProvider(async () => {
      throw Object.assign(new Error("upstream response body: private"), { code: "network" });
    });

    await expect(createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    })).rejects.toMatchObject({ category: "network" });

    expect(store.rows[0]).toMatchObject({ status: "failed", failure_category: "network", proposed_document: null });
    expect(JSON.stringify(store.rows[0])).not.toContain("upstream response body");
  });

  it("marks a hash-mismatched decision stale, writes actor/time, and rejects repeat decisions", async () => {
    const store = storeFixture();
    store.findRun = async () => store.rows[0] as never;
    const provider = createTestCampaignEditorAiProvider(async () => ({ replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"] }));
    await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    });

    await expect(decideCampaignEditorAiRun("org-a", "run-a", "user-b", { decision: "accepted", current_document_hash: "a".repeat(64) }, {
      store, now: () => new Date("2026-08-08T11:00:00.000Z"), randomUUID: () => "unused",
    })).rejects.toMatchObject({ status: 409 });
    expect(store.rows[0]).toMatchObject({ status: "stale", decided_by: "user-b", decided_at: new Date("2026-08-08T11:00:00.000Z") });
    await expect(decideCampaignEditorAiRun("org-a", "run-a", "user-b", { decision: "rejected", current_document_hash: "a".repeat(64) }, {
      store, now: () => new Date("2026-08-08T12:00:00.000Z"), randomUUID: () => "unused",
    })).rejects.toThrow(/ready/i);
  });

  it("lets exactly one concurrent ready decision win its compare-and-set transition", async () => {
    const store = storeFixture();
    const provider = createTestCampaignEditorAiProvider(async () => ({ replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"] }));
    await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    });
    const readySnapshot = { ...(store.rows[0] as object) } as never;
    store.findRun = async () => readySnapshot;
    const dependencies = { store, now: () => new Date("2026-08-08T11:00:00.000Z"), randomUUID: () => "unused" };
    const hash = request().input_document_hash;

    const results = await Promise.allSettled([
      decideCampaignEditorAiRun("org-a", "run-a", "first-writer", { decision: "accepted", current_document_hash: hash }, dependencies),
      decideCampaignEditorAiRun("org-a", "run-a", "second-writer", { decision: "rejected", current_document_hash: hash }, dependencies),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ status: "accepted", decided_by: "first-writer" });
  });

  it("retries a conditional failed audit transition and preserves the original safe category", async () => {
    const store = storeFixture();
    const updateRun = store.updateRun;
    let failedAttempts = 0;
    store.updateRun = async (...args) => {
      if (args[2] === "running" && (args[3] as { status?: string } | undefined)?.status === "failed" && failedAttempts++ === 0) return false;
      return updateRun(...args);
    };
    const provider = createTestCampaignEditorAiProvider(async () => { throw Object.assign(new Error("private upstream body"), { code: "network" }); });

    await expect(createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    })).rejects.toMatchObject({ category: "network" });
    expect(store.rows[0]).toMatchObject({ status: "failed", failure_category: "network" });
    expect(failedAttempts).toBe(2);
  });

  it("returns a dedicated safe audit-persistence error when a failed run cannot be recorded", async () => {
    const store = storeFixture();
    const updateRun = store.updateRun;
    store.updateRun = async (...args) => (
      args[2] === "running" && (args[3] as { status?: string } | undefined)?.status === "failed" ? false : updateRun(...args)
    );
    const provider = createTestCampaignEditorAiProvider(async () => { throw Object.assign(new Error("provider secret response"), { code: "network" }); });

    await expect(createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    })).rejects.toMatchObject({ name: "CampaignEditorAiAuditPersistenceError", category: "network" });
  });

  it("audits a disabled provider as a failed disabled run without calling transform", async () => {
    const store = storeFixture();
    const transform = vi.fn();
    const provider = { id: "disabled" as const, model: "disabled", transform };

    await expect(createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    })).rejects.toMatchObject({ category: "disabled" });
    expect(transform).not.toHaveBeenCalled();
    expect(store.rows[0]).toMatchObject({ status: "failed", failure_category: "disabled" });
  });

  it("rejects a radio draft with a lead before provider invocation", async () => {
    const store = storeFixture();
    const originalLoad = store.loadContext;
    store.loadContext = async (orgId, campaignId, input) => ({
      ...await originalLoad(orgId, campaignId, input) as NonNullable<Awaited<ReturnType<typeof originalLoad>>>,
      lead: null,
      draft: { id: "draft-a", lead_id: "lead-a", scope: "radio_update", version: 1 },
      page_revision: { id: "revision-a", version: 1, content_hash: "revision-hash" },
    });
    const current = document("Radio update");
    const radioRequest: CreateCampaignEditorAiRunInput = {
      ...request(), surface: "radio_update_body", current_document: current,
      input_document_hash: hashCampaignEditorDocument(current, "radio_update_body"), draft_id: "draft-a", page_revision_id: "revision-a",
    };
    const transform = vi.fn();
    const provider = createTestCampaignEditorAiProvider(transform);

    await expect(createCampaignEditorAiRun("org-a", "campaign-a", "user-a", radioRequest, provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    })).rejects.toThrow(/draft|radio|context/i);
    expect(transform).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  it("uses updated_at rather than a misleading hash label for manifest freshness", async () => {
    const store = storeFixture();
    const originalLoad = store.loadContext;
    store.loadContext = async (...args) => {
      const loaded = await originalLoad(...args);
      if (!loaded) throw new Error("Fixture context is missing");
      return { ...loaded, manifest: { campaign: { id: "campaign-a", hash: "not-a-content-hash", updated_at: "2026-08-08T10:00:00.000Z" } } };
    };
    const provider = createTestCampaignEditorAiProvider(async () => ({ replacement_document: document("Provider copy"), rationale: "Tighter", citation_ids: ["citation-a"] }));

    await createCampaignEditorAiRun("org-a", "campaign-a", "user-a", request(), provider, {
      store, now: () => new Date("2026-08-08T10:00:00.000Z"), randomUUID: () => "run-a",
    });
    expect(store.rows[0]).toMatchObject({ context_manifest: { campaign: { id: "campaign-a", updated_at: "2026-08-08T10:00:00.000Z" } } });
    expect(JSON.stringify(store.rows[0])).not.toContain("not-a-content-hash");
  });
});
