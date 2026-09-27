import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PermanentSyncError, RetryableSyncError } from "./errors.js";
import { GitHubClient } from "./github.js";
import { PlaneClient, PlaneModuleMembershipInventory, type PlanePriority, type PlaneWorkItem } from "./plane.js";
import { processDelivery, type ProcessorDeps } from "./processor.js";
import { indexSeedRegistry } from "./registry.js";
import { SqliteDeliveryStore } from "./store.js";
import type {
  CompactDelivery,
  GitHubIssueState,
  GitHubPullRequestContext,
  ModuleName,
  PlaneStateName,
  SeedRegistry,
  SeedRegistryEntry,
} from "./types.js";

const repository = "label-suite-org/label-suite_neon_r2" as const;
const now = new Date("2026-08-01T12:00:00.000Z");
const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];

const moduleIds: Record<ModuleName, string> = {
  "Product Confidence & Delivery": "module-product",
  "Analytics & Forecasting": "module-analytics",
  "Artists, Releases & Rights": "module-artists",
  "Directory & Campaigns": "module-directory",
  "Events, Tasks & Search": "module-events",
  "Content, Assets & Budgets": "module-content",
};

const stateIds: Record<PlaneStateName, string> = {
  Backlog: "state-backlog",
  Todo: "state-todo",
  "In Progress": "state-active",
  Done: "state-done",
  Cancelled: "state-cancelled",
};

interface FakeItem extends PlaneWorkItem {
  canonicalIssueUrl: string;
  comments: Array<{ externalId: string; html: string }>;
}

class FakeGitHub {
  readonly issues = new Map<number, GitHubIssueState>();
  readonly openPullRequestByIssue = new Map<number, boolean>();
  readonly pullRequests = new Map<number, GitHubPullRequestContext>();
  readonly pullRequestIssueNumbers = new Set<number>();
  issueFailure: Error | null = null;

  async getIssueSubjectKind(number: number): Promise<"issue" | "pull_request"> {
    return this.pullRequestIssueNumbers.has(number) ? "pull_request" : "issue";
  }

  async getIssue(number: number): Promise<GitHubIssueState> {
    if (this.issueFailure) throw this.issueFailure;
    const value = this.issues.get(number);
    if (!value) throw new PermanentSyncError("github_issue_missing");
    return { ...value, labels: [...value.labels] };
  }

  async getIssueContext(number: number) {
    return {
      issue: await this.getIssue(number),
      hasOpenLinkedPullRequest: this.openPullRequestByIssue.get(number) ?? false,
    };
  }

  async getPullRequestContext(number: number): Promise<GitHubPullRequestContext> {
    const value = this.pullRequests.get(number);
    if (!value) throw new PermanentSyncError("github_pull_request_missing");
    return {
      pullRequest: { ...value.pullRequest },
      closingIssueNumbers: [...value.closingIssueNumbers],
    };
  }
}

class FakePlane {
  readonly items: FakeItem[] = [];
  addMilestoneFailures = 0;
  setModuleFailures = 0;
  setModulePartialMutationFailures = 0;
  setModuleNoops = 0;
  clearModuleNoops = 0;
  omitModuleIdsFromReads = false;
  clearModuleCalls = 0;
  moduleMutationNotifications = 0;
  moduleInventoryLoads = 0;

  constructor(items: FakeItem[] = []) {
    this.items.push(...items.map((item) => ({ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds], comments: [...item.comments] })));
  }

  async resolveVocabulary() {
    return { states: stateIds, modules: moduleIds };
  }

  async loadModuleMembershipInventory(): Promise<PlaneModuleMembershipInventory> {
    this.moduleInventoryLoads += 1;
    const memberships = new Map<string, string[]>();
    for (const moduleId of Object.values(moduleIds)) memberships.set(moduleId, []);
    for (const item of this.items) {
      for (const moduleId of item.moduleIds) {
        const workItemIds = memberships.get(moduleId) ?? [];
        workItemIds.push(item.id);
        memberships.set(moduleId, workItemIds);
      }
    }
    return new PlaneModuleMembershipInventory({ states: stateIds, modules: moduleIds }, memberships);
  }

  async findItemsByCanonicalIssueUrl(url: string): Promise<PlaneWorkItem[]> {
    return this.items.filter((item) => item.canonicalIssueUrl === url).map(copyItem);
  }

  async createAutomaticItem(input: {
    title: string;
    canonicalIssueUrl: string;
    stateId: string;
    priority: PlanePriority;
  }): Promise<PlaneWorkItem> {
    const id = `plane-${this.items.length + 129}`;
    const item: FakeItem = {
      id,
      name: input.title,
      descriptionHtml: `<p>Created from ${input.canonicalIssueUrl}</p>`,
      stateId: input.stateId,
      priority: input.priority,
      labelIds: [],
      moduleIds: [],
      canonicalIssueUrl: input.canonicalIssueUrl,
      comments: [],
    };
    this.items.push(item);
    return copyItem(item);
  }

  async getWorkItem(id: string): Promise<PlaneWorkItem> {
    const item = this.item(id);
    const copy = copyItem(item);
    return this.omitModuleIdsFromReads ? { ...copy, moduleIds: [] } : copy;
  }

  async patchProjection(current: PlaneWorkItem, patch: { stateId?: string; priority?: PlanePriority }): Promise<PlaneWorkItem> {
    const item = this.item(current.id);
    if (patch.stateId !== undefined) item.stateId = patch.stateId;
    if (patch.priority !== undefined) item.priority = patch.priority;
    return copyItem(item);
  }

  async setModule(
    id: string,
    moduleId: string,
    onMutation?: () => void,
    inventory?: PlaneModuleMembershipInventory,
  ): Promise<boolean> {
    if (this.setModuleFailures > 0) {
      this.setModuleFailures -= 1;
      throw new RetryableSyncError("plane_service_unavailable");
    }
    if (this.setModulePartialMutationFailures > 0) {
      this.setModulePartialMutationFailures -= 1;
      this.item(id).moduleIds = [];
      onMutation?.();
      this.moduleMutationNotifications += 1;
      throw new RetryableSyncError("plane_service_unavailable");
    }
    if (this.setModuleNoops > 0) {
      this.setModuleNoops -= 1;
      this.item(id).moduleIds = [moduleId];
      return false;
    }
    for (const currentModuleId of inventory?.moduleIdsForWorkItem(id) ?? []) {
      inventory?.removeMembership(currentModuleId, id);
    }
    inventory?.addMembership(moduleId, id);
    this.item(id).moduleIds = [moduleId];
    onMutation?.();
    this.moduleMutationNotifications += 1;
    return true;
  }

  async clearModule(
    id: string,
    onMutation?: () => void,
    inventory?: PlaneModuleMembershipInventory,
  ): Promise<boolean> {
    this.clearModuleCalls += 1;
    if (this.clearModuleNoops > 0) {
      this.clearModuleNoops -= 1;
      this.item(id).moduleIds = [];
      return false;
    }
    for (const currentModuleId of inventory?.moduleIdsForWorkItem(id) ?? []) {
      inventory?.removeMembership(currentModuleId, id);
    }
    this.item(id).moduleIds = [];
    onMutation?.();
    this.moduleMutationNotifications += 1;
    return true;
  }

  async listMilestoneExternalIds(id: string): Promise<Set<string>> {
    return new Set(this.item(id).comments.map((comment) => comment.externalId));
  }

  async addMilestone(id: string, milestone: { html: string; externalId: string }): Promise<void> {
    if (this.addMilestoneFailures > 0) {
      this.addMilestoneFailures -= 1;
      throw new RetryableSyncError("plane_service_unavailable");
    }
    this.item(id).comments.push({ externalId: milestone.externalId, html: milestone.html });
  }

  async addProjectionComment(id: string, comment: { html: string; externalId: string }): Promise<void> {
    this.item(id).comments.push({ externalId: comment.externalId, html: comment.html });
  }

  private item(id: string): FakeItem {
    const item = this.items.find((candidate) => candidate.id === id);
    if (!item) throw new PermanentSyncError("plane_work_item_missing");
    return item;
  }
}

function copyItem(item: FakeItem): PlaneWorkItem {
  return {
    ...item,
    labelIds: [...item.labelIds],
    moduleIds: [...item.moduleIds],
  };
}

function issue(number: number, overrides: Partial<GitHubIssueState> = {}): GitHubIssueState {
  return {
    number,
    title: `Issue ${number}`,
    state: "OPEN",
    stateReason: null,
    labels: [],
    url: `https://github.com/${repository}/issues/${number}`,
    updatedAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function issueDelivery(number: number, overrides: Partial<CompactDelivery> = {}): CompactDelivery {
  return {
    deliveryId: `b00c6c06-8888-4b6a-b3f9-${String(number).padStart(12, "0")}`,
    event: "issues",
    action: "opened",
    repository,
    subjectKind: "issue",
    subjectNumber: number,
    actorLogin: "nature-boy",
    occurredAt: "2026-08-01T12:00:00.000Z",
    ...overrides,
  };
}

function pullRequestDelivery(number: number, overrides: Partial<CompactDelivery> = {}): CompactDelivery {
  return {
    ...issueDelivery(number, {
      event: "pull_request",
      action: "opened",
      subjectKind: "pull_request",
      subjectNumber: number,
    }),
    ...overrides,
  };
}

function fakeItem(number: number, overrides: Partial<FakeItem> = {}): FakeItem {
  return {
    id: `plane-${number}`,
    name: `Curated item ${number}`,
    descriptionHtml: "<p>Manual roadmap context</p>",
    stateId: "state-todo",
    priority: "none",
    labelIds: ["manual-label"],
    moduleIds: [],
    canonicalIssueUrl: `https://github.com/${repository}/issues/${number}`,
    comments: [],
    ...overrides,
  };
}

function seedEntry(issueNumbers: number[], overrides: Partial<SeedRegistryEntry> = {}): SeedRegistryEntry {
  return {
    planeWorkItemId: "plane-129",
    issueNumbers,
    moduleName: "Product Confidence & Delivery",
    managedFields: ["state", "priority", "module", "milestones"],
    curatedTitle: true,
    ...overrides,
  };
}

function harness(options: {
  writeMode?: "active" | "dry-run";
  issues?: GitHubIssueState[];
  pullRequests?: GitHubPullRequestContext[];
  seedEntries?: SeedRegistryEntry[];
  mappings?: Array<{ issueNumber: number; planeWorkItemId: string }>;
  openPullRequestIssueNumbers?: number[];
  planeItems?: FakeItem[];
} = {}) {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-processor-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  const github = new FakeGitHub();
  for (const value of options.issues ?? [issue(129)]) github.issues.set(value.number, value);
  for (const issueNumber of options.openPullRequestIssueNumbers ?? []) github.openPullRequestByIssue.set(issueNumber, true);
  for (const value of options.pullRequests ?? []) github.pullRequests.set(value.pullRequest.number, value);
  for (const mapping of options.mappings ?? []) store.upsertMapping(mapping.issueNumber, mapping.planeWorkItemId);
  const plane = new FakePlane(options.planeItems);
  const registry: SeedRegistry = { version: 1, entries: options.seedEntries ?? [] };
  const logs: Array<Record<string, unknown>> = [];
  const deps: ProcessorDeps = {
    config: { writeMode: options.writeMode ?? "active" },
    store,
    github: github as unknown as GitHubClient,
    plane: plane as unknown as PlaneClient,
    registry: indexSeedRegistry(registry),
    now: () => now,
    log: (event) => logs.push({ ...event }),
  };
  return { deps, store, github, plane, logs };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("processDelivery", () => {
  it("creates an automatic Plane item and durable mapping for a new issue", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["priority:high", "plane:module/analytics-forecasting"] })],
    });

    const result = await processDelivery(test.deps, issueDelivery(129));

    expect(result).toMatchObject({ outcome: "mutated", created: 1 });
    expect(test.plane.items).toMatchObject([
      {
        canonicalIssueUrl: `https://github.com/${repository}/issues/129`,
        stateId: "state-todo",
        priority: "high",
        moduleIds: ["module-analytics"],
      },
    ]);
    expect(test.store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "plane-129", source: "automatic" },
    ]);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");
  });

  it("repairs one exact canonical URL mapping without creating a second item", async () => {
    const test = harness({ planeItems: [fakeItem(129)] });

    await processDelivery(test.deps, issueDelivery(129, { action: "edited" }));

    expect(test.plane.items).toHaveLength(1);
    expect(test.store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "plane-129", source: "automatic" },
    ]);
  });

  it("does not record a Plane mutation when a raced module convergence writes nothing", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["plane:module/analytics-forecasting"] })],
      seedEntries: [seedEntry([129], { managedFields: ["module"] })],
      planeItems: [fakeItem(129, { moduleIds: ["module-product"] })],
    });
    test.plane.setModuleNoops = 1;
    test.store.setCursor("last-successful-plane-mutation-at", "2026-08-01T11:55:00.000Z");

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "labeled" }))).resolves.toEqual({
      outcome: "noop",
      created: 0,
      updated: 0,
      comments: 0,
    });
    expect(test.plane.items[0]?.moduleIds).toEqual(["module-analytics"]);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T11:55:00.000Z");
  });

  it("records a Plane mutation after a successful module write", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["plane:module/analytics-forecasting"] })],
      seedEntries: [seedEntry([129], { managedFields: ["module"] })],
      planeItems: [fakeItem(129, { moduleIds: ["module-product"] })],
    });
    test.store.setCursor("last-successful-plane-mutation-at", "2026-08-01T11:55:00.000Z");

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "labeled" }))).resolves.toEqual({
      outcome: "mutated",
      created: 0,
      updated: 1,
      comments: 0,
    });
    expect(test.plane.items[0]?.moduleIds).toEqual(["module-analytics"]);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");
  });

  it("persists confirmed module work when later module convergence fails, then retries idempotently", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["plane:module/analytics-forecasting"] })],
      seedEntries: [seedEntry([129], { managedFields: ["module"] })],
      planeItems: [fakeItem(129, { moduleIds: ["module-product"] })],
    });
    test.plane.setModulePartialMutationFailures = 1;
    test.store.setCursor("last-successful-plane-mutation-at", "2026-08-01T11:55:00.000Z");

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "labeled" }))).rejects.toMatchObject({
      code: "plane_service_unavailable",
    });
    expect(test.plane.items[0]?.moduleIds).toEqual([]);
    expect(test.plane.moduleMutationNotifications).toBe(1);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "labeled" }))).resolves.toMatchObject({ outcome: "mutated" });
    expect(test.plane.items[0]?.moduleIds).toEqual(["module-analytics"]);
    expect(test.plane.moduleMutationNotifications).toBe(2);
  });

  it("records and recovers an automatic create when its later module convergence fails", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["plane:module/analytics-forecasting"] })],
    });
    test.plane.setModuleFailures = 1;

    await expect(processDelivery(test.deps, issueDelivery(129))).rejects.toMatchObject({
      code: "plane_service_unavailable",
    });
    expect(test.plane.items).toHaveLength(1);
    expect(test.store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "plane-129", source: "automatic" },
    ]);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");

    await expect(processDelivery(test.deps, issueDelivery(129))).resolves.toMatchObject({ outcome: "mutated" });
    expect(test.plane.items).toHaveLength(1);
    expect(test.plane.items[0]?.moduleIds).toEqual(["module-analytics"]);
  });

  it.each([
    ["issue comment", { event: "issue_comment", action: "created", subjectKind: "issue" }],
    ["edited issue history", { event: "issues", action: "edited", subjectKind: "issue" }],
    ["labeled issue history", { event: "issues", action: "labeled", subjectKind: "issue" }],
    ["assigned issue history", { event: "issues", action: "assigned", subjectKind: "issue" }],
  ] as const)("does not create an unmapped item from %s", async (_scenario, event) => {
    const test = harness();

    await expect(processDelivery(test.deps, issueDelivery(129, event))).resolves.toEqual({
      outcome: "noop",
      created: 0,
      updated: 0,
      comments: 0,
    });
    expect(test.plane.items).toEqual([]);
    expect(test.store.mappingsForIssue(129)).toEqual([]);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBeNull();
  });

  it("does not create unmapped issue items from pull-request history", async () => {
    const test = harness({
      issues: [issue(129)],
      pullRequests: [
        {
          pullRequest: {
            number: 200,
            state: "OPEN",
            isDraft: false,
            url: `https://github.com/${repository}/pull/200`,
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          closingIssueNumbers: [129],
        },
      ],
      openPullRequestIssueNumbers: [129],
    });

    await expect(processDelivery(test.deps, pullRequestDelivery(200))).resolves.toEqual({
      outcome: "noop",
      created: 0,
      updated: 0,
      comments: 0,
    });
    expect(test.plane.items).toEqual([]);
    expect(test.store.mappingsForIssue(129)).toEqual([]);
  });

  it("treats a legacy pull request conversation-comment envelope as a no-op", async () => {
    const test = harness({ issues: [] });
    test.github.pullRequestIssueNumbers.add(195);

    await expect(processDelivery(test.deps, issueDelivery(195, {
      event: "issue_comment",
      action: "created",
    }))).resolves.toEqual({
      outcome: "noop",
      created: 0,
      updated: 0,
      comments: 0,
    });
    expect(test.plane.items).toEqual([]);
    expect(test.store.mappingsForIssue(195)).toEqual([]);
  });

  it("fails closed rather than guessing when canonical URL recovery has multiple matches", async () => {
    const test = harness({ planeItems: [fakeItem(129), fakeItem(129, { id: "plane-duplicate" })] });

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "edited" }))).rejects.toMatchObject({
      code: "plane_mapping_ambiguous",
    });
    expect(test.store.mappingsForIssue(129)).toEqual([]);
    expect(test.plane.items).toHaveLength(2);
  });

  it("treats an unregistered durable seed mapping as a permanent mapping failure", async () => {
    const test = harness({ planeItems: [fakeItem(129)] });
    test.store.seedMappings({ version: 1, entries: [seedEntry([129])] });

    await expect(processDelivery(test.deps, issueDelivery(129))).rejects.toMatchObject({
      code: "plane_seed_mapping_unregistered",
    });
    expect(test.plane.items[0]).toMatchObject({ stateId: "state-todo", comments: [] });
  });

  it("refetches every linked issue before projecting a one-to-many curated item", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["status:backlog"] }), issue(130, { labels: ["status:in-progress"] })],
      seedEntries: [seedEntry([129, 130])],
      planeItems: [fakeItem(129)],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "labeled" }));

    expect(test.plane.items[0]).toMatchObject({ stateId: "state-active" });
  });

  it("plans a new item in dry-run without mutating Plane or durable mappings", async () => {
    const test = harness({ writeMode: "dry-run" });
    const before = JSON.stringify({ items: test.plane.items, mappings: test.store.mappingsForIssue(129) });

    const result = await processDelivery(test.deps, issueDelivery(129));

    expect(result).toMatchObject({ outcome: "planned", created: 1 });
    expect(JSON.stringify({ items: test.plane.items, mappings: test.store.mappingsForIssue(129) })).toBe(before);
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBeNull();
  });

  it("does nothing for an unlinked pull request", async () => {
    const test = harness({
      pullRequests: [
        {
          pullRequest: {
            number: 200,
            state: "OPEN",
            isDraft: false,
            url: `https://github.com/${repository}/pull/200`,
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          closingIssueNumbers: [],
        },
      ],
    });

    await expect(processDelivery(test.deps, pullRequestDelivery(200))).resolves.toEqual({
      outcome: "noop",
      created: 0,
      updated: 0,
      comments: 0,
    });
    expect(test.plane.items).toEqual([]);
  });

  it("updates every linked issue item for one pull request", async () => {
    const test = harness({
      issues: [issue(129), issue(130)],
      pullRequests: [
        {
          pullRequest: {
            number: 200,
            state: "OPEN",
            isDraft: false,
            url: `https://github.com/${repository}/pull/200`,
            updatedAt: "2026-08-01T12:00:00.000Z",
          },
          closingIssueNumbers: [129, 130],
        },
      ],
      openPullRequestIssueNumbers: [129, 130],
      mappings: [
        { issueNumber: 129, planeWorkItemId: "plane-129" },
        { issueNumber: 130, planeWorkItemId: "plane-130" },
      ],
      planeItems: [fakeItem(129), fakeItem(130)],
    });

    await processDelivery(test.deps, pullRequestDelivery(200));

    expect(test.plane.items).toHaveLength(2);
    expect(test.plane.items.map((item) => item.stateId)).toEqual(["state-active", "state-active"]);
    expect(test.store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "plane-129", source: "automatic" },
    ]);
    expect(test.store.mappingsForIssue(130)).toEqual([
      { issueNumber: 130, planeWorkItemId: "plane-130", source: "automatic" },
    ]);
  });

  it("keeps issue refreshes active while an authoritative linked PR is open and returns to Todo after it closes", async () => {
    const test = harness({
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      openPullRequestIssueNumbers: [129],
      planeItems: [fakeItem(129)],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "edited" }));
    expect(test.plane.items[0]?.stateId).toBe("state-active");

    await processDelivery(test.deps, issueDelivery(129, {
      deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000130",
      event: "issue_comment",
      action: "created",
    }));
    expect(test.plane.items[0]?.stateId).toBe("state-active");

    test.github.openPullRequestByIssue.set(129, false);
    await processDelivery(test.deps, issueDelivery(129, {
      deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000131",
      event: "issue_comment",
      action: "edited",
    }));
    expect(test.plane.items[0]?.stateId).toBe("state-todo");
  });

  it("refreshes an issue comment without mirroring its body into Plane", async () => {
    const test = harness({ planeItems: [fakeItem(129)] });
    const delivery = Object.assign(issueDelivery(129, { event: "issue_comment", action: "created" }), {
      body: "private comment body must never be mirrored",
    }) as CompactDelivery;

    await processDelivery(test.deps, delivery);

    expect(JSON.stringify(test.plane.items)).not.toContain("private comment body must never be mirrored");
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");
  });

  it("changes only managed state, priority, and module while preserving manual Plane content", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["status:in-progress", "priority:high", "plane:module/analytics-forecasting"] })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [
        fakeItem(129, {
          name: "Manual title",
          descriptionHtml: "<p>Manual roadmap prose</p>",
          labelIds: ["manual-label-a", "manual-label-b"],
          stateId: "state-backlog",
          priority: "low",
          moduleIds: ["module-product"],
        }),
      ],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "labeled" }));

    expect(test.plane.items[0]).toMatchObject({
      name: "Manual title",
      descriptionHtml: "<p>Manual roadmap prose</p>",
      labelIds: ["manual-label-a", "manual-label-b"],
      stateId: "state-active",
      priority: "high",
      moduleIds: ["module-analytics"],
    });
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");
  });

  it.each([
    {
      name: "priority only",
      managedFields: ["priority"],
      issueNumbers: [129],
      expected: { stateId: "state-backlog", priority: "high", moduleIds: ["module-product"], comments: 0 },
    },
    {
      name: "module only",
      managedFields: ["module"],
      issueNumbers: [129],
      expected: { stateId: "state-backlog", priority: "low", moduleIds: ["module-analytics"], comments: 0 },
    },
    {
      name: "milestones only",
      managedFields: ["milestones"],
      issueNumbers: [129],
      expected: { stateId: "state-backlog", priority: "low", moduleIds: ["module-product"], comments: 1 },
    },
    {
      name: "combined priority module and milestones",
      managedFields: ["priority", "module", "milestones"],
      issueNumbers: [129],
      expected: { stateId: "state-backlog", priority: "high", moduleIds: ["module-analytics"], comments: 1 },
    },
    {
      name: "aggregate priority ownership",
      managedFields: ["priority"],
      issueNumbers: [129, 130],
      expected: { stateId: "state-backlog", priority: "high", moduleIds: ["module-product"], comments: 0 },
    },
  ] satisfies Array<{
    name: string;
    managedFields: SeedRegistryEntry["managedFields"];
    issueNumbers: number[];
    expected: { stateId: string; priority: PlanePriority; moduleIds: string[]; comments: number };
  }>)("enforces the seed managedFields boundary for $name", async ({ managedFields, issueNumbers, expected }) => {
    const issues = issueNumbers.map((number) => issue(number, {
      labels: number === 129
        ? ["status:in-progress", "priority:high", "plane:module/analytics-forecasting"]
        : [],
    }));
    const test = harness({
      issues,
      seedEntries: [seedEntry(issueNumbers, { managedFields })],
      planeItems: [fakeItem(129, {
        name: "Human curated title",
        descriptionHtml: "<p>Human roadmap narrative</p>",
        labelIds: ["human-label"],
        stateId: "state-backlog",
        priority: "low",
        moduleIds: ["module-product"],
      })],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "labeled" }));

    expect(test.plane.items[0]).toMatchObject({
      name: "Human curated title",
      descriptionHtml: "<p>Human roadmap narrative</p>",
      labelIds: ["human-label"],
      stateId: expected.stateId,
      priority: expected.priority,
      moduleIds: expected.moduleIds,
    });
    expect(test.plane.items[0]?.comments).toHaveLength(expected.comments);
  });

  it("emits work_started only for the projection that actually enters In Progress", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["status:in-progress"] })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129)],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "labeled" }));
    expect(test.plane.items[0]?.stateId).toBe("state-active");

    await processDelivery(test.deps, issueDelivery(129, {
      deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000130",
      action: "assigned",
    }));
    await processDelivery(test.deps, issueDelivery(129, {
      deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000131",
      event: "issue_comment",
      action: "created",
    }));

    expect(test.plane.items[0]?.comments.filter((comment) => comment.externalId.includes(":work_started:"))).toHaveLength(1);
  });

  it("clears an automatic module when the module label is removed and reports Unassigned", async () => {
    const test = harness({
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129, { moduleIds: ["module-analytics"] })],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "unlabeled" }));
    await processDelivery(test.deps, issueDelivery(129, {
      deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000130",
      action: "edited",
    }));

    expect(test.plane.items[0]?.moduleIds).toEqual([]);
    expect(test.plane.items[0]?.comments.some((comment) => comment.html.includes("Module:</strong> Unassigned"))).toBe(true);
  });

  it("uses authoritative module clearing when an automatic item read omits module ids", async () => {
    const test = harness({
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129, { moduleIds: ["module-analytics"] })],
    });
    test.plane.omitModuleIdsFromReads = true;

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "unlabeled" }))).resolves.toMatchObject({
      outcome: "mutated",
      updated: 1,
    });

    expect(test.plane.clearModuleCalls).toBe(1);
    expect(test.plane.items[0]?.moduleIds).toEqual([]);
  });

  it.each([
    {
      name: "plans assignment from a legacy module",
      labels: ["plane:module/analytics-forecasting"],
      moduleIds: ["legacy-module"],
      updated: 1,
    },
    {
      name: "reports an assigned module as a no-op",
      labels: ["plane:module/analytics-forecasting"],
      moduleIds: ["module-analytics"],
      updated: 0,
    },
    {
      name: "plans clearing a legacy module when unassigned",
      labels: [],
      moduleIds: ["legacy-module"],
      updated: 1,
    },
    {
      name: "reports an unassigned item as a no-op",
      labels: [],
      moduleIds: [],
      updated: 0,
    },
  ])("uses inventory truth to $name in dry-run even when work-item reads omit module ids", async ({ labels, moduleIds, updated }) => {
    const test = harness({
      writeMode: "dry-run",
      issues: [issue(129, { labels })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129, { moduleIds })],
    });
    test.plane.omitModuleIdsFromReads = true;
    const before = JSON.stringify(test.plane.items);

    await expect(processDelivery(test.deps, issueDelivery(129, { action: "edited" }))).resolves.toMatchObject({ updated });

    expect(JSON.stringify(test.plane.items)).toBe(before);
    expect(test.plane.clearModuleCalls).toBe(0);
    expect(test.plane.moduleInventoryLoads).toBe(1);
  });

  it("preserves the seeded curated module when GitHub has no module override", async () => {
    const test = harness({
      seedEntries: [seedEntry([129])],
      planeItems: [fakeItem(129, { moduleIds: ["module-product"] })],
    });

    await processDelivery(test.deps, issueDelivery(129, { action: "unlabeled" }));

    expect(test.plane.items[0]?.moduleIds).toEqual(["module-product"]);
  });

  it("leaves every mapped Plane and local identity unchanged in dry-run", async () => {
    const incoming = issueDelivery(129, { action: "labeled" });
    const milestoneId = `github:${incoming.deliveryId}:work_started:plane-129`;
    const test = harness({
      writeMode: "dry-run",
      issues: [issue(129, { labels: ["status:in-progress", "priority:high"] })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129, {
        stateId: "state-backlog",
        priority: "low",
        moduleIds: ["module-analytics"],
      })],
    });
    const before = JSON.stringify(test.plane.items);
    const mappingsBefore = test.store.mappingsForIssue(129);

    await expect(processDelivery(test.deps, incoming)).resolves.toMatchObject({ outcome: "planned" });

    expect(JSON.stringify(test.plane.items)).toBe(before);
    expect(test.store.mappingsForIssue(129)).toEqual(mappingsBefore);
    expect(test.store.hasMilestone(milestoneId, "plane-129")).toBe(false);
    expect(test.store.getCursor(`delivery-transition:${incoming.deliveryId}:work_started:plane-129`)).toBeNull();
    expect(test.plane.items[0]?.comments).toEqual([]);
  });

  it("deduplicates comments using both Plane external IDs and local milestone records", async () => {
    const externalMilestoneId = "github:b00c6c06-8888-4b6a-b3f9-000000000129:work_started:plane-129";
    const test = harness({
      issues: [issue(129, { labels: ["status:in-progress"] })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129, { comments: [{ externalId: externalMilestoneId, html: "<p>Already in Plane</p>" }] })],
    });

    await processDelivery(test.deps, issueDelivery(129));
    await processDelivery(test.deps, issueDelivery(129));

    expect(test.plane.items[0]?.comments.filter((comment) => comment.externalId === externalMilestoneId)).toHaveLength(1);
    expect(test.plane.items[0]?.comments.filter((comment) => comment.externalId.startsWith("projection:"))).toHaveLength(1);
    expect(test.store.hasMilestone(externalMilestoneId, "plane-129")).toBe(true);
  });

  it("replays after a partial Plane failure without recording or duplicating the failed milestone", async () => {
    const test = harness({
      issues: [issue(129, { labels: ["status:in-progress"] })],
      mappings: [{ issueNumber: 129, planeWorkItemId: "plane-129" }],
      planeItems: [fakeItem(129)],
    });
    const incoming = issueDelivery(129);
    const milestoneId = "github:b00c6c06-8888-4b6a-b3f9-000000000129:work_started:plane-129";
    test.plane.addMilestoneFailures = 1;

    await expect(processDelivery(test.deps, incoming)).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(test.store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-01T12:00:00.000Z");
    expect(test.store.hasMilestone(milestoneId, "plane-129")).toBe(false);
    expect(test.plane.items[0]?.comments.some((comment) => comment.externalId === milestoneId)).toBe(false);

    await expect(processDelivery(test.deps, incoming)).resolves.toMatchObject({ outcome: "mutated" });
    expect(test.store.hasMilestone(milestoneId, "plane-129")).toBe(true);
    expect(test.plane.items[0]?.comments.filter((comment) => comment.externalId === milestoneId)).toHaveLength(1);
    expect(test.plane.items[0]?.comments.filter((comment) => comment.externalId.startsWith("projection:"))).toHaveLength(1);
  });
});
