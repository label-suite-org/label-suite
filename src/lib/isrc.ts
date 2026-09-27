/**
 * ISRC generation utilities.
 *
 * ISRC format (ISO 3901): CC-XXX-YY-NNNNN
 *   CC = country code
 *   XXX = registrant code
 *   YY = last two digits of year
 *   NNNNN = 5-digit designation code
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { isrc_sequences, orgs, tracks, works } from "../db/schema";
import { db } from "./db";
import { persistReleaseReadiness, persistTrackReadiness } from "./readiness";
import { ConflictError } from "../server/errors";

type DbClient = Pick<typeof db, "select" | "insert" | "update">;

export const LEGACY_TRUE_NATURE_PREFIX = "DKO7P";
export const LEGACY_TRUE_NATURE_COUNTRY_CODE = "DK";
export const LEGACY_TRUE_NATURE_REGISTRANT_CODE = "O7P";

export type WorkspaceIsrcConfig = {
  countryCode: string;
  registrantCode: string;
  prefix: string;
  source: "workspace" | "legacy-true-nature";
};

type WorkspaceIsrcFields = {
  isrc_country_code?: string | null;
  isrc_registrant_code?: string | null;
};

export function normalizeIsrcCountryCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function normalizeIsrcRegistrantCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? "";
  return /^[A-Z0-9]{3}$/.test(normalized) ? normalized : null;
}

export function buildIsrcPrefix(countryCode: string, registrantCode: string): string {
  return `${countryCode}${registrantCode}`;
}

/** Store ISRCs in the canonical 12-character form used for comparisons. */
export function normalizeIsrcValue(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase().replace(/[\s-]/g, "") ?? "";
  return normalized || null;
}

export function formatIsrc(prefix: string, year: number, designationNumber: number): string {
  if (!Number.isInteger(designationNumber) || designationNumber < 1 || designationNumber > 99999) {
    throw new Error("ISRC designation number must be between 1 and 99999");
  }
  const yearCode = String(year).slice(-2);
  const designation = String(designationNumber).padStart(5, "0");
  return `${prefix}${yearCode}${designation}`;
}

export type IsrcAssignmentPlan = {
  source: "existing-track" | "linked-work" | "allocate";
  isrc: string | null;
};

export function planIsrcAssignment(input: {
  trackIsrc: string | null | undefined;
  workIsrc: string | null | undefined;
}): IsrcAssignmentPlan {
  const trackIsrc = normalizeIsrcValue(input.trackIsrc);
  if (trackIsrc) return { source: "existing-track", isrc: trackIsrc };

  const workIsrc = normalizeIsrcValue(input.workIsrc);
  if (workIsrc) return { source: "linked-work", isrc: workIsrc };

  return { source: "allocate", isrc: null };
}

export function deriveWorkspaceIsrcConfig(
  orgId: string,
  fields: WorkspaceIsrcFields,
): WorkspaceIsrcConfig | null {
  const countryCode = normalizeIsrcCountryCode(fields.isrc_country_code);
  const registrantCode = normalizeIsrcRegistrantCode(fields.isrc_registrant_code);

  if (countryCode && registrantCode) {
    return {
      countryCode,
      registrantCode,
      prefix: buildIsrcPrefix(countryCode, registrantCode),
      source: "workspace",
    };
  }

  if (orgId === "true-nature") {
    return {
      countryCode: LEGACY_TRUE_NATURE_COUNTRY_CODE,
      registrantCode: LEGACY_TRUE_NATURE_REGISTRANT_CODE,
      prefix: LEGACY_TRUE_NATURE_PREFIX,
      source: "legacy-true-nature",
    };
  }

  return null;
}

export async function getWorkspaceIsrcConfig(
  orgId: string,
  client: Pick<typeof db, "select"> = db,
): Promise<WorkspaceIsrcConfig | null> {
  const row = (
    await client
      .select({
        isrc_country_code: orgs.isrc_country_code,
        isrc_registrant_code: orgs.isrc_registrant_code,
      })
      .from(orgs)
      .where(eq(orgs.id, orgId))
  )[0];

  return deriveWorkspaceIsrcConfig(orgId, row ?? {});
}

export async function generateISRC(
  orgId: string,
  year?: number,
  client: DbClient = db,
): Promise<string> {
  const config = await getWorkspaceIsrcConfig(orgId, client);
  if (!config) {
    throw new Error("ISRC settings are not configured for this workspace");
  }

  return generateISRCForPrefix(orgId, config.prefix, year, client);
}

export async function maybeGenerateISRC(
  orgId: string,
  year?: number,
  client: DbClient = db,
): Promise<string | null> {
  const config = await getWorkspaceIsrcConfig(orgId, client);
  if (!config) return null;
  return generateISRCForPrefix(orgId, config.prefix, year, client);
}

async function generateISRCForPrefix(
  orgId: string,
  prefix: string,
  year?: number,
  client: DbClient = db,
): Promise<string> {
  const resolvedYear = year ?? new Date().getFullYear();
  const highestExistingDesignation = await getHighestExistingDesignation(client, orgId, prefix, resolvedYear);
  const minimumNextNumber = highestExistingDesignation + 1;

  const [sequence] = await client
    .insert(isrc_sequences)
    .values({
      id: crypto.randomUUID(),
      org_id: orgId,
      year: resolvedYear,
      last_production_number: Math.max(1, minimumNextNumber),
      prefix,
    })
    .onConflictDoUpdate({
      target: [isrc_sequences.org_id, isrc_sequences.year],
      set: {
        last_production_number: sql`GREATEST(COALESCE(${isrc_sequences.last_production_number}, 0) + 1, ${minimumNextNumber})`,
        prefix,
      },
    })
    .returning({
      lastProductionNumber: isrc_sequences.last_production_number,
      prefix: isrc_sequences.prefix,
    });

  const nextNumber = sequence?.lastProductionNumber ?? 1;
  const sequencePrefix = sequence?.prefix ?? prefix;
  return formatIsrc(sequencePrefix, resolvedYear, nextNumber);
}

async function getHighestExistingDesignation(
  client: DbClient,
  orgId: string,
  prefix: string,
  year: number,
): Promise<number> {
  const [workRows, trackRows] = await Promise.all([
    client.select({ isrc: works.isrc }).from(works).where(eq(works.org_id, orgId)),
    client.select({ isrc: tracks.isrc }).from(tracks).where(eq(tracks.org_id, orgId)),
  ]);
  const values = [...workRows, ...trackRows]
    .map((row) => isrcDesignationNumber(row.isrc, prefix, year))
    .filter((value): value is number => value !== null);

  return values.length ? Math.max(...values) : 0;
}

function isrcDesignationNumber(value: string | null, prefix: string, year: number): number | null {
  const normalized = normalizeIsrcValue(value);
  const yearCode = String(year).slice(-2);
  const expectedLength = prefix.length + 2 + 5;
  if (!normalized || normalized.length !== expectedLength || !normalized.startsWith(`${prefix}${yearCode}`)) {
    return null;
  }

  const designation = normalized.slice(prefix.length + 2);
  if (!/^\d{5}$/.test(designation)) return null;
  return Number(designation);
}

export async function assertIsrcAvailableForWork(
  client: Pick<typeof db, "select">,
  orgId: string,
  isrc: string,
  workId: string,
  trackId?: string,
): Promise<string> {
  const normalized = normalizeIsrcValue(isrc);
  if (!normalized) throw new ConflictError("A non-empty ISRC is required");

  const workRows = await client
    .select({ id: works.id, isrc: works.isrc })
    .from(works)
    .where(eq(works.org_id, orgId));
  const conflict = workRows.find(
    (work) => work.id !== workId && normalizeIsrcValue(work.isrc) === normalized,
  );
  if (conflict) {
    throw new ConflictError(`${normalized} is already assigned to another work in this workspace`);
  }

  const trackRows = await client
    .select({ id: tracks.id, work_id: tracks.work_id, isrc: tracks.isrc })
    .from(tracks)
    .where(eq(tracks.org_id, orgId));
  const trackConflict = trackRows.find(
    (track) =>
      track.id !== trackId &&
      track.work_id !== workId &&
      normalizeIsrcValue(track.isrc) === normalized,
  );
  if (trackConflict) {
    throw new ConflictError(`${normalized} is already assigned to another track in this workspace`);
  }

  return normalized;
}

export type AssignIsrcsResult = {
  releaseId: string;
  assignedCount: number;
  reusedCount: number;
  skippedCount: number;
  createdWorkCount: number;
  assignments: Array<{ trackId: string; isrc: string; source: "allocated" | "linked-work" }>;
};

/**
 * Assign ISRCs to all tracks on a release that don't have one.
 * Also assigns to the linked work if it doesn't have one.
 */
export async function assignISRCsToRelease(orgId: string, releaseId: string): Promise<AssignIsrcsResult> {
  return db.transaction(async (tx) => {
    const trackRows = await tx
      .select()
      .from(tracks)
      .where(and(eq(tracks.release_id, releaseId), eq(tracks.org_id, orgId)));

    if (!trackRows.length) {
      return {
        releaseId,
        assignedCount: 0,
        reusedCount: 0,
        skippedCount: 0,
        createdWorkCount: 0,
        assignments: [],
      };
    }

    const workIds = trackRows.flatMap((track) => (track.work_id ? [track.work_id] : []));
    const workRows = workIds.length
      ? await tx
          .select({ id: works.id, title: works.title, isrc: works.isrc })
          .from(works)
          .where(and(eq(works.org_id, orgId), inArray(works.id, workIds)))
      : [];
    const workById = new Map(workRows.map((work) => [work.id, { ...work }]));

    let assigned = 0;
    let reused = 0;
    let skipped = 0;
    let createdWorkCount = 0;
    const assignments: AssignIsrcsResult["assignments"] = [];
    for (const track of trackRows) {
      let work = track.work_id ? workById.get(track.work_id) : undefined;

      if (!work) {
        const matchingWork = (
          await tx
            .select({ id: works.id, title: works.title, isrc: works.isrc })
            .from(works)
            .where(and(eq(works.org_id, orgId), eq(works.title, track.title)))
            .limit(1)
        )[0];

        work = matchingWork ?? {
          id: crypto.randomUUID(),
          title: track.title,
          isrc: null,
        };
        if (!matchingWork) {
          await tx.insert(works).values({
            id: work.id,
            org_id: orgId,
            title: work.title,
            isrc: null,
          });
          createdWorkCount++;
        }
        workById.set(work.id, work);
        await tx
          .update(tracks)
          .set({ work_id: work.id, updated_at: new Date() })
          .where(and(eq(tracks.id, track.id), eq(tracks.org_id, orgId)));
      }

      const plan = planIsrcAssignment({ trackIsrc: track.isrc, workIsrc: work.isrc });
      if (plan.source === "existing-track") {
        const normalized = await assertIsrcAvailableForWork(tx, orgId, plan.isrc!, work.id, track.id);
        const workIsrc = normalizeIsrcValue(work.isrc);
        if (workIsrc && workIsrc !== normalized) {
          throw new ConflictError(`${normalized} conflicts with the linked work ISRC ${workIsrc}`);
        }
        if (!work.isrc) {
          await tx.update(works).set({ isrc: normalized, updated_at: new Date() }).where(eq(works.id, work.id));
          work.isrc = normalized;
        }
        await persistTrackReadiness(track.id, tx, orgId);
        skipped++;
        continue;
      }

      const isrc = plan.isrc ?? await generateISRC(orgId, undefined, tx);
      const normalized = await assertIsrcAvailableForWork(tx, orgId, isrc, work.id, track.id);
      await tx
        .update(tracks)
        .set({ isrc: normalized, work_id: work.id, updated_at: new Date() })
        .where(and(eq(tracks.id, track.id), eq(tracks.org_id, orgId)));

      if (!work.isrc) {
        await tx
          .update(works)
          .set({ isrc: normalized, updated_at: new Date() })
          .where(and(eq(works.id, work.id), eq(works.org_id, orgId)));
        work.isrc = normalized;
      }

      await persistTrackReadiness(track.id, tx, orgId);

      assigned++;
      if (plan.source === "linked-work") {
        reused++;
        assignments.push({ trackId: track.id, isrc: normalized, source: "linked-work" });
      } else {
        assignments.push({ trackId: track.id, isrc: normalized, source: "allocated" });
      }
    }

    await persistReleaseReadiness(releaseId, tx, orgId);

    return {
      releaseId,
      assignedCount: assigned,
      reusedCount: reused,
      skippedCount: skipped,
      createdWorkCount,
      assignments,
    };
  });
}
