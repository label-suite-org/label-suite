import { createHash } from "node:crypto";
import { PermanentSyncError } from "./errors.js";
import { escapeHtml } from "./managed-html.js";
import { HEALTH_ITEM_NAME, type PlaneClient, type PlanePriority, type PlaneWorkItem } from "./plane.js";
import { SqliteDeliveryStore } from "./store.js";
import type { PublicHealth } from "./types.js";

const HEALTH_ITEM_ID_KEY = "health-item-id";
const LAST_PLANE_MUTATION_KEY = "last-successful-plane-mutation-at";
const LAST_RECONCILIATION_KEY = "last-successful-reconciliation-at";
const LAST_REPORTED_SNAPSHOT_KEY = "last-successful-health-snapshot";
const FAILURE_EPISODE_KEY = "health-failure-episode";
const NORMAL_PRIORITY_KEY = "health-normal-priority";
const RECONCILIATION_STALE_MS = 30 * 60 * 1_000;
const TRACKING_ISSUE_URL = "https://github.com/label-suite-org/label-suite_neon_r2/issues/128";
const HEALTH_URL = "https://plane-sync.truenature.online/health";

interface HealthDeps {
  store: SqliteDeliveryStore;
  revision: string;
}

export interface HealthReportDeps {
  store: SqliteDeliveryStore;
  plane: Pick<PlaneClient, "getWorkItem" | "findHealthItems" | "patchProjection" | "upsertHealthComment">;
  now?: () => Date;
}

async function patchHealthPriority(
  deps: HealthReportDeps,
  item: PlaneWorkItem,
  priority: PlanePriority,
): Promise<PlaneWorkItem> {
  const updated = await deps.plane.patchProjection(item, { priority });
  recordPlaneMutation(deps);
  return updated;
}

function recordPlaneMutation(deps: HealthReportDeps): void {
  deps.store.setMaxTimestamp(LAST_PLANE_MUTATION_KEY, (deps.now ?? (() => new Date()))());
}

async function writeHealthComment(
  deps: HealthReportDeps,
  itemId: string,
  comment: { html: string; externalId: string },
): Promise<boolean> {
  const mutated = await deps.plane.upsertHealthComment(itemId, comment);
  if (mutated) recordPlaneMutation(deps);
  return mutated;
}

function validTimestamp(value: string | null): string | null {
  if (value === null || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function hasStaleReconciliation(lastReconciliationAt: string | null, now: Date): boolean {
  if (lastReconciliationAt === null) return true;
  return now.valueOf() - Date.parse(lastReconciliationAt) > RECONCILIATION_STALE_MS;
}

function healthHash(snapshot: PublicHealth): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function healthComment(snapshot: PublicHealth): { html: string; externalId: string } {
  const value = (input: string | number | null): string => escapeHtml(input === null ? "none" : String(input));
  return {
    externalId: `health:status:${healthHash(snapshot)}`,
    html: `<p><strong>GitHub to Plane sync health:</strong> ${value(snapshot.status)}</p><p><strong>Revision:</strong> ${value(snapshot.revision)} · <strong>Accepted:</strong> ${value(snapshot.lastAcceptedAt)} · <strong>Plane mutation:</strong> ${value(snapshot.lastPlaneMutationAt)} · <strong>Reconciliation:</strong> ${value(snapshot.lastReconciliationAt)}</p><p><strong>Pending:</strong> ${value(snapshot.pending)} · <strong>Permanently failed:</strong> ${value(snapshot.permanentlyFailed)} · <strong>Last code:</strong> ${value(snapshot.lastErrorCode)}</p><p><a href="${TRACKING_ISSUE_URL}">GitHub issue #128</a> · <a href="${HEALTH_URL}">Sanitized health endpoint</a></p>`,
  };
}

function failureComment(snapshot: PublicHealth, episode: string): { html: string; externalId: string } {
  return {
    externalId: `health:failure:${episode}`,
    html: `<p><strong>Sync failure episode:</strong> ${escapeHtml(snapshot.lastErrorCode ?? "unknown")}</p><p>Permanent delivery failures: ${escapeHtml(String(snapshot.permanentlyFailed))}. <a href="${TRACKING_ISSUE_URL}">Issue #128</a> · <a href="${HEALTH_URL}">Health</a></p>`,
  };
}

function recoveryComment(episode: string): { html: string; externalId: string } {
  return {
    externalId: `health:recovery:${episode}`,
    html: `<p><strong>Sync recovery:</strong> the active failure episode has recovered.</p><p><a href="${TRACKING_ISSUE_URL}">Issue #128</a> · <a href="${HEALTH_URL}">Health</a></p>`,
  };
}

function storedPriority(value: string | null): PlanePriority {
  if (value === "none" || value === "low" || value === "medium" || value === "high" || value === "urgent") return value;
  return "none";
}

async function healthItem(deps: HealthReportDeps): Promise<{ item: PlaneWorkItem; storeAfterSuccess: boolean }> {
  const storedId = deps.store.getCursor(HEALTH_ITEM_ID_KEY);
  if (storedId !== null) {
    const item = await deps.plane.getWorkItem(storedId);
    if (item.name !== HEALTH_ITEM_NAME) throw new PermanentSyncError("plane_health_item_invalid");
    return { item, storeAfterSuccess: false };
  }
  const matches = await deps.plane.findHealthItems();
  if (matches.length !== 1) throw new PermanentSyncError("plane_health_item_ambiguous");
  return { item: matches[0]!, storeAfterSuccess: true };
}

export async function buildHealthSnapshot(deps: HealthDeps, now: Date): Promise<PublicHealth> {
  const stats = deps.store.healthStats();
  const runtimeFailure = deps.store.runtimeFailures().at(-1) ?? null;
  const lastPlaneMutationAt = validTimestamp(deps.store.getCursor(LAST_PLANE_MUTATION_KEY));
  const lastReconciliationAt = validTimestamp(deps.store.getCursor(LAST_RECONCILIATION_KEY));
  const status = stats.permanentlyFailed > 0 || runtimeFailure !== null
    ? "failed"
    : stats.retry > 0 || hasStaleReconciliation(lastReconciliationAt, now)
      ? "degraded"
      : "ok";
  return {
    status,
    revision: deps.revision,
    lastAcceptedAt: stats.lastAcceptedAt,
    lastPlaneMutationAt,
    lastReconciliationAt,
    pending: stats.pending,
    permanentlyFailed: stats.permanentlyFailed,
    lastErrorCode: runtimeFailure?.code ?? stats.lastErrorCode,
  };
}

export async function reportHealthToPlane(deps: HealthReportDeps, snapshot: PublicHealth): Promise<void> {
  const located = await healthItem(deps);
  let item = located.item;
  const episode = deps.store.getCursor(FAILURE_EPISODE_KEY);

  if (snapshot.status === "failed") {
    const nextEpisode = episode ?? healthHash(snapshot);
    const normalPriority = storedPriority(deps.store.getCursor(NORMAL_PRIORITY_KEY) ?? item.priority);
    if (item.priority !== "high") {
      item = await patchHealthPriority(deps, item, "high");
    }
    if (episode === null) deps.store.setCursor(NORMAL_PRIORITY_KEY, normalPriority);
    await writeHealthComment(deps, item.id, failureComment(snapshot, nextEpisode));
    if (episode === null) deps.store.setCursor(FAILURE_EPISODE_KEY, nextEpisode);
  } else if (episode !== null) {
    const normalPriority = storedPriority(deps.store.getCursor(NORMAL_PRIORITY_KEY));
    if (item.priority !== normalPriority) {
      item = await patchHealthPriority(deps, item, normalPriority);
    }
    await writeHealthComment(deps, item.id, recoveryComment(episode));
    deps.store.clearCursor(FAILURE_EPISODE_KEY);
    deps.store.clearCursor(NORMAL_PRIORITY_KEY);
  }

  await writeHealthComment(deps, item.id, healthComment(snapshot));
  if (located.storeAfterSuccess) deps.store.setCursor(HEALTH_ITEM_ID_KEY, item.id);
  deps.store.setCursor(LAST_REPORTED_SNAPSHOT_KEY, JSON.stringify(snapshot));
}
