import path from "node:path";

import { createDokployDiagnosticAdapter } from "./dokploy-diagnostic-adapter";
import {
  FileAttemptLedger,
  runControlledSisenseDiagnostic,
} from "./sisense-diagnostic-controller";
import {
  ControllerReservationError,
  defaultControllerLockPath,
  runWithControllerReservation,
} from "./sisense-diagnostic-reservation";

const help = `One-attempt Sisense diagnostic controller

Usage:
  npm run sisense:diagnostic -- --evidence-file <absolute-path> --attempt-id <id> \\
    --compose-id <id> --app-name <name> --service-name <name> \\
    --expected-revision <40-hex-sha> --daily-schedule-id <id> \\
    --artist-name <name> --track-title <title> [--transport-proof]

Required:
  --evidence-file <absolute-path>  Persisted local sanitized attempt ledger
  --attempt-id <id>                Unique identifier for this one controlled attempt
  --compose-id <id>                Dokploy compose identifier
  --app-name <name>                Dokploy compose application name
  --service-name <name>            Sisense service name
  --expected-revision <sha>        Deployed 40-hex release revision
  --daily-schedule-id <id>         Existing Daily validation scheduler identifier
  --artist-name <name>             Required Phase A artist provider filter
  --track-title <title>            Required Phase A track provider filter
  --transport-proof                Prove Dokploy transport and revision only; does not run Phase A
  Global controller reservation (fixed; no override):
                                    ~/.local/state/label-suite/sisense-diagnostic-controller.lock

Runtime prerequisites:
  DOKPLOY_URL and DOKPLOY_API_KEY (or DOKPLOY_AUTH_TOKEN) must be supplied
  by the approved operator. Values are never written to the ledger or output.
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(help);
    return;
  }

  const required = ["evidence-file", "attempt-id", "compose-id", "app-name", "service-name", "expected-revision", "daily-schedule-id"] as const;
  for (const name of required) {
    if (!args.values[name]) return fail("argument_missing");
  }

  const evidenceFile = args.values["evidence-file"]!;
  const expectedRevision = args.values["expected-revision"]!;
  if (args.values["lock-file"]) return fail("lock_file_override_forbidden");
  const lockFile = defaultControllerLockPath();
  const token = process.env.DOKPLOY_API_KEY ?? process.env.DOKPLOY_AUTH_TOKEN;
  const url = process.env.DOKPLOY_URL;
  if (!path.isAbsolute(evidenceFile)) return fail("evidence_file_not_absolute");
  if (!path.isAbsolute(lockFile)) return fail("lock_file_not_absolute");
  if (path.resolve(evidenceFile) === path.resolve(lockFile)) return fail("lock_file_conflicts_evidence");
  if (!/^[a-f0-9]{40}$/.test(expectedRevision)) return fail("expected_revision_invalid");
  if (!args.transportProof && (!args.values["artist-name"] || !args.values["track-title"])) {
    return fail("diagnostic_scope_missing");
  }
  if (!url || !token) return fail("dokploy_credentials_missing");

  const pollLimit = parsePollLimit(args.values["poll-limit"]);
  if (pollLimit === null) return fail("poll_limit_invalid");

  const input = {
    attemptId: args.values["attempt-id"]!,
    ledger: new FileAttemptLedger(evidenceFile),
    composeId: args.values["compose-id"]!,
    appName: args.values["app-name"]!,
    serviceName: args.values["service-name"]!,
    expectedRevision,
    artistName: args.values["artist-name"],
    trackTitle: args.values["track-title"],
    dailyScheduleId: args.values["daily-schedule-id"]!,
    temporarySchedulePrefix: args.values["temporary-schedule-prefix"] ?? "issue-82-sisense-7d-diagnostic-",
    pollLimit,
    mode: args.transportProof ? "transport-proof" as const : "diagnostic" as const,
  };

  try {
    const outcome = await runWithControllerReservation({
      lockFile,
      attemptId: input.attemptId,
      ledgerPath: evidenceFile,
      run: () => runControlledSisenseDiagnostic(
        input,
        createDokployDiagnosticAdapter({ composeId: input.composeId, connection: { url, token } }),
      ),
    });
    console.log(JSON.stringify({ ...outcome.result, reservationRetained: outcome.reservationRetained }));
    process.exitCode = outcome.result.ok ? 0 : 1;
  } catch (error) {
    if (error instanceof ControllerReservationError) fail(error.code);
    fail("controller_failed");
  }
}

function parseArgs(raw: string[]): { help: boolean; transportProof: boolean; values: Record<string, string | undefined> } {
  const values: Record<string, string | undefined> = {};
  let help = false;
  let transportProof = false;
  for (let index = 0; index < raw.length; index += 1) {
    const value = raw[index];
    if (value === "--help" || value === "-h") {
      help = true;
      continue;
    }
    if (value === "--transport-proof") {
      transportProof = true;
      continue;
    }
    if (!value.startsWith("--")) continue;
    const name = value.slice(2);
    const next = raw[index + 1];
    if (!next || next.startsWith("--")) continue;
    values[name] = next;
    index += 1;
  }
  return { help, transportProof, values };
}

function parsePollLimit(value: string | undefined): number | null {
  if (value === undefined) return 120;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : null;
}

function fail(code: string): never {
  console.log(JSON.stringify({ ok: false, code }));
  process.exit(1);
}

void main();
