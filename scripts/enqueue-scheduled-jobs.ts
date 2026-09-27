import { pool } from "../src/lib/db";
import { jobStore } from "../src/server/jobs";

const scheduleDate = new Date().toISOString().slice(0, 10);

try {
  const result = await pool.query<{ id: string }>(
    `SELECT id
     FROM label_suite.orgs
     WHERE validation_sweep_mode = 'scheduled'
     ORDER BY id`,
  );

  for (const org of result.rows) {
    const job = await jobStore.enqueue({
      orgId: org.id,
      jobType: "validation_sweep",
      trigger: "scheduled",
      idempotencyKey: `scheduled:${scheduleDate}`,
    });
    console.log(`${org.id}: ${job.id} (${job.status})`);
  }
  console.log(`Scheduled validation sweeps checked for ${result.rowCount} workspace(s).`);
} finally {
  await pool.end();
}
