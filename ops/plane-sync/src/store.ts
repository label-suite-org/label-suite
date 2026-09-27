import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { CompactDelivery, DeliveryState, SeedRegistry, WriteMode } from "./types.js";

const SCHEMA_VERSION = 3;
const MAX_ATTEMPTS = 8;
const STALE_PROCESSING_MS = 10 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 15 * 60 * 1_000;
const MAX_RECOVERY_TARGETS = 50;

type Timestamp = Date | string;
type MappingSource = "seed" | "automatic";
type SettingWriteMode = "replace" | "max-timestamp";
export type RuntimeFailureSource = "worker" | "reconcile" | "health";

export interface RuntimeFailure {
  source: RuntimeFailureSource;
  code: string;
  at: string;
}

const RUNTIME_FAILURE_SOURCES: readonly RuntimeFailureSource[] = ["worker", "reconcile", "health"];

export interface SettingWrite {
  key: string;
  value: string;
  mode?: SettingWriteMode;
}

interface DeliveryRow {
  delivery_id: string;
  event: CompactDelivery["event"];
  action: string;
  repository: CompactDelivery["repository"];
  subject_kind: CompactDelivery["subjectKind"];
  subject_number: number | null;
  actor_login: string;
  occurred_at: string;
  state: DeliveryState;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  last_error_at: string | null;
  completed_at: string | null;
  created_at: string;
  lease_token: string | null;
}

interface MappingRow {
  issue_number: number;
  plane_work_item_id: string;
  source: MappingSource;
}

interface CountRow {
  state: DeliveryState;
  count: number;
}

interface FailedDeliveryRecoveryRow {
  delivery_id: string;
  compact_json: string;
  state: DeliveryState;
  attempt_count: number;
  last_error_code: string | null;
}

export interface StoredDelivery extends CompactDelivery {
  state: DeliveryState;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface DeliveryLease {
  deliveryId: string;
  attempt: number;
  token: string;
}

export interface ClaimedDelivery extends StoredDelivery {
  state: "processing";
  lease: DeliveryLease;
}

export interface StoredMapping {
  issueNumber: number;
  planeWorkItemId: string;
  source: MappingSource;
}

export interface DeliveryHealthStats {
  pending: number;
  retry: number;
  processing: number;
  completed: number;
  permanentlyFailed: number;
  lastAcceptedAt: string | null;
  lastCompletedAt: string | null;
  lastErrorCode: string | null;
}

export interface FailedDeliveryRecoveryRequest {
  deliveryIds: readonly string[];
  reason: string;
  operator: string;
  apply: boolean;
  now?: Timestamp;
}

export interface FailedDeliveryRecoveryAudit {
  deliveryId: string;
  previousErrorCode: string | null;
  previousAttemptCount: number;
  reason: string;
  operator: string;
  action: "requeue_failed_delivery";
  createdAt: string;
}

export interface FailedDeliveryRecoveryReport {
  mode: WriteMode;
  requested: number;
  eligible: number;
  requeued: number;
}

function iso(value: Timestamp): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("timestamp must be a valid ISO date");
  return date.toISOString();
}

function errorCode(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) {
    throw new Error("error code must be a compact sanitized identifier");
  }
  return value;
}

function recoveryMetadata(value: string, field: "reason" | "operator", maximumLength: number): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximumLength || /[\u0000-\u001F\u007F]/.test(normalized)) {
    throw new Error(`recovery ${field} must be nonblank bounded text`);
  }
  return normalized;
}

function recoveryDeliveryIds(values: readonly string[]): string[] {
  if (values.length === 0 || values.length > MAX_RECOVERY_TARGETS) {
    throw new Error("recovery requires between one and fifty delivery ids");
  }
  const ids = values.map((value) => {
    if (value.length === 0 || value.length > 255 || value.trim() !== value || /[\u0000-\u001F\u007F]/.test(value)) {
      throw new Error("delivery id must be a nonblank compact identifier");
    }
    return value;
  });
  if (new Set(ids).size !== ids.length) throw new Error("duplicate delivery id");
  return ids;
}

function compactJson(delivery: CompactDelivery): string {
  return JSON.stringify({
    deliveryId: delivery.deliveryId,
    event: delivery.event,
    action: delivery.action,
    repository: delivery.repository,
    subjectKind: delivery.subjectKind,
    subjectNumber: delivery.subjectNumber,
    actorLogin: delivery.actorLogin,
    occurredAt: delivery.occurredAt,
  });
}

function retryDelayMs(deliveryId: string, attemptCount: number): number {
  const base = Math.min(1_000 * 2 ** (attemptCount - 1), MAX_RETRY_DELAY_MS);
  let hash = 2_166_136_261;
  for (const character of deliveryId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  const jitter = Math.floor((base * (hash >>> 0)) / 4_294_967_296 / 10);
  return base + jitter;
}

function storedDelivery(row: DeliveryRow): StoredDelivery {
  return {
    deliveryId: row.delivery_id,
    event: row.event,
    action: row.action,
    repository: row.repository,
    subjectKind: row.subject_kind,
    subjectNumber: row.subject_number,
    actorLogin: row.actor_login,
    occurredAt: row.occurred_at,
    state: row.state,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function claimedDelivery(row: DeliveryRow): ClaimedDelivery {
  if (row.state !== "processing" || !row.lease_token) throw new Error("claimed delivery is missing a lease token");
  return {
    ...storedDelivery(row),
    state: "processing",
    lease: {
      deliveryId: row.delivery_id,
      attempt: row.attempt_count,
      token: row.lease_token,
    },
  };
}

function storedMapping(row: MappingRow): StoredMapping {
  return {
    issueNumber: row.issue_number,
    planeWorkItemId: row.plane_work_item_id,
    source: row.source,
  };
}

export class SqliteDeliveryStore {
  private readonly database: DatabaseSync;
  private closed = false;

  private constructor(path: string) {
    this.database = new DatabaseSync(path);
    this.database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.initializeSchema();
  }

  static open(path: string): SqliteDeliveryStore {
    return new SqliteDeliveryStore(path);
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  recordDelivery(delivery: CompactDelivery, receivedAt: Timestamp = new Date()): { inserted: boolean } {
    this.ensureOpen();
    const createdAt = iso(receivedAt);
    const occurredAt = iso(delivery.occurredAt);
    const result = this.database
      .prepare(
        `INSERT OR IGNORE INTO deliveries (
          delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
          compact_json, state, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .run(
        delivery.deliveryId,
        delivery.event,
        delivery.action,
        delivery.repository,
        delivery.subjectKind,
        delivery.subjectNumber,
        delivery.actorLogin,
        occurredAt,
        compactJson(delivery),
        createdAt,
      );
    return { inserted: result.changes === 1 };
  }

  claimNext(now: Timestamp): ClaimedDelivery | null {
    this.ensureOpen();
    const claimedAt = iso(now);
    const staleBefore = new Date(Date.parse(claimedAt) - STALE_PROCESSING_MS).toISOString();

    return this.transaction(() => {
      this.database
        .prepare(
          `UPDATE deliveries
           SET state = CASE WHEN attempt_count >= ? THEN 'failed' ELSE 'retry' END,
               next_attempt_at = CASE WHEN attempt_count >= ? THEN NULL ELSE ? END,
               last_error_code = CASE WHEN attempt_count >= ? THEN 'retry_exhausted' ELSE 'WORKER_LEASE_EXPIRED' END,
               last_error_at = ?,
               completed_at = CASE WHEN attempt_count >= ? THEN ? ELSE NULL END,
               lease_token = NULL
           WHERE state = 'processing' AND next_attempt_at < ?`,
        )
        .run(MAX_ATTEMPTS, MAX_ATTEMPTS, claimedAt, MAX_ATTEMPTS, claimedAt, MAX_ATTEMPTS, claimedAt, staleBefore);

      const row = this.database
        .prepare(
          `SELECT delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
                  state, attempt_count, next_attempt_at, last_error_code, last_error_at, completed_at, created_at, lease_token
           FROM deliveries
           WHERE state = 'pending' OR (state = 'retry' AND next_attempt_at <= ?)
           ORDER BY COALESCE(next_attempt_at, created_at), created_at, delivery_id
           LIMIT 1`,
        )
        .get(claimedAt) as DeliveryRow | undefined;
      if (!row) return null;

      const leaseToken = randomUUID();
      const result = this.database
        .prepare(
          `UPDATE deliveries
           SET state = 'processing', attempt_count = attempt_count + 1, next_attempt_at = ?, lease_token = ?
           WHERE delivery_id = ? AND state = ?`,
        )
        .run(claimedAt, leaseToken, row.delivery_id, row.state);
      if (result.changes !== 1) throw new Error("delivery claim lost");

      const claimed = this.database
        .prepare(
          `SELECT delivery_id, event, action, repository, subject_kind, subject_number, actor_login, occurred_at,
                  state, attempt_count, next_attempt_at, last_error_code, last_error_at, completed_at, created_at, lease_token
           FROM deliveries WHERE delivery_id = ?`,
        )
        .get(row.delivery_id) as unknown as DeliveryRow;
      return claimedDelivery(claimed);
    });
  }

  completeDelivery(lease: DeliveryLease, completedAt: Timestamp): void {
    this.ensureOpen();
    const result = this.database
      .prepare(
        `UPDATE deliveries
         SET state = 'completed', next_attempt_at = NULL, last_error_code = NULL, last_error_at = NULL,
             completed_at = ?, lease_token = NULL
         WHERE delivery_id = ? AND state = 'processing' AND attempt_count = ? AND lease_token = ?`,
      )
      .run(iso(completedAt), lease.deliveryId, lease.attempt, lease.token);
    if (result.changes !== 1) throw new Error("delivery lease is no longer processing");
  }

  retryDelivery(lease: DeliveryLease, code: string, now: Timestamp): void {
    this.ensureOpen();
    const retryAt = iso(now);
    const originalCode = errorCode(code);
    this.transaction(() => {
      const current = this.database
        .prepare(
          `SELECT attempt_count FROM deliveries
           WHERE delivery_id = ? AND state = 'processing' AND attempt_count = ? AND lease_token = ?`,
        )
        .get(lease.deliveryId, lease.attempt, lease.token) as { attempt_count: number } | undefined;
      if (!current) throw new Error("delivery lease is no longer processing");

      const terminal = current.attempt_count >= MAX_ATTEMPTS;
      const nextAttemptAt = terminal
        ? null
        : new Date(Date.parse(retryAt) + retryDelayMs(lease.deliveryId, current.attempt_count)).toISOString();
      const result = this.database
        .prepare(
          `UPDATE deliveries
           SET state = ?, next_attempt_at = ?, last_error_code = ?, last_error_at = ?, completed_at = ?, lease_token = NULL
           WHERE delivery_id = ? AND state = 'processing' AND attempt_count = ? AND lease_token = ?`,
        )
        .run(
          terminal ? "failed" : "retry",
          nextAttemptAt,
          terminal ? "retry_exhausted" : originalCode,
          retryAt,
          terminal ? retryAt : null,
          lease.deliveryId,
          lease.attempt,
          lease.token,
        );
      if (result.changes !== 1) throw new Error("delivery lease is no longer processing");
    });
  }

  failDelivery(lease: DeliveryLease, code: string, failedAt: Timestamp): void {
    this.ensureOpen();
    const result = this.database
      .prepare(
        `UPDATE deliveries
         SET state = 'failed', next_attempt_at = NULL, last_error_code = ?, last_error_at = ?, completed_at = ?, lease_token = NULL
         WHERE delivery_id = ? AND state = 'processing' AND attempt_count = ? AND lease_token = ?`,
      )
      .run(errorCode(code), iso(failedAt), iso(failedAt), lease.deliveryId, lease.attempt, lease.token);
    if (result.changes !== 1) throw new Error("delivery lease is no longer processing");
  }

  recoverFailedDeliveries(request: FailedDeliveryRecoveryRequest): FailedDeliveryRecoveryReport {
    this.ensureOpen();
    const deliveryIds = recoveryDeliveryIds(request.deliveryIds);
    const reason = recoveryMetadata(request.reason, "reason", 256);
    const operator = recoveryMetadata(request.operator, "operator", 128);
    const recoveredAt = iso(request.now ?? new Date());
    const report = (eligible: number, requeued: number): FailedDeliveryRecoveryReport => ({
      mode: request.apply ? "active" : "dry-run",
      requested: deliveryIds.length,
      eligible,
      requeued,
    });
    const readTargets = (): FailedDeliveryRecoveryRow[] => deliveryIds.map((deliveryId) => {
      const target = this.database
        .prepare(
          `SELECT delivery_id, compact_json, state, attempt_count, last_error_code
           FROM deliveries WHERE delivery_id = ?`,
        )
        .get(deliveryId) as FailedDeliveryRecoveryRow | undefined;
      if (!target || target.state !== "failed" || target.compact_json.trim() === "{}") {
        throw new Error("delivery recovery target is unavailable");
      }
      return target;
    });

    if (!request.apply) return report(readTargets().length, 0);

    return this.transaction(() => {
      const targets = readTargets();
      const audit = this.database.prepare(
        `INSERT INTO delivery_recovery_audits (
          delivery_id, previous_error_code, previous_attempt_count, reason, operator, action, created_at
        ) VALUES (?, ?, ?, ?, ?, 'requeue_failed_delivery', ?)`,
      );
      for (const target of targets) {
        audit.run(
          target.delivery_id,
          target.last_error_code,
          target.attempt_count,
          reason,
          operator,
          recoveredAt,
        );
      }

      const requeue = this.database.prepare(
        `UPDATE deliveries
         SET state = 'pending', attempt_count = 0, next_attempt_at = NULL,
             last_error_code = NULL, last_error_at = NULL, completed_at = NULL, lease_token = NULL
         WHERE delivery_id = ? AND state = 'failed' AND TRIM(compact_json) <> '{}'`,
      );
      for (const target of targets) {
        if (requeue.run(target.delivery_id).changes !== 1) throw new Error("delivery recovery target is unavailable");
      }
      return report(targets.length, targets.length);
    });
  }

  recoveryAudits(): FailedDeliveryRecoveryAudit[] {
    this.ensureOpen();
    return this.database
      .prepare(
        `SELECT delivery_id, previous_error_code, previous_attempt_count, reason, operator, action, created_at
         FROM delivery_recovery_audits ORDER BY audit_id`,
      )
      .all()
      .map((row) => {
        const audit = row as {
          delivery_id: string;
          previous_error_code: string | null;
          previous_attempt_count: number;
          reason: string;
          operator: string;
          action: "requeue_failed_delivery";
          created_at: string;
        };
        return {
          deliveryId: audit.delivery_id,
          previousErrorCode: audit.previous_error_code,
          previousAttemptCount: audit.previous_attempt_count,
          reason: audit.reason,
          operator: audit.operator,
          action: audit.action,
          createdAt: audit.created_at,
        };
      });
  }

  seedMappings(registry: SeedRegistry): void {
    this.ensureOpen();
    this.transaction(() => {
      const insert = this.database.prepare(
        `INSERT INTO mappings (issue_number, plane_work_item_id, source) VALUES (?, ?, 'seed')
         ON CONFLICT(issue_number, plane_work_item_id) DO UPDATE SET source = 'seed'`,
      );
      for (const entry of registry.entries) {
        for (const issueNumber of entry.issueNumbers) insert.run(issueNumber, entry.planeWorkItemId);
      }
    });
  }

  upsertMapping(issueNumber: number, planeWorkItemId: string, source: MappingSource = "automatic"): void {
    this.ensureOpen();
    this.database
      .prepare(
        `INSERT INTO mappings (issue_number, plane_work_item_id, source) VALUES (?, ?, ?)
         ON CONFLICT(issue_number, plane_work_item_id) DO UPDATE SET source = excluded.source`,
      )
      .run(issueNumber, planeWorkItemId, source);
  }

  mappingsForIssue(issueNumber: number): StoredMapping[] {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          `SELECT issue_number, plane_work_item_id, source FROM mappings
           WHERE issue_number = ? ORDER BY plane_work_item_id`,
        )
        .all(issueNumber) as unknown as MappingRow[]
    ).map(storedMapping);
  }

  automaticMappings(): StoredMapping[] {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          `SELECT issue_number, plane_work_item_id, source FROM mappings
           WHERE source = 'automatic' ORDER BY plane_work_item_id, issue_number`,
        )
        .all() as unknown as MappingRow[]
    ).map(storedMapping);
  }

  recordMilestone(milestoneId: string, planeWorkItemId: string, createdAt: Timestamp = new Date()): { inserted: boolean } {
    this.ensureOpen();
    const result = this.database
      .prepare("INSERT OR IGNORE INTO milestones (milestone_id, plane_work_item_id, created_at) VALUES (?, ?, ?)")
      .run(milestoneId, planeWorkItemId, iso(createdAt));
    return { inserted: result.changes === 1 };
  }

  hasMilestone(milestoneId: string, planeWorkItemId: string): boolean {
    this.ensureOpen();
    return (
      this.database
        .prepare("SELECT 1 FROM milestones WHERE milestone_id = ? AND plane_work_item_id = ?")
        .get(milestoneId, planeWorkItemId) !== undefined
    );
  }

  getCursor(key: string): string | null {
    this.ensureOpen();
    const row = this.database.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setCursor(key: string, value: string): void {
    this.setCursors([{ key, value }]);
  }

  setMaxTimestamp(key: string, value: Timestamp): void {
    this.setCursors([{ key, value: iso(value), mode: "max-timestamp" }]);
  }

  setCursors(entries: ReadonlyArray<SettingWrite>): void {
    this.ensureOpen();
    this.transaction(() => {
      const statement = this.database.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const entry of entries) {
        if (typeof entry.key !== "string" || entry.key.length === 0) throw new Error("setting key must be a non-empty string");
        if (typeof entry.value !== "string") throw new Error("setting value must be a string");
        if (entry.mode !== undefined && entry.mode !== "max-timestamp") throw new Error("setting write mode is invalid");
        if (entry.mode === "max-timestamp") {
          const next = iso(entry.value);
          const current = this.getCursor(entry.key);
          if (current !== null && Date.parse(current) >= Date.parse(next)) continue;
          statement.run(entry.key, next);
        } else {
          statement.run(entry.key, entry.value);
        }
      }
    });
  }

  clearCursor(key: string): void {
    this.ensureOpen();
    this.database.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  nextReadyDeliveryAt(): string | null {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `SELECT MIN(CASE WHEN state = 'pending' THEN created_at ELSE next_attempt_at END) AS value
         FROM deliveries
         WHERE state = 'pending' OR (state = 'retry' AND next_attempt_at IS NOT NULL)`,
      )
      .get() as { value: string | null };
    return row.value;
  }

  recordRuntimeFailure(source: RuntimeFailureSource, code: string, at: Timestamp): void {
    if (!RUNTIME_FAILURE_SOURCES.includes(source)) throw new Error("runtime failure source is invalid");
    this.setCursors([
      { key: `runtime.failure.${source}.code`, value: errorCode(code) },
      { key: `runtime.failure.${source}.at`, value: iso(at) },
    ]);
  }

  clearRuntimeFailure(source: RuntimeFailureSource, recoveredAt: Timestamp): void {
    this.ensureOpen();
    if (!RUNTIME_FAILURE_SOURCES.includes(source)) throw new Error("runtime failure source is invalid");
    const recovery = iso(recoveredAt);
    this.transaction(() => {
      this.database
        .prepare("DELETE FROM settings WHERE key IN (?, ?)")
        .run(`runtime.failure.${source}.code`, `runtime.failure.${source}.at`);
      this.database
        .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(`runtime.recovery.${source}.at`, recovery);
    });
  }

  runtimeFailures(): RuntimeFailure[] {
    this.ensureOpen();
    const failures: RuntimeFailure[] = [];
    for (const source of RUNTIME_FAILURE_SOURCES) {
      const code = this.getCursor(`runtime.failure.${source}.code`);
      const at = this.getCursor(`runtime.failure.${source}.at`);
      if (code !== null && at !== null && Number.isFinite(Date.parse(at))) failures.push({ source, code, at });
    }
    return failures.sort((left, right) => left.at.localeCompare(right.at) || left.source.localeCompare(right.source));
  }

  pruneCompleted(before: Timestamp): number {
    this.ensureOpen();
    const result = this.database
      .prepare(
        `UPDATE deliveries
         SET compact_json = '{}', actor_login = '', event = '', action = '', repository = ''
         WHERE state = 'completed' AND completed_at < ?
           AND (compact_json <> '{}' OR actor_login <> '' OR event <> '' OR action <> '' OR repository <> '')`,
      )
      .run(iso(before));
    return Number(result.changes);
  }

  healthStats(): DeliveryHealthStats {
    this.ensureOpen();
    const counts = this.database
      .prepare("SELECT state, COUNT(*) AS count FROM deliveries GROUP BY state")
      .all() as unknown as CountRow[];
    const countFor = (state: DeliveryState): number => counts.find((row) => row.state === state)?.count ?? 0;
    const accepted = this.database.prepare("SELECT MAX(created_at) AS value FROM deliveries").get() as { value: string | null };
    const completed = this.database
      .prepare("SELECT MAX(completed_at) AS value FROM deliveries WHERE state = 'completed' AND completed_at IS NOT NULL")
      .get() as { value: string | null };
    const error = this.database
      .prepare(
        `SELECT last_error_code AS value FROM deliveries
         WHERE last_error_code IS NOT NULL AND last_error_at IS NOT NULL
         ORDER BY last_error_at DESC, delivery_id DESC LIMIT 1`,
      )
      .get() as { value: string } | undefined;

    return {
      pending: countFor("pending"),
      retry: countFor("retry"),
      processing: countFor("processing"),
      completed: countFor("completed"),
      permanentlyFailed: countFor("failed"),
      lastAcceptedAt: accepted.value,
      lastCompletedAt: completed.value,
      lastErrorCode: error?.value ?? null,
    };
  }

  private initializeSchema(): void {
    const version = (this.database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version > SCHEMA_VERSION) throw new Error("database schema is newer than this service");

    this.transaction(() => {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS deliveries (
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
          last_error_at TEXT,
          completed_at TEXT,
          created_at TEXT NOT NULL,
          lease_token TEXT
        );
        CREATE TABLE IF NOT EXISTS mappings (
          issue_number INTEGER NOT NULL,
          plane_work_item_id TEXT NOT NULL,
          source TEXT NOT NULL CHECK (source IN ('seed','automatic')),
          PRIMARY KEY (issue_number, plane_work_item_id)
        );
        CREATE TABLE IF NOT EXISTS milestones (
          milestone_id TEXT NOT NULL,
          plane_work_item_id TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (milestone_id, plane_work_item_id)
        );
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS delivery_recovery_audits (
          audit_id INTEGER PRIMARY KEY,
          delivery_id TEXT NOT NULL,
          previous_error_code TEXT,
          previous_attempt_count INTEGER NOT NULL,
          reason TEXT NOT NULL,
          operator TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action = 'requeue_failed_delivery'),
          created_at TEXT NOT NULL,
          FOREIGN KEY (delivery_id) REFERENCES deliveries(delivery_id)
        );
        CREATE INDEX IF NOT EXISTS deliveries_claim_order
          ON deliveries (state, next_attempt_at, created_at, delivery_id);
        CREATE INDEX IF NOT EXISTS delivery_recovery_audits_delivery_created
          ON delivery_recovery_audits (delivery_id, created_at, audit_id);
        CREATE TRIGGER IF NOT EXISTS delivery_recovery_audits_immutable_update
          BEFORE UPDATE ON delivery_recovery_audits
          BEGIN
            SELECT RAISE(ABORT, 'delivery recovery audits are immutable');
          END;
        CREATE TRIGGER IF NOT EXISTS delivery_recovery_audits_immutable_delete
          BEFORE DELETE ON delivery_recovery_audits
          BEGIN
            SELECT RAISE(ABORT, 'delivery recovery audits are immutable');
          END;
      `);
      if (version === 1) {
        this.database.exec("ALTER TABLE deliveries ADD COLUMN last_error_at TEXT");
        this.database.exec("ALTER TABLE deliveries ADD COLUMN lease_token TEXT");
        this.database.exec(
          "UPDATE deliveries SET last_error_at = COALESCE(completed_at, created_at) WHERE last_error_code IS NOT NULL",
        );
      }
      if (version < SCHEMA_VERSION) this.database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("delivery store is closed");
  }
}
