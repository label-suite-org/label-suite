import { Pool, type PoolClient } from "pg";

import { computeCoverageForProjects } from "../src/server/funding-coverage-core";
import { inferMigratedGrantApplication, isGrantLifecycleSource, type LegacyFundingSource } from "../src/server/grants-money-model-core";

type LegacySourceRow = LegacyFundingSource & { org_id: string };

export function buildGrantMoneyModelPlan(rows: LegacySourceRow[]) {
  return rows
    .filter(isGrantLifecycleSource)
    .map((source) => ({ source, application: inferMigratedGrantApplication(source)! }));
}

async function coverageSnapshot(client: PoolClient) {
  const [projects, lines, sources, applications] = await Promise.all([
    client.query("SELECT id, currency, total_planned FROM label_suite.budget_projects"),
    client.query("SELECT project_id, planned_amount, amount FROM label_suite.budget_line_items"),
    client.query("SELECT id, project_id, status, amount_confirmed, amount_planned FROM label_suite.funding_sources"),
    client.query("SELECT project_id, funding_source_id, workflow_stage, outcome, amount_requested, amount_awarded FROM label_suite.grant_applications"),
  ]);
  return [...computeCoverageForProjects(projects.rows, lines.rows, sources.rows, applications.rows).values()]
    .sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function sameCoverage(before: Awaited<ReturnType<typeof coverageSnapshot>>, after: Awaited<ReturnType<typeof coverageSnapshot>>) {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function loadLegacySources(client: PoolClient, orgId?: string) {
  const result = await client.query<LegacySourceRow>(
    `SELECT id, org_id, type, project_id, name, funder, status, amount_planned,
            grant_amount_received, application_date, decision_date, grant_reporting_due
       FROM label_suite.funding_sources
      WHERE lower(coalesce(type, '')) = 'grant'
        AND ($1::text IS NULL OR org_id = $1)
        AND (nullif(application_date, '') IS NOT NULL
          OR nullif(decision_date, '') IS NOT NULL
          OR nullif(grant_reporting_due, '') IS NOT NULL
          OR coalesce(grant_amount_received, 0) <> 0)
        AND NOT EXISTS (
          SELECT 1 FROM label_suite.grant_applications existing
           WHERE existing.org_id = funding_sources.org_id
             AND existing.funding_source_id = funding_sources.id
        )`,
    [orgId ?? null],
  );
  return result.rows;
}

async function applyPlan(client: PoolClient, plan: ReturnType<typeof buildGrantMoneyModelPlan>) {
  for (const { source, application } of plan) {
    await client.query(
      `INSERT INTO label_suite.grant_applications
        (id, org_id, project_id, grant_id, funding_source_id, status, priority,
         workflow_stage, outcome, amount_requested, amount_awarded, submitted_at,
         decision_date, reporting_due, next_action, notes)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO NOTHING`,
      [application.id, source.org_id, application.project_id, application.funding_source_id,
        application.status, application.priority, application.workflow_stage, application.outcome,
        application.amount_requested, application.amount_awarded, application.submitted_at,
        application.decision_date, application.reporting_due, application.next_action, application.notes],
    );

    if (application.outcome === "approved" && application.amount_awarded != null) {
      await client.query(
        `INSERT INTO label_suite.funding_source_events
          (id, org_id, funding_source_id, from_status, to_status, occurred_at, note)
         SELECT $1, org_id, id, status, 'confirmed', now(),
                'Legacy grant lifecycle migrated to grant application'
           FROM label_suite.funding_sources
          WHERE id = $2 AND org_id = $3
            AND status <> 'confirmed'
            AND NOT EXISTS (SELECT 1 FROM label_suite.funding_source_events WHERE id = $1)
         ON CONFLICT (id) DO NOTHING`,
        [`legacy-grant-source-event-${source.id}`, source.id, source.org_id],
      );
      await client.query(
        `UPDATE label_suite.funding_sources
            SET status = 'confirmed',
                amount_confirmed = coalesce(amount_confirmed, grant_amount_received, amount_planned),
                updated_at = now()
          WHERE id = $1 AND org_id = $2`,
        [source.id, source.org_id],
      );
    }
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const orgId = process.env.GRANTS_MONEY_MODEL_ORG_ID;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const rows = await loadLegacySources(client, orgId);
    const plan = buildGrantMoneyModelPlan(rows);
    if (!apply) {
      console.log(JSON.stringify({ mode: "dry-run", orgId: orgId ?? "all", count: plan.length, plan }, null, 2));
      return;
    }

    const before = await coverageSnapshot(client);
    await client.query("BEGIN");
    try {
      await applyPlan(client, plan);
      const after = await coverageSnapshot(client);
      if (!sameCoverage(before, after)) {
        throw new Error("Coverage parity assertion failed; rolling back the migration.");
      }
      await client.query("COMMIT");
      console.log(JSON.stringify({ mode: "apply", orgId: orgId ?? "all", count: plan.length, coverageParity: "passed" }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
