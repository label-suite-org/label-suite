import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildHealthSnapshot, reportHealthToPlane, type HealthReportDeps } from "./health.js";
import { RetryableSyncError } from "./errors.js";
import { SqliteDeliveryStore } from "./store.js";
import type { CompactDelivery, PublicHealth } from "./types.js";

const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];
const now = new Date("2026-08-02T10:00:00.000Z");

function delivery(): CompactDelivery {
  return {
    deliveryId: "b00c6c06-8888-4b6a-b3f9-000000000128",
    event: "issues",
    action: "opened",
    repository: "label-suite-org/label-suite_neon_r2",
    subjectKind: "issue",
    subjectNumber: 128,
    actorLogin: "nature-boy",
    occurredAt: "2026-08-02T09:00:00.000Z",
  };
}

function failedStore(): SqliteDeliveryStore {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-health-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  store.recordDelivery(delivery(), "2026-08-02T09:00:00.000Z");
  const claimed = store.claimNext("2026-08-02T09:01:00.000Z");
  if (!claimed) throw new Error("expected a claimed delivery");
  store.failDelivery(claimed.lease, "plane_mapping_ambiguous", "2026-08-02T09:02:00.000Z");
  return store;
}

function temporaryStore(): SqliteDeliveryStore {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-health-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  return store;
}

function healthSnapshot(overrides: Partial<PublicHealth> = {}): PublicHealth {
  return {
    status: "ok",
    revision: "a1b2c3d",
    lastAcceptedAt: null,
    lastPlaneMutationAt: "2026-08-02T09:55:00.000Z",
    lastReconciliationAt: "2026-08-02T09:59:00.000Z",
    pending: 0,
    permanentlyFailed: 0,
    lastErrorCode: null,
    ...overrides,
  };
}

function healthPlane() {
  const item = {
    id: "health-item",
    name: "[System] GitHub to Plane sync health",
    descriptionHtml: "<p>Manual escalation owner</p>",
    stateId: "todo",
    priority: "none" as "none" | "low" | "medium" | "high" | "urgent",
    labelIds: ["manual-label"],
    moduleIds: ["module-product"],
  };
  const comments: Array<{ externalId: string; html: string }> = [];
  let unavailable = false;
  let rejectCommentMutation = false;
  return {
    item,
    comments,
    setUnavailable(value: boolean) {
      unavailable = value;
    },
    setRejectCommentMutation(value: boolean) {
      rejectCommentMutation = value;
    },
    client: {
      async getWorkItem(id: string) {
        if (unavailable) throw new RetryableSyncError("plane_service_unavailable");
        if (id !== item.id) throw new Error("unexpected item");
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async findHealthItems() {
        if (unavailable) throw new RetryableSyncError("plane_service_unavailable");
        return [{ ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] }];
      },
      async patchProjection(_current: unknown, patch: { priority?: "none" | "low" | "medium" | "high" | "urgent" }) {
        if (unavailable) throw new RetryableSyncError("plane_service_unavailable");
        if (patch.priority !== undefined) item.priority = patch.priority;
        return { ...item, labelIds: [...item.labelIds], moduleIds: [...item.moduleIds] };
      },
      async upsertHealthComment(_id: string, comment: { externalId: string; html: string }) {
        if (unavailable) throw new RetryableSyncError("plane_service_unavailable");
        if (rejectCommentMutation) throw new RetryableSyncError("plane_service_unavailable");
        if (comments.some((current) => current.externalId === comment.externalId)) return false;
        comments.push({ ...comment });
        return true;
      },
    } satisfies HealthReportDeps["plane"],
  };
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("buildHealthSnapshot", () => {
  it("reports permanent failures using only the approved public fields", async () => {
    const health = await buildHealthSnapshot({ store: failedStore(), revision: "a1b2c3d" }, now);

    expect(health).toEqual({
      status: "failed",
      revision: "a1b2c3d",
      lastAcceptedAt: "2026-08-02T09:00:00.000Z",
      lastPlaneMutationAt: null,
      lastReconciliationAt: null,
      pending: 0,
      permanentlyFailed: 1,
      lastErrorCode: "plane_mapping_ambiguous",
    });
    expect(Object.keys(health).sort()).toEqual([
      "lastAcceptedAt",
      "lastErrorCode",
      "lastPlaneMutationAt",
      "lastReconciliationAt",
      "pending",
      "permanentlyFailed",
      "revision",
      "status",
    ]);
  });

  it("reports a retry backlog as degraded without presenting it as a pending delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "plane-sync-health-"));
    directories.push(directory);
    const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
    stores.push(store);
    store.recordDelivery(delivery(), "2026-08-02T09:00:00.000Z");
    const claimed = store.claimNext("2026-08-02T09:01:00.000Z");
    if (!claimed) throw new Error("expected a claimed delivery");
    store.retryDelivery(claimed.lease, "plane_service_unavailable", "2026-08-02T09:02:00.000Z");
    store.setCursor("last-successful-reconciliation-at", "2026-08-02T09:59:00.000Z");

    await expect(buildHealthSnapshot({ store, revision: "a1b2c3d" }, now)).resolves.toMatchObject({
      status: "degraded",
      pending: 0,
      permanentlyFailed: 0,
      lastErrorCode: "plane_service_unavailable",
    });
  });

  it("is degraded when reconciliation is stale and returns to ok after a fresh successful reconciliation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "plane-sync-health-"));
    directories.push(directory);
    const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
    stores.push(store);
    store.setCursor("last-successful-reconciliation-at", "2026-08-02T09:29:59.999Z");

    await expect(buildHealthSnapshot({ store, revision: "a1b2c3d" }, now)).resolves.toMatchObject({ status: "degraded" });
    store.setCursor("last-successful-reconciliation-at", "2026-08-02T09:30:00.000Z");
    await expect(buildHealthSnapshot({ store, revision: "a1b2c3d" }, now)).resolves.toMatchObject({ status: "ok" });
  });

  it("surfaces an active sanitized runtime failure and clears it after source recovery", async () => {
    const store = temporaryStore();
    store.setCursor("last-successful-reconciliation-at", "2026-08-02T09:59:00.000Z");
    store.recordRuntimeFailure("health", "plane_service_unavailable", "2026-08-02T09:59:30.000Z");

    await expect(buildHealthSnapshot({ store, revision: "a1b2c3d" }, now)).resolves.toMatchObject({
      status: "failed",
      lastErrorCode: "plane_service_unavailable",
    });

    store.clearRuntimeFailure("health", "2026-08-02T10:00:00.000Z");
    await expect(buildHealthSnapshot({ store, revision: "a1b2c3d" }, now)).resolves.toMatchObject({
      status: "ok",
      lastErrorCode: null,
    });
  });

  it("records the timestamp of successful Plane priority and comment mutations", async () => {
    const store = failedStore();
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    const plane = healthPlane();
    const reportedAt = new Date("2026-08-02T10:00:00.000Z");
    const failure = healthSnapshot({
      status: "failed",
      permanentlyFailed: 1,
      lastErrorCode: "plane_mapping_ambiguous",
    });

    await reportHealthToPlane({ store, plane: plane.client, now: () => reportedAt }, failure);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
    expect(plane.item).toMatchObject({
      priority: "high",
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation owner</p>",
      labelIds: ["manual-label"],
    });
    expect(plane.comments.filter((comment) => comment.externalId.startsWith("health:failure:"))).toHaveLength(1);
    expect(plane.comments.filter((comment) => comment.externalId.startsWith("health:status:"))).toHaveLength(1);

    await reportHealthToPlane({ store, plane: plane.client, now: () => reportedAt }, failure);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");

    await reportHealthToPlane({ store, plane: plane.client, now: () => reportedAt }, healthSnapshot());
    await reportHealthToPlane({ store, plane: plane.client, now: () => reportedAt }, healthSnapshot());
    expect(plane.item.priority).toBe("none");
    expect(plane.comments.filter((comment) => comment.externalId.startsWith("health:recovery:"))).toHaveLength(1);
    expect(store.getCursor("health-failure-episode")).toBeNull();
  });

  it("keeps identical snapshots and one status comment across repeated unchanged reporting cycles", async () => {
    const store = temporaryStore();
    const plane = healthPlane();
    const firstMutationAt = new Date("2026-08-02T10:00:00.000Z");
    const unchangedAt = new Date("2026-08-02T10:01:00.000Z");
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    store.setCursor("last-successful-reconciliation-at", "2026-08-02T09:59:00.000Z");
    const snapshot = await buildHealthSnapshot({ store, revision: "a1b2c3d" }, now);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      await reportHealthToPlane({
        store,
        plane: plane.client,
        now: () => cycle === 0 ? firstMutationAt : unchangedAt,
      }, snapshot);
    }

    expect(plane.comments.filter((comment) => comment.externalId.startsWith("health:status:"))).toHaveLength(1);
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T10:00:00.000Z");
    expect(plane.item).toMatchObject({
      name: "[System] GitHub to Plane sync health",
      descriptionHtml: "<p>Manual escalation owner</p>",
      priority: "none",
      labelIds: ["manual-label"],
      moduleIds: ["module-product"],
    });
  });

  it("keeps the last successful reported snapshot when Plane is unavailable", async () => {
    const store = failedStore();
    const plane = healthPlane();
    const previous = healthSnapshot();
    await reportHealthToPlane({ store, plane: plane.client }, previous);
    const known = store.getCursor("last-successful-health-snapshot");
    plane.setUnavailable(true);

    await expect(
      reportHealthToPlane(
        { store, plane: plane.client },
        healthSnapshot({ status: "degraded", pending: 2, lastErrorCode: "plane_service_unavailable" }),
      ),
    ).rejects.toMatchObject({ code: "plane_service_unavailable" });
    expect(store.getCursor("last-successful-health-snapshot")).toBe(known);
  });

  it("does not advance the Plane mutation timestamp when a health comment write fails", async () => {
    const store = temporaryStore();
    const plane = healthPlane();
    store.setCursor("last-successful-plane-mutation-at", "2026-08-02T09:55:00.000Z");
    plane.setRejectCommentMutation(true);

    await expect(
      reportHealthToPlane({
        store,
        plane: plane.client,
        now: () => new Date("2026-08-02T10:00:00.000Z"),
      }, healthSnapshot()),
    ).rejects.toMatchObject({ code: "plane_service_unavailable" });

    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T09:55:00.000Z");
  });

  it("escapes every dynamic health value before writing the managed Plane comment", async () => {
    const store = failedStore();
    const plane = healthPlane();
    await reportHealthToPlane(
      { store, plane: plane.client },
      healthSnapshot({ revision: 'rev"><img src=x onerror=alert(1)>', lastErrorCode: '<script>alert(1)</script>' }),
    );

    const [comment] = plane.comments.filter((entry) => entry.externalId.startsWith("health:status:"));
    expect(comment?.html).toContain("rev&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    expect(comment?.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(comment?.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(comment?.html).not.toContain("<script>alert(1)</script>");
  });
});
