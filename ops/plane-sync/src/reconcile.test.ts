import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { PlaneModuleMembershipInventory } from "./plane.js";
import { reconcile } from "./reconcile.js";
import { indexSeedRegistry } from "./registry.js";
import { SqliteDeliveryStore } from "./store.js";
import type { GitHubIssueContext, GitHubIssueState, ModuleName, PlaneStateName, SeedRegistryEntry } from "./types.js";

const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];
const now = new Date("2026-08-02T10:00:00.000Z");

function temporaryStore(): SqliteDeliveryStore {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-reconcile-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  return store;
}

const stateIds: Record<PlaneStateName, string> = {
  Backlog: "backlog",
  Todo: "todo",
  "In Progress": "active",
  Done: "done",
  Cancelled: "cancelled",
};
const moduleIds: Record<ModuleName, string> = {
  "Product Confidence & Delivery": "module-product",
  "Analytics & Forecasting": "module-analytics",
  "Artists, Releases & Rights": "module-artists",
  "Directory & Campaigns": "module-directory",
  "Events, Tasks & Search": "module-events",
  "Content, Assets & Budgets": "module-content",
};

function issue(number: number, overrides: Partial<GitHubIssueState> = {}): GitHubIssueState {
  return {
    number,
    title: `Issue ${number}`,
    state: "OPEN",
    stateReason: null,
    labels: [],
    url: `https://github.com/label-suite-org/label-suite_neon_r2/issues/${number}`,
    updatedAt: "2026-08-02T09:00:00.000Z",
    ...overrides,
  };
}

function seedEntry(issueNumbers: number[], overrides: Partial<SeedRegistryEntry> = {}): SeedRegistryEntry {
  return {
    planeWorkItemId: "seed-128",
    issueNumbers,
    moduleName: "Product Confidence & Delivery",
    managedFields: ["state", "priority", "module", "milestones"],
    curatedTitle: true,
    ...overrides,
  };
}

function reconciliationHarness(options: {
  cursor?: string | null;
  seedEntries?: SeedRegistryEntry[];
  automaticMappings?: Array<{ issueNumber: number; planeWorkItemId: string }>;
  issues?: GitHubIssueState[];
  updatedIssues?: GitHubIssueState[];
  canonicalMatches?: Record<string, string[]>;
  failMilestone?: boolean;
  failPatchForId?: string;
  failSetModuleAfterMutation?: boolean;
  failedIssueNumbers?: number[];
} = {}) {
  const store = temporaryStore();
  if (options.cursor !== undefined && options.cursor !== null) store.setCursor("github-reconcile", options.cursor);
  for (const mapping of options.automaticMappings ?? []) store.upsertMapping(mapping.issueNumber, mapping.planeWorkItemId);
  const issues = new Map((options.issues ?? [issue(128)]).map((value) => [value.number, value]));
  const updatedSinceRequests: Array<string | null> = [];
  const github = {
    async getIssueContext(number: number): Promise<GitHubIssueContext> {
      if (options.failedIssueNumbers?.includes(number)) throw new PermanentSyncError("github_issue_invalid");
      const value = issues.get(number);
      if (!value) throw new Error(`missing issue ${number}`);
      return { issue: { ...value, labels: [...value.labels] }, hasOpenLinkedPullRequest: false };
    },
    async listIssuesUpdatedSince(cursor: string | null) {
      updatedSinceRequests.push(cursor);
      return (options.updatedIssues ?? []).map((value) => ({ ...value, labels: [...value.labels] }));
    },
  };
  const items = new Map<string, {
    id: string;
    name: string;
    descriptionHtml: string;
    stateId: string;
    priority: "none" | "low" | "medium" | "high" | "urgent";
    labelIds: string[];
    moduleIds: string[];
  }>();
  const ids = new Set<string>([
    ...(options.seedEntries ?? []).map((entry) => entry.planeWorkItemId),
    ...(options.automaticMappings ?? []).map((mapping) => mapping.planeWorkItemId),
    ...Object.values(options.canonicalMatches ?? {}).flat(),
  ]);
  for (const id of ids) {
    items.set(id, {
      id,
      name: `Manual item ${id}`,
      descriptionHtml: "<p>Manual roadmap context</p>",
      stateId: "backlog",
      priority: "low",
      labelIds: ["manual-label"],
      moduleIds: ["module-product"],
    });
  }
  const comments = new Map<string, Array<{ externalId: string; html: string }>>();
  let failMilestone = options.failMilestone ?? false;
  let failSetModuleAfterMutation = options.failSetModuleAfterMutation ?? false;
  let moduleMutationNotifications = 0;
  let moduleInventoryLoads = 0;
  let planeRequestCount = 0;
  const copy = (value: (typeof items extends Map<string, infer Item> ? Item : never)) => ({
    ...value,
    labelIds: [...value.labelIds],
    moduleIds: [...value.moduleIds],
  });
  const plane = {
    items,
    comments,
    async resolveVocabulary() {
      return { states: stateIds, modules: moduleIds };
    },
    async loadModuleMembershipInventory() {
      moduleInventoryLoads += 1;
      // states + modules + each of the six required module collections.
      planeRequestCount += 8;
      const memberships = new Map<string, string[]>();
      for (const moduleId of Object.values(moduleIds)) memberships.set(moduleId, []);
      for (const item of items.values()) {
        for (const moduleId of item.moduleIds) {
          const workItemIds = memberships.get(moduleId) ?? [];
          workItemIds.push(item.id);
          memberships.set(moduleId, workItemIds);
        }
      }
      return new PlaneModuleMembershipInventory({ states: stateIds, modules: moduleIds }, memberships);
    },
    async getWorkItem(id: string) {
      planeRequestCount += 1;
      const value = items.get(id);
      if (!value) throw new Error(`missing Plane item ${id}`);
      return copy(value);
    },
    async patchProjection(current: { id: string }, patch: { stateId?: string; priority?: "none" | "low" | "medium" | "high" | "urgent" }) {
      planeRequestCount += 2;
      if (current.id === options.failPatchForId) throw new Error("plane_service_unavailable");
      const value = items.get(current.id);
      if (!value) throw new Error(`missing Plane item ${current.id}`);
      if (patch.stateId !== undefined) value.stateId = patch.stateId;
      if (patch.priority !== undefined) value.priority = patch.priority;
      return copy(value);
    },
    async setModule(id: string, moduleId: string, onMutation?: () => void, inventory?: PlaneModuleMembershipInventory) {
      planeRequestCount += 1;
      const value = items.get(id);
      if (!value) throw new Error(`missing Plane item ${id}`);
      if (failSetModuleAfterMutation) {
        failSetModuleAfterMutation = false;
        value.moduleIds = [];
        onMutation?.();
        moduleMutationNotifications += 1;
        throw new RetryableSyncError("plane_service_unavailable");
      }
      for (const currentModuleId of inventory?.moduleIdsForWorkItem(id) ?? []) {
        inventory?.removeMembership(currentModuleId, id);
      }
      inventory?.addMembership(moduleId, id);
      value.moduleIds = [moduleId];
      onMutation?.();
      moduleMutationNotifications += 1;
      return true;
    },
    async clearModule(id: string, onMutation?: () => void, inventory?: PlaneModuleMembershipInventory) {
      planeRequestCount += 1;
      const value = items.get(id);
      if (!value) throw new Error(`missing Plane item ${id}`);
      for (const currentModuleId of inventory?.moduleIdsForWorkItem(id) ?? []) {
        inventory?.removeMembership(currentModuleId, id);
      }
      value.moduleIds = [];
      onMutation?.();
      moduleMutationNotifications += 1;
      return true;
    },
    async listMilestoneExternalIds(id: string) {
      planeRequestCount += 1;
      return new Set((comments.get(id) ?? []).map((comment) => comment.externalId));
    },
    async addProjectionComment(id: string, comment: { externalId: string; html: string }) {
      planeRequestCount += 2;
      const values = comments.get(id) ?? [];
      if (!values.some((current) => current.externalId === comment.externalId)) values.push({ ...comment });
      comments.set(id, values);
    },
    async addMilestone(id: string, comment: { externalId: string; html: string }) {
      planeRequestCount += 1;
      if (failMilestone) {
        failMilestone = false;
        throw new Error("plane_service_unavailable");
      }
      const values = comments.get(id) ?? [];
      if (!values.some((current) => current.externalId === comment.externalId)) values.push({ ...comment });
      comments.set(id, values);
    },
    async findItemsByCanonicalIssueUrl(url: string) {
      planeRequestCount += 1;
      return (options.canonicalMatches?.[url] ?? []).map((id) => {
        const value = items.get(id);
        if (!value) throw new Error(`missing Plane item ${id}`);
        return copy(value);
      });
    },
  };
  return {
    store,
    github,
    plane,
    moduleMutationNotifications: () => moduleMutationNotifications,
    moduleInventoryLoads: () => moduleInventoryLoads,
    planeRequestCount: () => planeRequestCount,
    updatedSinceRequests,
    deps: {
      store,
      github: github as never,
      plane: plane as never,
      registry: indexSeedRegistry({ version: 1, entries: options.seedEntries ?? [] }),
    },
  };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("reconcile", () => {
  it("inspects seed mappings on a first dry run without importing historical issues or advancing its cursor", async () => {
    const store = temporaryStore();
    const updatedSinceRequests: Array<string | null> = [];
    const github = {
      async getIssueContext() {
        return {
          issue: {
            number: 128,
            title: "Synchronize authoritative GitHub delivery state",
            state: "OPEN" as const,
            stateReason: null,
            labels: [],
            url: "https://github.com/label-suite-org/label-suite_neon_r2/issues/128",
            updatedAt: "2026-08-02T09:00:00.000Z",
          },
          hasOpenLinkedPullRequest: false,
        };
      },
      async listIssuesUpdatedSince(cursor: string | null) {
        updatedSinceRequests.push(cursor);
        return [];
      },
    };
    const plane = {
      async resolveVocabulary() {
        return {
          states: { Backlog: "backlog", Todo: "todo", "In Progress": "active", Done: "done", Cancelled: "cancelled" },
          modules: {
            "Product Confidence & Delivery": "module-product",
            "Analytics & Forecasting": "module-analytics",
            "Artists, Releases & Rights": "module-artists",
            "Directory & Campaigns": "module-directory",
            "Events, Tasks & Search": "module-events",
            "Content, Assets & Budgets": "module-content",
          },
        };
      },
      async loadModuleMembershipInventory() {
        return new PlaneModuleMembershipInventory(
          { states: stateIds, modules: moduleIds },
          new Map(Object.values(moduleIds).map((moduleId) => [moduleId, moduleId === "module-product" ? ["seed-128"] : []])),
        );
      },
      async getWorkItem() {
        return {
          id: "seed-128",
          name: "Manual title",
          descriptionHtml: "<p>Manual roadmap context</p>",
          stateId: "todo",
          priority: "none" as const,
          labelIds: ["manual"],
          moduleIds: ["module-product"],
        };
      },
      async listMilestoneExternalIds() {
        return new Set<string>();
      },
    };
    const registry = indexSeedRegistry({
      version: 1,
      entries: [{
        planeWorkItemId: "seed-128",
        issueNumbers: [128],
        moduleName: "Product Confidence & Delivery",
        managedFields: ["state", "priority", "module", "milestones"],
        curatedTitle: true,
      }],
    });

    const report = await reconcile(
      { store, github: github as never, plane: plane as never, registry },
      { apply: false, now },
    );

    expect(updatedSinceRequests).toEqual([]);
    expect(report).toMatchObject({
      mode: "dry-run",
      seedItemsChecked: 1,
      automaticItemsChecked: 0,
      cursorAdvancedTo: null,
    });
    expect(store.getCursor("github-reconcile")).toBeNull();
  });

  it("advances a first-run cursor to the run start only after every seed projection and repair milestone succeeds", async () => {
    const test = reconciliationHarness({ seedEntries: [seedEntry([128])] });

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      mode: "active",
      seedItemsChecked: 1,
      applied: 1,
      cursorAdvancedTo: "2026-08-02T10:00:00.000Z",
    });
    expect(test.updatedSinceRequests).toEqual([]);
    expect(test.store.getCursor("github-reconcile")).toBe("2026-08-02T10:00:00.000Z");
    expect(test.plane.items.get("seed-128")).toMatchObject({
      stateId: "todo",
      priority: "low",
      moduleIds: ["module-product"],
      name: "Manual item seed-128",
      descriptionHtml: "<p>Manual roadmap context</p>",
      labelIds: ["manual-label"],
    });
    expect(test.plane.comments.get("seed-128")?.some((comment) => comment.externalId.startsWith("github:reconcile:128:2026-08-02T09:00:00.000Z:"))).toBe(true);
  });

  it("uses one bounded inventory and fewer than 60 Plane requests for a 16-item no-op reconciliation", async () => {
    const seedEntries = Array.from({ length: 16 }, (_, offset) =>
      seedEntry([128 + offset], { planeWorkItemId: `seed-${128 + offset}`, managedFields: ["module"] }),
    );
    const test = reconciliationHarness({
      seedEntries,
      issues: seedEntries.map((entry) => issue(entry.issueNumbers[0]!)),
    });

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      seedItemsChecked: 16,
      planned: 0,
      applied: 0,
      cursorAdvancedTo: "2026-08-02T10:00:00.000Z",
    });

    expect(test.moduleInventoryLoads()).toBe(1);
    expect(test.planeRequestCount()).toBe(24);
    expect(test.planeRequestCount()).toBeLessThan(60);
  });

  it("changes only the managed state for a state-only seed without creating reconciliation comments", async () => {
    const test = reconciliationHarness({
      seedEntries: [seedEntry([128], { managedFields: ["state"] })],
      issues: [issue(128, {
        labels: ["status:in-progress", "priority:high", "plane:module/analytics-forecasting"],
      })],
    });

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      applied: 1,
      failed: 0,
      ambiguous: 0,
    });
    expect(test.plane.items.get("seed-128")).toMatchObject({
      stateId: "active",
      priority: "low",
      moduleIds: ["module-product"],
    });
    expect(test.plane.comments.get("seed-128") ?? []).toEqual([]);
  });

  it("does not consume or replace webhook work-started intent settings during reconciliation", async () => {
    const updatedAt = "2026-08-02T09:00:00.000Z";
    const test = reconciliationHarness({
      seedEntries: [seedEntry([128])],
      issues: [issue(128, { labels: ["status:in-progress"], updatedAt })],
    });
    const deliveryId = `reconcile:128:${updatedAt}`;
    const itemIntent = `delivery-transition:${deliveryId}:work_started:seed-128`;
    const newItemIntent = `delivery-transition:${deliveryId}:work_started:new-issue:128`;
    test.store.setCursor(itemIntent, "2026-07-01T00:00:00.000Z");
    test.store.setCursor(newItemIntent, "2026-07-02T00:00:00.000Z");

    await reconcile(test.deps, { apply: true, now });

    expect(test.store.getCursor(itemIntent)).toBe("2026-07-01T00:00:00.000Z");
    expect(test.store.getCursor(newItemIntent)).toBe("2026-07-02T00:00:00.000Z");
    expect(test.plane.comments.get("seed-128")?.some((comment) => comment.externalId.includes(":work_started:"))).toBe(false);
  });

  it("does not advance the cursor or record a repair milestone after a Plane failure", async () => {
    const test = reconciliationHarness({ seedEntries: [seedEntry([128])], failMilestone: true });

    await expect(reconcile(test.deps, { apply: true, now })).rejects.toThrow("plane_service_unavailable");
    expect(test.store.getCursor("github-reconcile")).toBeNull();
    expect(test.store.getCursor("last-successful-reconciliation-at")).toBeNull();
    expect(test.plane.comments.get("seed-128")?.filter((comment) => comment.externalId.startsWith("github:reconcile:"))).toEqual([]);
  });

  it("keeps cursor success atomic while retaining mutations persisted before a final transaction failure", async () => {
    const old = "2026-08-02T08:00:00.000Z";
    const test = reconciliationHarness({
      cursor: old,
      seedEntries: [seedEntry([128])],
      issues: [issue(128, { labels: ["priority:high"] })],
    });
    test.store.setCursor("last-successful-reconciliation-at", old);
    test.store.setCursor("last-successful-plane-mutation-at", old);
    const setCursors = test.store.setCursors.bind(test.store);
    test.store.setCursors = (entries) => setCursors(
      entries.length >= 2
        ? [...entries, { key: "injected-invalid", value: null as unknown as string }]
        : entries,
    );

    await expect(reconcile(test.deps, { apply: true, now })).rejects.toThrow("setting value must be a string");
    expect(test.store.getCursor("github-reconcile")).toBe(old);
    expect(test.store.getCursor("last-successful-reconciliation-at")).toBe(old);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
  });

  it("never lets an older successful reconciliation overwrite a newer webhook mutation timestamp", async () => {
    const test = reconciliationHarness({
      seedEntries: [seedEntry([128])],
      issues: [issue(128, { labels: ["priority:high"] })],
    });
    test.store.setCursor("last-successful-plane-mutation-at", "2026-08-02T11:00:00.000Z");

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      applied: 1,
      cursorAdvancedTo: "2026-08-02T10:00:00.000Z",
    });
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T11:00:00.000Z");
  });

  it("retains an immediately persisted mutation timestamp when a later target outage aborts the run", async () => {
    const old = "2026-08-02T08:00:00.000Z";
    const test = reconciliationHarness({
      cursor: old,
      seedEntries: [
        seedEntry([128], { planeWorkItemId: "seed-a" }),
        seedEntry([129], { planeWorkItemId: "seed-z" }),
      ],
      issues: [issue(128), issue(129)],
      failPatchForId: "seed-z",
    });
    test.store.setCursor("last-successful-reconciliation-at", old);

    await expect(reconcile(test.deps, { apply: true, now })).rejects.toThrow("plane_service_unavailable");
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
    expect(test.store.getCursor("github-reconcile")).toBe(old);
    expect(test.store.getCursor("last-successful-reconciliation-at")).toBe(old);
  });

  it("retains confirmed module-write chronology when module reconciliation fails, then retries idempotently", async () => {
    const test = reconciliationHarness({
      seedEntries: [seedEntry([128], { managedFields: ["module"] })],
      issues: [issue(128, { labels: ["plane:module/analytics-forecasting"] })],
      failSetModuleAfterMutation: true,
    });
    test.store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");

    await expect(reconcile(test.deps, { apply: true, now })).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(test.plane.items.get("seed-128")?.moduleIds).toEqual([]);
    expect(test.moduleMutationNotifications()).toBe(1);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
    expect(test.store.getCursor("github-reconcile")).toBeNull();

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({ applied: 1 });
    expect(test.plane.items.get("seed-128")?.moduleIds).toEqual(["module-analytics"]);
    expect(test.moduleMutationNotifications()).toBe(2);
  });

  it("repairs exactly one missed automatic mapping from a later authoritative GitHub issue", async () => {
    const changed = issue(129, {
      labels: ["priority:high", "plane:module/analytics-forecasting"],
      updatedAt: "2026-08-02T09:15:00.000Z",
    });
    const test = reconciliationHarness({
      cursor: "2026-08-02T09:00:00.000Z",
      issues: [changed],
      updatedIssues: [changed],
      canonicalMatches: { [changed.url]: ["plane-129"] },
    });

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      automaticItemsChecked: 1,
      repaired: 1,
      applied: 1,
      cursorAdvancedTo: "2026-08-02T10:00:00.000Z",
    });
    expect(test.updatedSinceRequests).toEqual(["2026-08-02T09:00:00.000Z"]);
    expect(test.store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "plane-129", source: "automatic" },
    ]);
    expect(test.plane.items.get("plane-129")).toMatchObject({ stateId: "todo", priority: "high", moduleIds: ["module-analytics"] });
    expect(test.plane.comments.get("plane-129")?.some((comment) =>
      comment.externalId.startsWith("github:reconcile:129:2026-08-02T09:15:00.000Z:"),
    )).toBe(true);
  });

  it("reports an ambiguous canonical repair without creating a mapping or advancing the cursor", async () => {
    const changed = issue(129);
    const test = reconciliationHarness({
      cursor: "2026-08-02T09:00:00.000Z",
      issues: [changed],
      updatedIssues: [changed],
      canonicalMatches: { [changed.url]: ["plane-a", "plane-b"] },
    });

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      ambiguous: 1,
      applied: 0,
      repaired: 0,
      cursorAdvancedTo: null,
    });
    expect(test.store.mappingsForIssue(129)).toEqual([]);
    expect(test.store.getCursor("github-reconcile")).toBe("2026-08-02T09:00:00.000Z");
  });

  it("counts connected durable identity collisions once per quarantined component", async () => {
    const changed = issue(129, { labels: ["priority:high"] });
    const test = reconciliationHarness({
      automaticMappings: [
        { issueNumber: 129, planeWorkItemId: "plane-a" },
        { issueNumber: 129, planeWorkItemId: "plane-b" },
        { issueNumber: 130, planeWorkItemId: "plane-b" },
        { issueNumber: 130, planeWorkItemId: "plane-c" },
        { issueNumber: 131, planeWorkItemId: "plane-shared" },
        { issueNumber: 132, planeWorkItemId: "plane-shared" },
      ],
      issues: [changed, issue(130), issue(131), issue(132)],
    });
    const before = JSON.stringify([...test.plane.items.values()]);

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      automaticItemsChecked: 6,
      ambiguous: 2,
      failed: 0,
      applied: 0,
      repaired: 0,
      cursorAdvancedTo: null,
    });
    expect(JSON.stringify([...test.plane.items.values()])).toBe(before);
    expect([...test.plane.comments.values()]).toEqual([]);
    expect(test.store.getCursor("github-reconcile")).toBeNull();
    expect(test.store.getCursor("last-successful-reconciliation-at")).toBeNull();
  });

  it("audits clean, ambiguous, and failed targets completely before applying any active writes", async () => {
    const canonicalAmbiguous = issue(132);
    const canonicalClean = issue(133, { labels: ["priority:high"] });
    const test = reconciliationHarness({
      cursor: "2026-08-02T08:00:00.000Z",
      automaticMappings: [
        { issueNumber: 128, planeWorkItemId: "plane-clean" },
        { issueNumber: 130, planeWorkItemId: "plane-failed" },
        { issueNumber: 131, planeWorkItemId: "plane-ambiguous-a" },
        { issueNumber: 131, planeWorkItemId: "plane-ambiguous-b" },
      ],
      issues: [issue(128, { labels: ["priority:high"] }), issue(130), canonicalAmbiguous, canonicalClean],
      updatedIssues: [canonicalClean, canonicalAmbiguous],
      canonicalMatches: {
        [canonicalAmbiguous.url]: ["plane-canonical-a", "plane-canonical-b"],
        [canonicalClean.url]: ["plane-canonical-clean"],
      },
      failedIssueNumbers: [130],
    });
    const before = JSON.stringify([...test.plane.items.values()]);

    await expect(reconcile(test.deps, { apply: true, now })).resolves.toMatchObject({
      automaticItemsChecked: 6,
      planned: 2,
      applied: 0,
      repaired: 0,
      ambiguous: 2,
      failed: 1,
      cursorAdvancedTo: null,
    });
    expect(JSON.stringify([...test.plane.items.values()])).toBe(before);
    expect([...test.plane.comments.values()]).toEqual([]);
    expect(test.store.getCursor("github-reconcile")).toBe("2026-08-02T08:00:00.000Z");
    expect(test.store.getCursor("last-successful-reconciliation-at")).toBeNull();
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBeNull();
    expect(test.store.mappingsForIssue(133)).toEqual([]);
  });

  it("does not preserve a recovered mapping when its Plane repair milestone fails", async () => {
    const changed = issue(129, { updatedAt: "2026-08-02T09:15:00.000Z" });
    const test = reconciliationHarness({
      cursor: "2026-08-02T09:00:00.000Z",
      issues: [changed],
      updatedIssues: [changed],
      canonicalMatches: { [changed.url]: ["plane-129"] },
      failMilestone: true,
    });

    await expect(reconcile(test.deps, { apply: true, now })).rejects.toThrow("plane_service_unavailable");
    expect(test.store.mappingsForIssue(129)).toEqual([]);
    expect(test.store.getCursor("github-reconcile")).toBe("2026-08-02T09:00:00.000Z");
  });

  it("plans a missed mapping repair in dry-run without changing Plane, mappings, comments, milestones, or settings", async () => {
    const changed = issue(129, { updatedAt: "2026-08-02T09:15:00.000Z" });
    const test = reconciliationHarness({
      cursor: "2026-08-02T09:00:00.000Z",
      issues: [changed],
      updatedIssues: [changed],
      canonicalMatches: { [changed.url]: ["plane-129"] },
    });
    const before = JSON.stringify({
      item: test.plane.items.get("plane-129"),
      comments: test.plane.comments.get("plane-129") ?? [],
      mappings: test.store.mappingsForIssue(129),
      cursor: test.store.getCursor("github-reconcile"),
    });

    await expect(reconcile(test.deps, { apply: false, now })).resolves.toMatchObject({
      mode: "dry-run",
      planned: 1,
      repaired: 1,
      cursorAdvancedTo: null,
    });
    expect(JSON.stringify({
      item: test.plane.items.get("plane-129"),
      comments: test.plane.comments.get("plane-129") ?? [],
      mappings: test.store.mappingsForIssue(129),
      cursor: test.store.getCursor("github-reconcile"),
    })).toBe(before);
  });
});
