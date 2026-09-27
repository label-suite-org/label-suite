export const REQUIRED_FORCE_RLS_TABLES = [
  "royalty_imports",
  "royalty_import_currency_totals",
  "royalty_earnings",
  "royalty_split_snapshots",
  "royalty_split_lines",
  "royalty_calculation_runs",
  "royalty_statements",
  "royalty_payouts",
  "royalty_statement_lines",
  "royalty_ledger_transactions",
  "royalty_ledger_entries",
] as const;

interface RoyaltyRuntimePrincipalPosture {
  principal: string;
  superuser: boolean;
  bypassRls: boolean;
}

interface RoyaltyRuntimeTablePosture {
  forceRlsTables: readonly string[];
}

interface RoyaltyRuntimeAccessPosture {
  schemaUsage: boolean;
  establishLifecycleContext: boolean;
  lifecycleContextTable: boolean;
}

export function assertRoyaltyRuntimePrincipalPosture(posture: RoyaltyRuntimePrincipalPosture): void {
  if (posture.superuser || posture.bypassRls) {
    throw new Error(
      `DATABASE_URL principal ${posture.principal} cannot enforce royalty tenant RLS while SUPERUSER or BYPASSRLS is enabled.`,
    );
  }
}

export function assertRoyaltyRuntimeTablePosture(posture: RoyaltyRuntimeTablePosture): void {
  const forced = new Set(posture.forceRlsTables);
  const missing = REQUIRED_FORCE_RLS_TABLES.filter((table) => !forced.has(table));
  if (missing.length > 0) {
    throw new Error(`Royalty runtime database posture is missing FORCE ROW LEVEL SECURITY on: ${missing.join(", ")}.`);
  }
}

export function assertRoyaltyRuntimeAccessPosture(posture: RoyaltyRuntimeAccessPosture): void {
  if (!posture.schemaUsage || !posture.establishLifecycleContext) {
    throw new Error("Royalty runtime database principal is missing required schema or lifecycle access.");
  }
  if (posture.lifecycleContextTable) {
    throw new Error("Royalty runtime database principal must not access the royalty lifecycle context table.");
  }
}
