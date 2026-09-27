import { Client } from "pg";
import { resolveAnalyticsSandboxConfig } from "./analytics-sandbox-config";
import { seedAnalyticsSandbox } from "./analytics-sandbox-seed-core";

async function main(): Promise<void> {
  const config = resolveAnalyticsSandboxConfig(process.env);
  const client = new Client({ connectionString: config.databaseUrl });

  try {
    await client.connect();
    const summary = await seedAnalyticsSandbox(client, config);
    console.log(`analytics sandbox seeded: version=${summary.fixtureVersion} org=${summary.orgId} artists=${summary.artists} releases=${summary.releases} tracks=${summary.tracks} metricRows=${summary.metricRows} importRuns=${summary.importRuns}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
