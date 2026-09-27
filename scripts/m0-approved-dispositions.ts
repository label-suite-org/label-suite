import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { M0AuditReport } from "./m0-parity-audit-core";
import { approveM0Dispositions, summarizeApprovedM0Ledger } from "./m0-approved-dispositions-core";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const input = option("--input");
const output = option("--output");
const approvedAt = option("--approved-at");
if (!input || !output || !approvedAt) {
  console.error("Usage: tsx scripts/m0-approved-dispositions.ts --input <audit.json> --output <new-ledger.json> --approved-at <ISO timestamp>");
  process.exit(1);
}

const audit = JSON.parse(await readFile(resolve(input), "utf8")) as M0AuditReport;
const ledger = approveM0Dispositions(audit, approvedAt);
await writeFile(resolve(output), `${JSON.stringify(ledger, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: resolve(output), total: ledger.dispositions.length, counts: summarizeApprovedM0Ledger(ledger) }));
