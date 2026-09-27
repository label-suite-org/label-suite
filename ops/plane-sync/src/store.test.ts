import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDeliveryStore } from "./store.js";
import type { CompactDelivery, SeedRegistry } from "./types.js";

const receivedAt = "2026-08-01T12:00:00.000Z";
const fiveMinutesLater = "2026-08-01T12:05:00.000Z";
const thirtyMinutesLater = "2026-08-01T12:30:00.000Z";

const registry: SeedRegistry = {
  version: 1,
  entries: [
    {
      planeWorkItemId: "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
      issueNumbers: [81],
      moduleName: "Product Confidence & Delivery",
      managedFields: ["state", "milestones"],
      curatedTitle: true,
    },
    {
      planeWorkItemId: "d2c1f1e8-c690-434c-b5a2-7359b2388f4b",
      issueNumbers: [81],
      moduleName: "Analytics & Forecasting",
      managedFields: ["state", "milestones"],
      curatedTitle: true,
    },
  ],
};

const databases: string[] = [];
const stores = new Set<SqliteDeliveryStore>();

function temporaryDatabase(): string {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-store-"));
  databases.push(directory);
  return join(directory, "plane-sync.sqlite");
}

function openStore(path = temporaryDatabase()): SqliteDeliveryStore {
  const store = SqliteDeliveryStore.open(path);
  stores.add(store);
  return store;
}

function closeStore(store: SqliteDeliveryStore): void {
  store.close();
  stores.delete(store);
}

function delivery(sequence = 1, overrides: Partial<CompactDelivery> = {}): CompactDelivery {
  return {
    deliveryId: `10000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    event: "issues",
    action: "opened",
    repository: "label-suite-org/label-suite_neon_r2",
    subjectKind: "issue",
    subjectNumber: sequence,
    actorLogin: "nature-boy",
    occurredAt: receivedAt,
    ...overrides,
  };
}

function deliveryRow(path: string, deliveryId: string): Record<string, unknown> {
  const database = new DatabaseSync(path);
  const row = database.prepare("SELECT * FROM deliveries WHERE delivery_id = ?").get(deliveryId) as Record<string, unknown>;
  database.close();
  return row;
}

function recoveryAuditRows(path: string): Array<Record<string, unknown>> {
  const database = new DatabaseSync(path);
  const rows = database.prepare("SELECT * FROM delivery_recovery_audits ORDER BY audit_id").all() as Array<Record<string, unknown>>;
  database.close();
  return rows;
}

function requireClaim(store: SqliteDeliveryStore, at: string) {
  const claimed = store.claimNext(at);
  if (!claimed) throw new Error("expected a delivery claim");
  return claimed;
}

function legacyDatabase(): string {
  const path = temporaryDatabase();
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE deliveries (
      delivery_id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      action TEXT NOT NULL,
      repository TEXT NOT NULL,
      subject_kind TEXT NOT NULL,
      subject_number INTEGER,
      actor_login TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      compact_json TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','processing','completed','retry','failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error_code TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE mappings (
      issue_number INTEGER NOT NULL,
      plane_work_item_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('seed','automatic')),
      PRIMARY KEY (issue_number, plane_work_item_id)
    );
    CREATE TABLE milestones (
      milestone_id TEXT NOT NULL,
      plane_work_item_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (milestone_id, plane_work_item_id)
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  database.close();
  return path;
}

afterEach(() => {
  for (const store of stores) store.close();
  stores.clear();
  for (const directory of databases.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SqliteDeliveryStore", () => {
  it("records a delivery once and claims it once", () => {
    const store = openStore();
    const incoming = delivery();

    expect(store.recordDelivery(incoming, receivedAt)).toEqual({ inserted: true });
    expect(store.recordDelivery(incoming, receivedAt)).toEqual({ inserted: false });
    expect(store.claimNext(receivedAt)).toMatchObject({
      deliveryId: incoming.deliveryId,
      state: "processing",
      attemptCount: 1,
    });
    expect(store.claimNext(receivedAt)).toBeNull();
  });

  it("initializes a file-backed database with WAL mode and schema version three", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    closeStore(store);
    const database = new DatabaseSync(path);

    expect(database.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    database.close();
  });

  it("upgrades a version-one inbox without losing its stored delivery identity", () => {
    const path = legacyDatabase();
    const database = new DatabaseSync(path);
    const incoming = delivery();
    const olderFailure = delivery(2);
    const newerFailure = delivery(3);
    database
      .prepare(
        `INSERT INTO deliveries (
          delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
          compact_json, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        incoming.deliveryId,
        incoming.event,
        incoming.action,
        incoming.repository,
        incoming.subjectKind,
        incoming.subjectNumber,
        incoming.actorLogin,
        incoming.occurredAt,
        JSON.stringify(incoming),
        receivedAt,
      );
    database
      .prepare(
        `INSERT INTO deliveries (
          delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
          compact_json, state, attempt_count, last_error_code, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 1, 'LEGACY_OLDER', ?)`,
      )
      .run(
        olderFailure.deliveryId,
        olderFailure.event,
        olderFailure.action,
        olderFailure.repository,
        olderFailure.subjectKind,
        olderFailure.subjectNumber,
        olderFailure.actorLogin,
        olderFailure.occurredAt,
        JSON.stringify(olderFailure),
        "2026-08-01T10:00:00.000Z",
      );
    database
      .prepare(
        `INSERT INTO deliveries (
          delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
          compact_json, state, attempt_count, last_error_code, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'failed', 2, 'LEGACY_NEWER', ?, ?)`,
      )
      .run(
        newerFailure.deliveryId,
        newerFailure.event,
        newerFailure.action,
        newerFailure.repository,
        newerFailure.subjectKind,
        newerFailure.subjectNumber,
        newerFailure.actorLogin,
        newerFailure.occurredAt,
        JSON.stringify(newerFailure),
        "2026-08-01T11:30:00.000Z",
        "2026-08-01T11:00:00.000Z",
      );
    database.close();

    const store = openStore(path);
    expect(requireClaim(store, receivedAt)).toMatchObject({ deliveryId: incoming.deliveryId, attemptCount: 1 });
    expect(store.healthStats()).toMatchObject({ permanentlyFailed: 2, lastErrorCode: "LEGACY_NEWER" });
    closeStore(store);

    const upgraded = new DatabaseSync(path);
    expect(upgraded.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(
      (upgraded.prepare("PRAGMA table_info(deliveries)").all() as Array<{ name: string }>).map((column) => column.name),
    ).toContain("lease_token");
    expect(
      (upgraded.prepare("PRAGMA table_info(deliveries)").all() as Array<{ name: string }>).map((column) => column.name),
    ).toContain("last_error_at");
    expect(upgraded.prepare("SELECT last_error_at FROM deliveries WHERE delivery_id = ?").get(olderFailure.deliveryId)).toEqual({
      last_error_at: "2026-08-01T10:00:00.000Z",
    });
    expect(upgraded.prepare("SELECT last_error_at FROM deliveries WHERE delivery_id = ?").get(newerFailure.deliveryId)).toEqual({
      last_error_at: "2026-08-01T11:30:00.000Z",
    });
    expect(
      (upgraded.prepare("PRAGMA table_info(delivery_recovery_audits)").all() as Array<{ name: string }>).map((column) => column.name),
    ).toEqual([
      "audit_id",
      "delivery_id",
      "previous_error_code",
      "previous_attempt_count",
      "reason",
      "operator",
      "action",
      "created_at",
    ]);
    upgraded.close();
  });

  it("keeps a delivery deduplicated across a clean close and process restart", () => {
    const path = temporaryDatabase();
    const incoming = delivery();
    const first = openStore(path);

    expect(first.recordDelivery(incoming, receivedAt)).toEqual({ inserted: true });
    closeStore(first);

    const restarted = openStore(path);
    expect(restarted.recordDelivery(incoming, fiveMinutesLater)).toEqual({ inserted: false });
    expect(restarted.claimNext(fiveMinutesLater)).toMatchObject({ deliveryId: incoming.deliveryId, state: "processing" });
  });

  it("claims otherwise equal pending deliveries in delivery-ID order", () => {
    const store = openStore();
    const laterId = delivery(2);
    const earlierId = delivery(1);

    store.recordDelivery(laterId, receivedAt);
    store.recordDelivery(earlierId, receivedAt);

    expect(store.claimNext(receivedAt)?.deliveryId).toBe(earlierId.deliveryId);
    expect(store.claimNext(receivedAt)?.deliveryId).toBe(laterId.deliveryId);
  });

  it("reclaims a processing delivery only after its ten-minute lease is stale", () => {
    const store = openStore();
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    expect(store.claimNext(receivedAt)).toMatchObject({ attemptCount: 1, state: "processing" });

    expect(store.claimNext("2026-08-01T12:09:59.999Z")).toBeNull();
    expect(store.claimNext("2026-08-01T12:10:00.001Z")).toMatchObject({
      deliveryId: incoming.deliveryId,
      attemptCount: 2,
      state: "processing",
    });
  });

  it("schedules the same failed delivery with deterministic bounded exponential jitter", () => {
    const pathA = temporaryDatabase();
    const pathB = temporaryDatabase();
    const incoming = delivery();
    const first = openStore(pathA);
    const second = openStore(pathB);

    first.recordDelivery(incoming, receivedAt);
    second.recordDelivery(incoming, receivedAt);
    const firstClaim = requireClaim(first, receivedAt);
    const secondClaim = requireClaim(second, receivedAt);
    first.retryDelivery(firstClaim.lease, "PLANE_UNAVAILABLE", receivedAt);
    second.retryDelivery(secondClaim.lease, "PLANE_UNAVAILABLE", receivedAt);

    const nextA = deliveryRow(pathA, incoming.deliveryId).next_attempt_at as string;
    const nextB = deliveryRow(pathB, incoming.deliveryId).next_attempt_at as string;
    const delay = Date.parse(nextA) - Date.parse(receivedAt);
    expect(nextA).toBe(nextB);
    expect(delay).toBeGreaterThanOrEqual(1_000);
    expect(delay).toBeLessThan(1_100);
    expect(requireClaim(first, nextA)).toMatchObject({ attemptCount: 2, state: "processing" });
  });

  it("terminalizes the eighth retry request with the approved retry_exhausted code", () => {
    const path = temporaryDatabase();
    const persistent = openStore(path);
    const incoming = delivery();
    persistent.recordDelivery(incoming, receivedAt);

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const claimed = requireClaim(persistent, `2026-08-01T${String(12 + attempt).padStart(2, "0")}:00:00.000Z`);
      expect(claimed).toMatchObject({
        attemptCount: attempt,
        state: "processing",
      });
      persistent.retryDelivery(
        claimed.lease,
        "PLANE_UNAVAILABLE",
        `2026-08-01T${String(12 + attempt).padStart(2, "0")}:00:00.000Z`,
      );
    }

    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      state: "failed",
      attempt_count: 8,
      last_error_code: "retry_exhausted",
      last_error_at: "2026-08-01T20:00:00.000Z",
    });
    expect(persistent.claimNext("2026-08-02T00:00:00.000Z")).toBeNull();
  });

  it("terminalizes an eighth stale lease with retry_exhausted and never claims it again", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    const claimTimes = [
      "2026-08-01T12:00:00.000Z",
      "2026-08-01T12:10:00.001Z",
      "2026-08-01T12:20:00.002Z",
      "2026-08-01T12:30:00.003Z",
      "2026-08-01T12:40:00.004Z",
      "2026-08-01T12:50:00.005Z",
      "2026-08-01T13:00:00.006Z",
      "2026-08-01T13:10:00.007Z",
    ];
    store.recordDelivery(incoming, claimTimes[0]);

    for (const [index, claimAt] of claimTimes.entries()) {
      const claimed = requireClaim(store, claimAt);
      expect(claimed).toMatchObject({ attemptCount: index + 1, state: "processing" });
      if (index === 1) expect(claimed.lastErrorCode).toBe("WORKER_LEASE_EXPIRED");
    }

    expect(store.claimNext("2026-08-01T13:20:00.008Z")).toBeNull();
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      state: "failed",
      attempt_count: 8,
      last_error_code: "retry_exhausted",
      last_error_at: "2026-08-01T13:20:00.008Z",
    });
    expect(store.claimNext("2026-08-02T00:00:00.000Z")).toBeNull();
  });

  it("does not schedule an explicitly permanent failure for replay", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    const claimed = requireClaim(store, receivedAt);

    store.failDelivery(claimed.lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);

    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      state: "failed",
      last_error_code: "PLANE_MAPPING_AMBIGUOUS",
      completed_at: fiveMinutesLater,
    });
    expect(store.claimNext(thirtyMinutesLater)).toBeNull();
  });

  it("reports a failed delivery in dry-run mode without mutating the delivery or audit trail", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    store.failDelivery(requireClaim(store, receivedAt).lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);

    expect(
      store.recoverFailedDeliveries({
        deliveryIds: [incoming.deliveryId],
        reason: "mapping-reviewed",
        operator: "ops@example.test",
        apply: false,
        now: "2026-08-01T13:00:00.000Z",
      }),
    ).toEqual({ mode: "dry-run", requested: 1, eligible: 1, requeued: 0 });
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      state: "failed",
      attempt_count: 1,
      last_error_code: "PLANE_MAPPING_AMBIGUOUS",
      completed_at: fiveMinutesLater,
    });
    expect(recoveryAuditRows(path)).toEqual([]);
  });

  it("audits a failed delivery before resetting it for a fresh worker attempt", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    const claim = requireClaim(store, receivedAt);
    store.failDelivery(claim.lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);
    const original = deliveryRow(path, incoming.deliveryId);

    expect(
      store.recoverFailedDeliveries({
        deliveryIds: [incoming.deliveryId],
        reason: "mapping-reviewed",
        operator: "ops@example.test",
        apply: true,
        now: "2026-08-01T13:00:00.000Z",
      }),
    ).toEqual({ mode: "active", requested: 1, eligible: 1, requeued: 1 });
    expect(recoveryAuditRows(path)).toEqual([
      {
        audit_id: 1,
        delivery_id: incoming.deliveryId,
        previous_error_code: "PLANE_MAPPING_AMBIGUOUS",
        previous_attempt_count: 1,
        reason: "mapping-reviewed",
        operator: "ops@example.test",
        action: "requeue_failed_delivery",
        created_at: "2026-08-01T13:00:00.000Z",
      },
    ]);
    const auditDatabase = new DatabaseSync(path);
    expect(() => auditDatabase.prepare("UPDATE delivery_recovery_audits SET reason = 'changed' WHERE audit_id = 1").run())
      .toThrow("delivery recovery audits are immutable");
    auditDatabase.close();
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      compact_json: original.compact_json,
      event: incoming.event,
      action: incoming.action,
      repository: incoming.repository,
      actor_login: incoming.actorLogin,
      state: "pending",
      attempt_count: 0,
      next_attempt_at: null,
      last_error_code: null,
      last_error_at: null,
      completed_at: null,
      lease_token: null,
    });
    expect(requireClaim(store, "2026-08-01T13:00:00.000Z")).toMatchObject({
      deliveryId: incoming.deliveryId,
      state: "processing",
      attemptCount: 1,
    });
  });

  it.each([
    ["duplicate", (incoming: CompactDelivery) => [incoming.deliveryId, incoming.deliveryId], "duplicate delivery id"],
    ["unknown", (incoming: CompactDelivery) => [incoming.deliveryId, "missing-delivery"], "delivery recovery target is unavailable"],
  ])("rejects %s recovery targets without partially requeuing an eligible delivery", (_kind, ids, message) => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    store.failDelivery(requireClaim(store, receivedAt).lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);

    expect(() => store.recoverFailedDeliveries({
      deliveryIds: ids(incoming),
      reason: "mapping-reviewed",
      operator: "ops@example.test",
      apply: true,
      now: "2026-08-01T13:00:00.000Z",
    })).toThrow(message);
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({ state: "failed", attempt_count: 1 });
    expect(recoveryAuditRows(path)).toEqual([]);
  });

  it("rejects a nonfailed recovery target without an audit mutation", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);

    expect(() => store.recoverFailedDeliveries({
      deliveryIds: [incoming.deliveryId],
      reason: "mapping-reviewed",
      operator: "ops@example.test",
      apply: true,
      now: "2026-08-01T13:00:00.000Z",
    })).toThrow("delivery recovery target is unavailable");
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({ state: "pending", attempt_count: 0 });
    expect(recoveryAuditRows(path)).toEqual([]);
  });

  it("rejects a failed delivery whose retained compact envelope was pruned", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    store.failDelivery(requireClaim(store, receivedAt).lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);
    closeStore(store);
    const database = new DatabaseSync(path);
    database.prepare("UPDATE deliveries SET compact_json = '{}' WHERE delivery_id = ?").run(incoming.deliveryId);
    database.close();
    const reopened = openStore(path);

    expect(() => reopened.recoverFailedDeliveries({
      deliveryIds: [incoming.deliveryId],
      reason: "mapping-reviewed",
      operator: "ops@example.test",
      apply: true,
      now: "2026-08-01T13:00:00.000Z",
    })).toThrow("delivery recovery target is unavailable");
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({ state: "failed", compact_json: "{}" });
    expect(recoveryAuditRows(path)).toEqual([]);
  });

  it("fences expired workers so only the current two-connection lease can transition a reclaimed delivery", () => {
    const path = temporaryDatabase();
    const first = openStore(path);
    const second = openStore(path);
    const incoming = delivery();
    first.recordDelivery(incoming, receivedAt);
    const firstClaim = requireClaim(first, receivedAt);
    const secondClaim = requireClaim(second, "2026-08-01T12:10:00.001Z");

    expect(firstClaim.lease).toMatchObject({ deliveryId: incoming.deliveryId, attempt: 1 });
    expect(secondClaim.lease).toMatchObject({ deliveryId: incoming.deliveryId, attempt: 2 });
    expect(() => first.completeDelivery(firstClaim.lease, "2026-08-01T12:11:00.000Z")).toThrow(
      "delivery lease is no longer processing",
    );
    expect(() => first.retryDelivery(firstClaim.lease, "PLANE_UNAVAILABLE", "2026-08-01T12:11:00.000Z")).toThrow(
      "delivery lease is no longer processing",
    );
    expect(() => first.failDelivery(firstClaim.lease, "PLANE_MAPPING_AMBIGUOUS", "2026-08-01T12:11:00.000Z")).toThrow(
      "delivery lease is no longer processing",
    );

    second.completeDelivery(secondClaim.lease, "2026-08-01T12:11:00.000Z");
    expect(deliveryRow(path, incoming.deliveryId)).toMatchObject({
      state: "completed",
      attempt_count: 2,
      lease_token: null,
      completed_at: "2026-08-01T12:11:00.000Z",
    });
  });

  it("stores one issue to multiple curated Plane items and persists automatic mappings", () => {
    const store = openStore();
    store.seedMappings(registry);
    store.upsertMapping(129, "e2ef6b8f-4d11-4fdd-b45a-7006d0b1635d");

    expect(store.mappingsForIssue(81).map((row) => row.planeWorkItemId)).toEqual([
      "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
      "d2c1f1e8-c690-434c-b5a2-7359b2388f4b",
    ]);
    expect(store.mappingsForIssue(129)).toEqual([
      { issueNumber: 129, planeWorkItemId: "e2ef6b8f-4d11-4fdd-b45a-7006d0b1635d", source: "automatic" },
    ]);
  });

  it("deduplicates milestones by their owning Plane work item", () => {
    const store = openStore();
    const planeItem = "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe";

    expect(store.recordMilestone("github:delivery-1", planeItem, receivedAt)).toEqual({ inserted: true });
    expect(store.recordMilestone("github:delivery-1", planeItem, fiveMinutesLater)).toEqual({ inserted: false });
    expect(store.recordMilestone("github:delivery-1", "d2c1f1e8-c690-434c-b5a2-7359b2388f4b", receivedAt)).toEqual({
      inserted: true,
    });
    expect(store.hasMilestone("github:delivery-1", planeItem)).toBe(true);
  });

  it("persists reconciliation cursors across restart", () => {
    const path = temporaryDatabase();
    const first = openStore(path);
    expect(first.getCursor("github-reconcile")).toBeNull();
    first.setCursor("github-reconcile", "2026-08-01T12:00:00.000Z");
    closeStore(first);

    const restarted = openStore(path);
    expect(restarted.getCursor("github-reconcile")).toBe("2026-08-01T12:00:00.000Z");
  });

  it("rolls back every reconciliation setting when one batch value is invalid", () => {
    const store = openStore();
    store.setCursor("github-reconcile", "2026-08-01T11:00:00.000Z");
    store.setCursor("last-successful-reconciliation-at", "2026-08-01T11:00:00.000Z");

    expect(() => store.setCursors([
      { key: "github-reconcile", value: "2026-08-01T12:00:00.000Z" },
      { key: "last-successful-reconciliation-at", value: "2026-08-01T12:00:00.000Z" },
      { key: "last-successful-plane-mutation-at", value: null as unknown as string },
    ])).toThrow("setting value must be a string");

    expect(store.getCursor("github-reconcile")).toBe("2026-08-01T11:00:00.000Z");
    expect(store.getCursor("last-successful-reconciliation-at")).toBe("2026-08-01T11:00:00.000Z");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBeNull();
  });

  it("persists timestamp settings monotonically, including inside an atomic reconciliation batch", () => {
    const store = openStore();
    store.setMaxTimestamp("last-successful-plane-mutation-at", "2026-08-02T11:00:00.000Z");

    store.setMaxTimestamp("last-successful-plane-mutation-at", "2026-08-02T10:00:00.000Z");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T11:00:00.000Z");

    store.setCursors([
      { key: "github-reconcile", value: "2026-08-02T10:00:00.000Z" },
      {
        key: "last-successful-plane-mutation-at",
        value: "2026-08-02T10:00:00.000Z",
        mode: "max-timestamp",
      },
    ]);
    expect(store.getCursor("github-reconcile")).toBe("2026-08-02T10:00:00.000Z");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T11:00:00.000Z");

    store.setMaxTimestamp("last-successful-plane-mutation-at", "2026-08-02T12:00:00.000Z");
    expect(store.getCursor("last-successful-plane-mutation-at")).toBe("2026-08-02T12:00:00.000Z");
  });

  it("returns the earliest pending or retry timestamp without making a claim", () => {
    const store = openStore();
    store.recordDelivery(delivery(1), "2026-08-01T12:00:00.000Z");
    const claimed = requireClaim(store, "2026-08-01T12:01:00.000Z");
    store.retryDelivery(claimed.lease, "plane_service_unavailable", "2026-08-01T12:02:00.000Z");

    const nextRetryAt = store.nextReadyDeliveryAt();
    expect(Date.parse(nextRetryAt ?? "")).toBeGreaterThanOrEqual(Date.parse("2026-08-01T12:02:01.000Z"));
    expect(Date.parse(nextRetryAt ?? "")).toBeLessThan(Date.parse("2026-08-01T12:02:01.100Z"));

    store.recordDelivery(delivery(2), "2026-08-01T12:02:00.500Z");
    expect(store.nextReadyDeliveryAt()).toBe("2026-08-01T12:02:00.500Z");
  });

  it("persists sanitized source-specific runtime failures and deterministic recovery", () => {
    const store = openStore();
    store.recordRuntimeFailure("worker", "plane_service_unavailable", "2026-08-02T10:00:00.000Z");
    store.recordRuntimeFailure("reconcile", "github_auth_failed", "2026-08-02T10:01:00.000Z");

    expect(store.runtimeFailures()).toEqual([
      { source: "worker", code: "plane_service_unavailable", at: "2026-08-02T10:00:00.000Z" },
      { source: "reconcile", code: "github_auth_failed", at: "2026-08-02T10:01:00.000Z" },
    ]);
    expect(() => store.recordRuntimeFailure("health", "Bearer private-token", "2026-08-02T10:02:00.000Z"))
      .toThrow("error code must be a compact sanitized identifier");

    store.clearRuntimeFailure("worker", "2026-08-02T10:03:00.000Z");
    expect(store.runtimeFailures()).toEqual([
      { source: "reconcile", code: "github_auth_failed", at: "2026-08-02T10:01:00.000Z" },
    ]);
    expect(store.getCursor("runtime.recovery.worker.at")).toBe("2026-08-02T10:03:00.000Z");
  });

  it("reports queued and permanently failed delivery counts", () => {
    const store = openStore();
    const retrying = delivery(1);
    const failed = delivery(2);
    const pending = delivery(3);
    store.recordDelivery(retrying, receivedAt);
    store.recordDelivery(failed, receivedAt);
    store.recordDelivery(pending, receivedAt);
    const retryingClaim = requireClaim(store, receivedAt);
    store.retryDelivery(retryingClaim.lease, "PLANE_UNAVAILABLE", receivedAt);
    const failedClaim = requireClaim(store, receivedAt);
    store.failDelivery(failedClaim.lease, "PLANE_MAPPING_AMBIGUOUS", receivedAt);

    expect(store.healthStats()).toMatchObject({
      pending: 1,
      retry: 1,
      processing: 0,
      completed: 0,
      permanentlyFailed: 1,
      lastAcceptedAt: receivedAt,
      lastErrorCode: "PLANE_MAPPING_AMBIGUOUS",
    });
  });

  it("retains only compact ingress fields and never an unexpected body field", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = Object.assign(delivery(), {
      body: "private review text that must never reach SQLite",
      sender: { email: "private@example.test" },
    }) as CompactDelivery;
    store.recordDelivery(incoming, receivedAt);

    const row = deliveryRow(path, incoming.deliveryId);
    expect(JSON.parse(row.compact_json as string)).toEqual({
      deliveryId: incoming.deliveryId,
      event: "issues",
      action: "opened",
      repository: "label-suite-org/label-suite_neon_r2",
      subjectKind: "issue",
      subjectNumber: 1,
      actorLogin: "nature-boy",
      occurredAt: receivedAt,
    });
  });

  it("prunes completed routing data after the audit window without deleting delivery identity or outcome", () => {
    const path = temporaryDatabase();
    const store = openStore(path);
    const incoming = delivery();
    const completedAt = "2026-07-20T12:00:00.000Z";
    store.recordDelivery(incoming, "2026-07-20T11:00:00.000Z");
    const claimed = requireClaim(store, "2026-07-20T11:00:00.000Z");
    store.completeDelivery(claimed.lease, completedAt);

    expect(store.pruneCompleted("2026-07-27T12:00:00.000Z")).toBe(1);
    expect(deliveryRow(path, incoming.deliveryId)).toEqual({
      delivery_id: incoming.deliveryId,
      event: "",
      action: "",
      repository: "",
      subject_kind: "issue",
      subject_number: 1,
      actor_login: "",
      occurred_at: receivedAt,
      state: "completed",
      attempt_count: 1,
      next_attempt_at: null,
      last_error_code: null,
      last_error_at: null,
      completed_at: completedAt,
      created_at: "2026-07-20T11:00:00.000Z",
      compact_json: "{}",
      lease_token: null,
    });
  });

  it("does not report a terminal failure as a successful completion", () => {
    const store = openStore();
    const incoming = delivery();
    store.recordDelivery(incoming, receivedAt);
    const claimed = requireClaim(store, receivedAt);
    store.failDelivery(claimed.lease, "PLANE_MAPPING_AMBIGUOUS", fiveMinutesLater);

    expect(store.healthStats()).toMatchObject({
      permanentlyFailed: 1,
      lastCompletedAt: null,
      lastErrorCode: "PLANE_MAPPING_AMBIGUOUS",
    });
  });

  it("selects the actual most recent error across retries and repeated errors", () => {
    const store = openStore();
    const permanentlyFailed = delivery(1);
    const retried = delivery(2);
    store.recordDelivery(permanentlyFailed, receivedAt);
    store.recordDelivery(retried, receivedAt);

    store.failDelivery(requireClaim(store, receivedAt).lease, "PERMANENT_OLDER", "2026-08-01T12:05:00.000Z");
    const firstRetry = requireClaim(store, "2026-08-01T12:06:00.000Z");
    store.retryDelivery(firstRetry.lease, "TRANSIENT_NEWER", "2026-08-01T12:07:00.000Z");
    const secondRetry = requireClaim(store, "2026-08-01T12:08:00.000Z");
    store.retryDelivery(secondRetry.lease, "TRANSIENT_LATEST", "2026-08-01T12:09:00.000Z");

    expect(store.healthStats()).toMatchObject({
      lastCompletedAt: null,
      lastErrorCode: "TRANSIENT_LATEST",
    });
  });
});
