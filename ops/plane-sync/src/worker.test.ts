import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { GitHubClient } from "./github.js";
import { logSyncEvent } from "./log.js";
import { PlaneClient, PlaneModuleMembershipInventory } from "./plane.js";
import type { ProcessorDeps } from "./processor.js";
import { indexSeedRegistry } from "./registry.js";
import { SqliteDeliveryStore } from "./store.js";
import type { CompactDelivery, GitHubIssueState, PlaneStateName } from "./types.js";
import { runWorkerOnce } from "./worker.js";

const repository = "label-suite-org/label-suite_neon_r2" as const;
const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];

function delivery(number = 129): CompactDelivery {
  return {
    deliveryId: `d00c6c06-8888-4b6a-b3f9-${String(number).padStart(12, "0")}`,
    event: "issues",
    action: "opened",
    repository,
    subjectKind: "issue",
    subjectNumber: number,
    actorLogin: "nature-boy",
    occurredAt: "2026-08-01T12:00:00.000Z",
  };
}

function workerHarness(error: Error | null = null) {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-worker-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  const logs: Array<Record<string, unknown>> = [];
  const github = {
    async getIssue(): Promise<GitHubIssueState> {
      if (error) throw error;
      return {
        number: 129,
        title: "Issue 129",
        state: "OPEN",
        stateReason: null,
        labels: [],
        url: `https://github.com/${repository}/issues/129`,
        updatedAt: "2026-08-01T12:00:00.000Z",
      };
    },
    async getIssueContext() {
      return { issue: await this.getIssue(), hasOpenLinkedPullRequest: false };
    },
    async getPullRequestContext(): Promise<never> {
      throw new PermanentSyncError("unexpected_pull_request");
    },
  };
  const plane = {
    async resolveVocabulary() {
      const states: Record<PlaneStateName, string> = {
        Backlog: "backlog",
        Todo: "todo",
        "In Progress": "active",
        Done: "done",
        Cancelled: "cancelled",
      };
      return {
        states,
        modules: {
          "Product Confidence & Delivery": "product",
          "Analytics & Forecasting": "analytics",
          "Artists, Releases & Rights": "artists",
          "Directory & Campaigns": "directory",
          "Events, Tasks & Search": "events",
          "Content, Assets & Budgets": "content",
        },
      };
    },
    async loadModuleMembershipInventory() {
      const vocabulary = await this.resolveVocabulary();
      return new PlaneModuleMembershipInventory(
        vocabulary,
        new Map(Object.values(vocabulary.modules).map((moduleId) => [moduleId, []])),
      );
    },
    async findItemsByCanonicalIssueUrl() {
      return [];
    },
    async createAutomaticItem(input: { title: string; canonicalIssueUrl: string; stateId: string; priority: "none" }) {
      return {
        id: "plane-129",
        name: input.title,
        descriptionHtml: "",
        stateId: input.stateId,
        priority: input.priority,
        labelIds: [],
        moduleIds: [],
      };
    },
    async getWorkItem() {
      throw new PermanentSyncError("unexpected_get_work_item");
    },
    async patchProjection() {
      throw new PermanentSyncError("unexpected_patch");
    },
    async setModule() {
      throw new PermanentSyncError("unexpected_module");
    },
    async listMilestoneExternalIds() {
      return new Set<string>();
    },
    async addMilestone() {},
    async addProjectionComment() {},
  };
  const deps: ProcessorDeps = {
    config: { writeMode: "active" },
    store,
    github: github as unknown as GitHubClient,
    plane: plane as unknown as PlaneClient,
    registry: indexSeedRegistry({ version: 1, entries: [] }),
    now: () => new Date("2026-08-01T12:00:00.000Z"),
    log: (event) => logs.push({ ...event }),
  };
  return { store, deps, logs };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("runWorkerOnce", () => {
  it("returns idle without changing an empty inbox", async () => {
    const test = workerHarness();

    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe("idle");
    expect(test.store.healthStats()).toMatchObject({ pending: 0, completed: 0 });
  });

  it("completes a delivery once and makes a duplicate delivery a store-boundary no-op", async () => {
    const test = workerHarness();
    const incoming = delivery();
    expect(test.store.recordDelivery(incoming)).toEqual({ inserted: true });
    expect(test.store.recordDelivery(incoming)).toEqual({ inserted: false });

    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe("completed");
    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T13:00:00.000Z"))).resolves.toBe("idle");
    expect(test.store.healthStats()).toMatchObject({ completed: 1, pending: 0 });
  });

  it("records the running service revision in a completed delivery outcome", async () => {
    const test = workerHarness();
    test.store.recordDelivery(delivery());

    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T12:00:00.000Z"), "69b2410da4eeba0a340c1ede94da2ff916cf67d0"))
      .resolves.toBe("completed");

    expect(test.logs.at(-1)).toMatchObject({
      code: "delivery_completed",
      revision: "69b2410da4eeba0a340c1ede94da2ff916cf67d0",
      outcome: "mutated",
    });
  });

  it("retries a transient failure through attempt seven then stores exact retry_exhausted at attempt eight", async () => {
    const test = workerHarness(new RetryableSyncError("plane_service_unavailable"));
    test.store.recordDelivery(delivery());
    let outcome = "idle";

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      outcome = await runWorkerOnce(test.deps, new Date(`2026-08-0${attempt}T12:00:00.000Z`));
      expect(outcome).toBe(attempt === 8 ? "failed" : "retry");
    }

    expect(test.store.healthStats()).toMatchObject({ permanentlyFailed: 1, lastErrorCode: "retry_exhausted" });
    expect(test.logs.at(-1)).toMatchObject({ code: "retry_exhausted", level: "error" });
  });

  it("fails a permanent mapping error immediately", async () => {
    const test = workerHarness(new PermanentSyncError("plane_mapping_ambiguous"));
    test.store.recordDelivery(delivery());

    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe("failed");
    expect(test.store.healthStats()).toMatchObject({ permanentlyFailed: 1, lastErrorCode: "plane_mapping_ambiguous" });
  });

  it("sanitizes unknown failures before retry logging", async () => {
    const test = workerHarness(new Error("authorization: Bearer private-token; body: private response"));
    test.store.recordDelivery(delivery());

    await expect(runWorkerOnce(test.deps, new Date("2026-08-01T12:00:00.000Z"))).resolves.toBe("retry");
    expect(test.store.healthStats()).toMatchObject({ retry: 1, lastErrorCode: "unexpected_failure" });
    expect(JSON.stringify(test.logs)).not.toContain("private-token");
    expect(JSON.stringify(test.logs)).not.toContain("private response");
    expect(test.logs.at(-1)).toMatchObject({ code: "unexpected_failure", level: "warn" });
  });
});
