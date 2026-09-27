export interface ClearanceRoleRow {
  ownership_type: string | null;
  scope: string | null;
  percent_share: number | null;
  clearance_status: string | null;
}

/**
 * Per-scope clearance result for a work.
 * Only `ownership_type='Rights'` lines count toward clearance; Credit lines are excluded.
 */
export interface ScopeClearance {
  /** Sum of percent_share across Rights lines in this scope */
  enteredTotal: number;
  /** Sum of percent_share x statusWeight across Rights lines in this scope */
  weightedTotal: number;
  /**
   * Progress toward clearance: weightedTotal / 100.
   * This may exceed 1 if the scope is overallocated.
   */
  progress: number;
  /** True when progress >= 1.0 */
  cleared: boolean;
}

/** Full clearance result for a work (Publishing + Master universes). */
export interface WorkClearance {
  pub: ScopeClearance;
  master: ScopeClearance;
  /** Minimum of all applicable scopes' progress. If no scopes apply, 0. */
  overall: number;
  /**
   * True when every applicable scope is cleared.
   * If there are no applicable Rights lines, returns false.
   */
  cleared: boolean;
}

export const CLEARANCE_STATUS_WEIGHTS: Record<string, number> = {
  Signed: 1.0,
  Confirmed: 0.75,
  Pending: 0.25,
  Unknown: 0,
};

/**
 * Compute clearance progress from role rows.
 *
 * Rules:
 * - `ownership_type='Credit'` lines are excluded entirely.
 * - `Mechanical` scope rolls into Publishing.
 * - A scope with no Rights lines is not applicable and does not block clearance.
 * - Overall progress is the min of applicable scopes.
 * - If there are no applicable Rights lines, the work is not cleared.
 * - percent_share is on a 0-100 scale.
 */
export function computeClearanceFromRoleRows(
  roleRows: ClearanceRoleRow[],
): WorkClearance {
  const rightsRows = roleRows.filter((r) => r.ownership_type !== "Credit");

  const pubRows = rightsRows.filter(
    (r) => r.scope === "Publishing" || r.scope === "Mechanical",
  );
  const masterRows = rightsRows.filter((r) => r.scope === "Master");

  const pub = computeScope(pubRows);
  const master = computeScope(masterRows);

  const applicable = [];
  if (pubRows.length > 0) applicable.push(pub);
  if (masterRows.length > 0) applicable.push(master);

  const overall =
    applicable.length > 0
      ? Math.min(...applicable.map((scope) => scope.progress))
      : 0;

  const cleared = applicable.length > 0 && applicable.every((scope) => scope.cleared);

  return { pub, master, overall, cleared };
}

function computeScope(rows: ClearanceRoleRow[]): ScopeClearance {
  if (rows.length === 0) {
    return { enteredTotal: 0, weightedTotal: 0, progress: 1, cleared: true };
  }

  let totalWeighted = 0;
  let totalShares = 0;

  for (const row of rows) {
    const share = row.percent_share ?? 0;
    const weight = CLEARANCE_STATUS_WEIGHTS[row.clearance_status ?? "Unknown"] ?? 0;
    totalWeighted += share * weight;
    totalShares += share;
  }

  const progress = Math.round((totalWeighted / 100) * 10000) / 10000;

  return {
    enteredTotal: Math.round(totalShares * 100) / 100,
    weightedTotal: Math.round(totalWeighted * 100) / 100,
    progress,
    cleared: progress >= 1.0,
  };
}
