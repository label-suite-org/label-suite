import "dotenv/config";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertM0AuditTargetHealth,
  buildM0Audit,
  renderM0Markdown,
  type ParityReport,
} from "./m0-parity-audit-core";

const execFileAsync = promisify(execFile);

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.log(`Usage: npm run m0:parity -- --output <new-path> [--format markdown|json] [--target-revision <sha> --health-url <https-url>]

Runs the existing read-only Airtable/Postgres parity reader and turns its
evidence into an immutable M0 mismatch ledger. The output path must be new.
No Airtable or Postgres write operation is available in this command.
`);
  process.exit(1);
}

const outputPath = option("--output");
const format = option("--format") ?? "markdown";
const targetRevisionOption = option("--target-revision");
const healthUrl = option("--health-url");
if (!outputPath || !["markdown", "json"].includes(format)) usage();
if (!targetRevisionOption || !healthUrl) usage();

const tempDir = await mkdtemp(join(tmpdir(), "label-suite-m0-parity-"));
const parityPath = join(tempDir, "parity.json");

try {
  const targetRevision = targetRevisionOption;
  const parsedHealthUrl = new URL(healthUrl);
  if (parsedHealthUrl.protocol !== "https:") throw new Error("M0 audit health URL must use HTTPS");
  const response = await fetch(parsedHealthUrl);
  if (!response.ok) throw new Error(`M0 audit health request failed with HTTP ${response.status}`);
  assertM0AuditTargetHealth(await response.json(), targetRevision);

  const tsx = resolve("node_modules/.bin/tsx");
  await execFileAsync(tsx, ["scripts/airtable-parity.ts", "--json", "--output", parityPath], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  });

  const parityArtifact = await readFile(parityPath, "utf8");
  const parity = JSON.parse(parityArtifact) as ParityReport;
  parity.sourceRevision = `airtable-evidence-sha256:${createHash("sha256").update(parityArtifact).digest("hex")}`;
  parity.targetRevision = targetRevision;
  parity.auditCommands = [
    `npm run m0:parity -- --output <new-path> --target-revision ${targetRevision} --health-url <https-health-url>`,
    "npm run airtable:parity -- --json --output <read-only-parity-artifact>",
    "git rev-parse HEAD",
  ];
  const report = buildM0Audit(parity);
  const output = format === "json"
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderM0Markdown(report);

  await writeFile(outputPath, output, { flag: "wx" });
  console.log(`Wrote immutable M0 audit to ${outputPath}`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
