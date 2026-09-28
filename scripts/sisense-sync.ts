import "dotenv/config";
import { runSisenseIngestionRun } from "./sisense-ingestion-run";

try {
  await runSisenseIngestionRun({ args: process.argv.slice(2) });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
