import { pool } from "../src/lib/db";

const maxAgeMs = Number(process.env.LABEL_SUITE_WORKER_HEALTH_MAX_AGE_MS ?? "45000");
const maxAgeSeconds = Math.max(1, Math.ceil(maxAgeMs / 1000));

const result = await pool.query<{
  running_workers: string;
  fresh_workers: string;
}>(
  `
SELECT
  count(*) FILTER (
    WHERE status = 'running'
      AND last_seen_at IS NOT NULL
  ) AS running_workers,
  count(*) FILTER (
    WHERE status = 'running'
      AND last_seen_at >= now() - make_interval(secs => $1)
  ) AS fresh_workers
FROM label_suite.job_workers;
`,
  [maxAgeSeconds],
);

await pool.end();

const runningWorkers = Number(result.rows[0]?.running_workers ?? 0);
const freshWorkers = Number(result.rows[0]?.fresh_workers ?? 0);

if (!Number.isFinite(maxAgeMs) || runningWorkers <= 0 || freshWorkers <= 0) {
  console.error(`Worker healthcheck failed. runningWorkers=${runningWorkers}, freshWorkers=${freshWorkers}, maxAgeMs=${maxAgeMs}`);
  process.exit(1);
}

process.exit(0);
