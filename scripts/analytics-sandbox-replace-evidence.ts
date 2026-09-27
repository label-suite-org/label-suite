import { resolveAnalyticsSandboxConfig } from "./analytics-sandbox-config";

export interface AnalyticsEvidenceQueryClient {
  query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface AnalyticsSandboxReplacementTarget {
  mode: string;
  apply: boolean;
  noUpload: boolean;
  orgId: string;
  schema: string;
  databaseUrl: string | undefined;
  env: NodeJS.ProcessEnv;
}

export interface AnalyticsSandboxReplacementSummary {
  metricChanges: number;
  importFiles: number;
  metricRows: number;
  importRuns: number;
}

export function assertAnalyticsSandboxReplacementTarget(
  input: AnalyticsSandboxReplacementTarget,
): { orgId: string } {
  if (input.mode !== "import" || !input.apply || !input.noUpload) {
    refuse("requires --mode import --apply --no-upload.");
  }
  if (input.schema !== "label_suite") {
    refuse("requires the label_suite schema.");
  }

  let config;
  try {
    config = resolveAnalyticsSandboxConfig(input.env);
  } catch (error) {
    refuse(error instanceof Error ? error.message : "invalid sandbox configuration.");
  }

  if (input.orgId !== config.orgId) {
    refuse("--org must equal ANALYTICS_SANDBOX_ORG_ID.");
  }
  if (!input.databaseUrl || input.databaseUrl !== config.databaseUrl) {
    refuse("DATABASE_URL must exactly equal ANALYTICS_SANDBOX_DB_URL.");
  }

  return { orgId: config.orgId };
}

export async function replaceAnalyticsSandboxEvidence(
  client: AnalyticsEvidenceQueryClient,
  input: { orgId: string; currentRunId: string },
): Promise<AnalyticsSandboxReplacementSummary> {
  const values = [input.orgId, "sisense", input.currentRunId];
  const metricChanges = await client.query(`
    delete from label_suite.analytics_metric_changes
    where org_id = $1 and source = $2 and run_id <> $3
  `, values);
  const importFiles = await client.query(`
    delete from label_suite.analytics_import_files
    where org_id = $1 and source = $2 and run_id <> $3
  `, values);
  const metricRows = await client.query(`
    delete from label_suite.analytics_metric_rows
    where org_id = $1 and source = $2 and last_seen_run_id is distinct from $3
  `, values);
  const importRuns = await client.query(`
    delete from label_suite.analytics_import_runs
    where org_id = $1 and source = $2 and id <> $3
  `, values);

  return {
    metricChanges: metricChanges.rowCount ?? 0,
    importFiles: importFiles.rowCount ?? 0,
    metricRows: metricRows.rowCount ?? 0,
    importRuns: importRuns.rowCount ?? 0,
  };
}

function refuse(message: string): never {
  throw new Error(`Refusing analytics sandbox evidence replacement: ${message}`);
}
