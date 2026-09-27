import { db } from "./db";
import { tracks, releases, roles, bugs, works } from "../db/schema";
import { eq, and, ne, sql } from "drizzle-orm";
import {
  computeClearanceFromRoleRows,
  type ScopeClearance,
  type WorkClearance,
} from "./readiness-core";
import {
  collectReleaseSweepBugs,
  collectRoleSweepBugs,
  collectTrackSweepBugs,
  collectWorkSweepBugs,
  type SweepBugCandidate,
} from "./sweep-core";
import { TRUE_NATURE_ORG_ID } from "../server/tenant";

type DbClient = Pick<typeof db, "select" | "insert" | "update">;

export type { ScopeClearance, WorkClearance };

/**
 * Compute clearance progress for a work, split by scope (Publishing vs Master).
 *
 * Rules:
 * - `ownership_type='Credit'` lines are excluded entirely (credit-only, no clearance weight).
 * - `Mechanical` scope rolls into Publishing.
 * - A scope with NO Rights lines is "not applicable" — does NOT block clearance.
 * - Overall progress = MIN of applicable scopes' progress.
 * - If zero Rights lines anywhere → cleared = false.
 * - percent_share is on a 0–100 scale.
 */
export async function computeClearanceProgress(
  workId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<WorkClearance> {
  const roleRows = await client.select().from(roles).where(and(eq(roles.work_id, workId), eq(roles.org_id, orgId)));
  return computeClearanceFromRoleRows(roleRows);
}

/**
 * Compute readiness for a single track.
 */
export async function computeTrackReadiness(trackId: string, client: DbClient = db, orgId = TRUE_NATURE_ORG_ID): Promise<{
  isReady: boolean;
  missing: string[];
}> {
  const rows = await client.select().from(tracks).where(and(eq(tracks.id, trackId), eq(tracks.org_id, orgId)));
  const track = rows[0];
  if (!track) return { isReady: false, missing: ["Track not found"] };

  const missing: string[] = [];
  if (!track.isrc) missing.push("ISRC");
  if (!track.audio_url) missing.push("Audio file");

  // Use stored clearance columns (written by persistClearanceProgress).
  // clearance_progress is the overall min of applicable scopes.
  if (track.work_id) {
    if ((track.clearance_progress ?? 0) < 1.0) {
      if ((track.clearance_pub ?? 0) < 1.0) {
        missing.push(
          `Publishing clearance ${Math.round((track.clearance_pub ?? 0) * 100)}%`,
        );
      }
      if ((track.clearance_master ?? 0) < 1.0) {
        missing.push(
          `Master clearance ${Math.round((track.clearance_master ?? 0) * 100)}%`,
        );
      }
      // Both scopes show as "not applicable" but zero rights lines exist
      if (
        (track.clearance_pub ?? 0) >= 1.0 &&
        (track.clearance_master ?? 0) >= 1.0
      ) {
        missing.push("Clearance required — no rights entered");
      }
    }
  } else {
    missing.push("Work assignment");
  }

  return { isReady: missing.length === 0, missing };
}

/**
 * Persist track readiness back to the DB.
 */
export async function persistTrackReadiness(
  trackId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<void> {
  if (client === db) return db.transaction((tx) => persistTrackReadiness(trackId, tx, orgId));
  await client.select({ id: tracks.id }).from(tracks)
    .where(and(eq(tracks.id, trackId), eq(tracks.org_id, orgId))).for("no key update");
  const { isReady, missing } = await computeTrackReadiness(trackId, client, orgId);
  await client
    .update(tracks)
    .set({
      track_ready: isReady,
      track_missing: missing.length ? missing.join(", ") : null,
      updated_at: new Date(),
    })
    .where(and(eq(tracks.id, trackId), eq(tracks.org_id, orgId)));
}

/**
 * Compute release readiness by aggregating all tracks.
 */
export async function computeReleaseReadiness(
  releaseId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<{
  isReady: boolean;
  missing: string[];
}> {
  const releaseRows = await client
    .select()
    .from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId)));
  const release = releaseRows[0];
  if (!release) return { isReady: false, missing: ["Release not found"] };

  const missing: string[] = [];
  if (!release.upc_ean) missing.push("UPC/EAN");
  if (!release.cover_art_url) missing.push("Cover art");
  if (!release.release_date) missing.push("Release date");

  const trackRows = await client
    .select()
    .from(tracks)
    .where(and(eq(tracks.release_id, releaseId), eq(tracks.org_id, orgId)));
  for (const t of trackRows) {
    const tr = await computeTrackReadiness(t.id, client, orgId);
    if (!tr.isReady) missing.push(...tr.missing.map((m) => `Track "${t.title}": ${m}`));
  }

  if (!trackRows.length) missing.push("No tracks");

  return { isReady: missing.length === 0, missing };
}

/**
 * Persist release readiness back to the DB.
 */
export async function persistReleaseReadiness(
  releaseId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<void> {
  if (client === db) return db.transaction((tx) => persistReleaseReadiness(releaseId, tx, orgId));
  // Lock before reading the aggregate so a waiting writer sees the previous writer’s commit.
  await client.select({ id: releases.id }).from(releases)
    .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId))).for("no key update");
  const { isReady, missing } = await computeReleaseReadiness(releaseId, client, orgId);
  await client
    .update(releases)
    .set({
      release_ready: isReady,
      release_missing: missing.length ? missing.join(", ") : null,
      updated_at: new Date(),
    })
    .where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId)));
}

/**
 * Persist clearance progress to all tracks linked to a work.
 * Writes 3 columns: clearance_pub, clearance_master, clearance_progress (overall min).
 * Also re-persists track readiness for each affected track.
 */
export async function persistClearanceProgress(
  workId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<void> {
  const result = await computeClearanceProgress(workId, client, orgId);
  const trackRows = await client
    .select()
    .from(tracks)
    .where(and(eq(tracks.work_id, workId), eq(tracks.org_id, orgId)));
  for (const t of trackRows) {
    await client
      .update(tracks)
      .set({
        clearance_pub: result.pub.progress,
        clearance_master: result.master.progress,
        clearance_progress: result.overall,
        updated_at: new Date(),
      })
      .where(and(eq(tracks.id, t.id), eq(tracks.org_id, orgId)));
    await persistTrackReadiness(t.id, client, orgId);
  }
}

/**
 * After a role mutation, persist clearance for the work, then
 * re-persist release readiness for every release that has a track
 * pointing at that work.
 */
export async function persistAfterRoleChange(
  workId: string,
  client: DbClient = db,
  orgId = TRUE_NATURE_ORG_ID,
): Promise<void> {
  await persistClearanceProgress(workId, client, orgId);
  const trackRows = await client
    .select()
    .from(tracks)
    .where(and(eq(tracks.work_id, workId), eq(tracks.org_id, orgId)));
  const releaseIds = new Set<string>();
  for (const t of trackRows) {
    if (t.release_id) releaseIds.add(t.release_id);
  }
  for (const rid of [...releaseIds].sort()) {
    await persistReleaseReadiness(rid, client, orgId);
  }
}

/**
 * Run validation sweep.
 *
 * 1. Recompute and persist clearance + readiness for all works and releases.
 * 2. Upsert bugs for current issues (idempotent via bug_key).
 * 3. Close auto-generated bugs whose conditions are resolved.
 *
 * Returns honest counts: `created` = truly new bugs inserted,
 * `openIssues` = total open auto-bugs after sweep, `closed` = bugs closed this run.
 */
export async function runValidationSweep(orgId = TRUE_NATURE_ORG_ID): Promise<{
  created: number;
  openIssues: number;
  closed: number;
  releasesReevaluated: number;
  tracksReevaluated: number;
}> {
  let created = 0;
  let closed = 0;
  let tracksReevaluated = 0;
  let releasesReevaluated = 0;

  // 1. Recompute clearance + readiness for all works and releases
  const workRows = await db.select().from(works).where(eq(works.org_id, orgId));
  for (const w of workRows) {
    await db.transaction(async (tx) => {
      await lockWorkRoles(tx, orgId, w.id);
      await persistClearanceProgress(w.id, tx, orgId);
    });
  }

  const initialTrackRows = await db.select().from(tracks).where(eq(tracks.org_id, orgId));
  tracksReevaluated = initialTrackRows.length;
  for (const t of initialTrackRows) {
    await persistTrackReadiness(t.id, db, orgId);
  }

  const initialReleaseRows = await db.select().from(releases).where(eq(releases.org_id, orgId));
  releasesReevaluated = initialReleaseRows.length;
  for (const r of initialReleaseRows) {
    await persistReleaseReadiness(r.id, db, orgId);
  }

  const [trackRows, releaseRows, roleRows] = await Promise.all([
    db.select().from(tracks).where(eq(tracks.org_id, orgId)),
    db.select().from(releases).where(eq(releases.org_id, orgId)),
    db.select().from(roles).where(eq(roles.org_id, orgId)),
  ]);

  // 2. Generate bugs for current issues (upsert by bug_key)
  const currentBugKeys = new Set<string>();
  const candidates: SweepBugCandidate[] = [
    ...collectTrackSweepBugs(trackRows),
    ...collectReleaseSweepBugs(releaseRows, trackRows),
    ...collectRoleSweepBugs(roleRows),
    ...collectWorkSweepBugs(workRows, roleRows),
  ];

  for (const candidate of candidates) {
    currentBugKeys.add(candidate.key);
    const existed = await upsertBug(candidate, orgId);
    if (!existed) created++;
  }

  // 3. Close auto-generated bugs whose condition no longer holds
  const autoBugs = await db
    .select()
    .from(bugs)
    .where(and(eq(bugs.org_id, orgId), eq(bugs.auto_generated, true), ne(bugs.status, "done")));

  for (const b of autoBugs) {
    if (b.bug_key && !currentBugKeys.has(b.bug_key)) {
      await db
        .update(bugs)
        .set({ status: "done", updated_at: new Date() })
        .where(and(eq(bugs.id, b.id), eq(bugs.org_id, orgId)));
      closed++;
    }
  }

  const openBugs = await db
    .select()
    .from(bugs)
    .where(and(eq(bugs.org_id, orgId), eq(bugs.auto_generated, true), eq(bugs.status, "logged")));

  return {
    created,
    openIssues: openBugs.length,
    closed,
    releasesReevaluated,
    tracksReevaluated,
  };
}

/**
 * Upsert a bug by bug_key. Returns true if the bug already existed (false if newly created).
 */
async function upsertBug(
  candidate: SweepBugCandidate,
  orgId: string,
): Promise<boolean> {
  // Check if bug already exists
  const existing = await db
    .select()
    .from(bugs)
    .where(and(eq(bugs.bug_key, candidate.key), eq(bugs.org_id, orgId)));
  const existed = existing.length > 0;

  if (existed) {
    // Re-open if it was closed
    await db
      .update(bugs)
      .set({
        title: candidate.title,
        description: candidate.description,
        priority: candidate.priority,
        status: "logged",
        source_table: candidate.sourceTable,
        source_record_id: candidate.sourceRecordId,
        updated_at: new Date(),
      })
      .where(and(eq(bugs.bug_key, candidate.key), eq(bugs.org_id, orgId)));
  } else {
    await db.insert(bugs).values({
      id: `${orgId}:${candidate.key}`,
      org_id: orgId,
      bug_key: candidate.key,
      title: candidate.title,
      description: candidate.description,
      priority: candidate.priority,
      status: "logged",
      auto_generated: true,
      source_table: candidate.sourceTable,
      source_record_id: candidate.sourceRecordId,
    });
  }

  return existed;
}

// Serialize role writers and clearance sweeps before reading shares, preserving Track/Work row-lock order.
export async function lockWorkRoles(tx: Pick<typeof db, "execute">, orgId: string, workId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["work-roles", orgId, workId])}, 0))`);
}
