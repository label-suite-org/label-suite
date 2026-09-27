const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);

if (args.has("--help") || args.has("-h")) {
  console.log(`Usage: npm run sweep -- [--org <org-id>]

Runs the Label Suite validation sweep once, then exits.

Required environment:
  DATABASE_URL   Postgres connection string for the target Label Suite DB
`);
  process.exit(0);
}

const { runValidationSweep } = await import("../src/lib/readiness");
const { pool } = await import("../src/lib/db");
const { runTrackedJob } = await import("../src/server/job-runs");

try {
  const orgId = readOption("--org") ?? process.env.LABEL_SUITE_SWEEP_ORG_ID ?? "true-nature";
  console.log(`Running validation sweep for org ${orgId}...`);
  const result = await runTrackedJob(
    { orgId, jobType: "validation_sweep", trigger: "manual" },
    () => runValidationSweep(orgId),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await pool.end();
}

function readOption(name: string): string | undefined {
  const index = rawArgs.indexOf(name);
  if (index >= 0) return rawArgs[index + 1];
  const prefix = `${name}=`;
  const value = rawArgs.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length);
}

export {};
