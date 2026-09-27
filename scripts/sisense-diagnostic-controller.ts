import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { DiagnosticMode, ProbeOutcome, TransportProof } from "./sisense-diagnostic-log-probe";
import { isDiagnosticFailureCode, type DiagnosticFailure } from "./sisense-diagnostic-failure";

export type ScheduleRecord = {
  scheduleId: string;
  name: string;
  enabled: boolean;
  scheduleType: string;
  composeId: string;
  appName: string;
  serviceName: string;
  shellType: string;
  timezone: string | null;
  command: string;
  cronExpression?: string;
  description?: string | null;
};

export type DeploymentRecord = {
  deploymentId: string;
  status: string;
  logPath?: string;
  serverId?: string;
};

export type DeploymentLogProbeTarget = Required<
  Pick<DeploymentRecord, "deploymentId" | "logPath">
> & Pick<DeploymentRecord, "serverId">;

export type DiagnosticSummary = {
  version: 1;
  runId: string;
  mode: "scrape";
  requestedDateRange: "7 Days";
  requestedAggregation: "Daily";
  observedAt: string;
  providerFilterState: {
    artist: string;
    dateRange: "7 Days";
    aggregation: "Daily";
    track: string;
  };
  databaseLockHeld: boolean;
  effectiveWidgetKeys: string[];
  effectiveWidgetCount: number;
  downloadedWidgetKeys: string[];
  observedEmptyWidgets: Array<{ key: string; reason: string }>;
  skippedWidgets: Array<{ key: string; reason: string }>;
  completenessState: "complete" | "partial" | "empty";
  fileCount: number;
  files: Array<{ widgetKey: string; rowCount: number; sha256: string }>;
};

export type ManualRunOutcome =
  | { kind: "response"; status?: string; deploymentId?: string; logPath?: string; serverId?: string }
  | { kind: "nonzero"; code: string }
  | { kind: "timeout" }
  | { kind: "malformed_response" };

export type CreateScheduleRequest = Omit<ScheduleRecord, "scheduleId" | "timezone"> & { timezone: "UTC" };

export interface ControllerAdapter {
  listSchedules(): Promise<ScheduleRecord[]>;
  createDisabledSchedule(request: CreateScheduleRequest): Promise<ScheduleRecord>;
  readSchedule(scheduleId: string): Promise<ScheduleRecord | null>;
  listDeployments(scheduleId: string): Promise<DeploymentRecord[]>;
  runManual(scheduleId: string): Promise<ManualRunOutcome>;
  probeDeploymentLog(
    deployment: DeploymentLogProbeTarget,
    mode: DiagnosticMode,
  ): Promise<ProbeOutcome>;
  deleteSchedule(scheduleId: string): Promise<void>;
  pause(milliseconds: number): Promise<void>;
}

export type PersistedAttempt = {
  version: 1;
  attemptId: string;
  state: string;
  manualInvocationCount: number;
  mode?: DiagnosticMode;
  preflight?: {
    dailyFingerprint: string;
    scheduleInventoryFingerprint: string;
    sisenseScheduleFingerprint: string;
    deploymentHistoryFingerprint: string;
  };
  scheduleRequest?: { name: string; fingerprint: string };
  schedule?: { scheduleId: string; fingerprint: string };
  deployment?: {
    deploymentId: string;
    status: string;
    logPath: string | "unavailable";
    serverId: string | "unavailable";
  };
  probe?: SanitizedProbeOutcome;
  cleanup?: {
    before: "pending";
    after?: "complete";
    beforeSnapshot: { temporarySchedulePresent: boolean | "unavailable"; sisenseScheduleFingerprint: string };
    afterSnapshot?: { temporarySchedulePresent: boolean | "unavailable"; sisenseScheduleFingerprint: string };
  };
  outcome?: string;
};

type SanitizedProbeOutcome =
  | { kind: "valid_marker"; terminal: "done" | "error"; summary: DiagnosticSummary }
  | { kind: "valid_failure_marker"; terminal: "done" | "error"; failure: DiagnosticFailure }
  | { kind: "valid_transport_proof"; terminal: "done" | "error"; proof: TransportProof }
  | { kind: "log_without_marker"; terminal: "done" | "error"; code: string }
  | { kind: "retrieval_unavailable"; code: string };

export class FileAttemptLedger {
  constructor(private readonly filePath: string) {}

  async load(): Promise<PersistedAttempt | null> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as PersistedAttempt;
    } catch (error: unknown) {
      if (isMissingFile(error)) return null;
      throw error;
    }
  }

  async save(attempt: PersistedAttempt): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(attempt, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, this.filePath);
    await chmod(this.filePath, 0o600);
  }
}

export interface AttemptLedger {
  load(): Promise<PersistedAttempt | null>;
  save(attempt: PersistedAttempt): Promise<void>;
}

export type ControllerInput = {
  attemptId: string;
  ledger: AttemptLedger;
  composeId: string;
  appName: string;
  serviceName: string;
  expectedRevision: string;
  artistName?: string;
  trackTitle?: string;
  dailyScheduleId: string;
  temporarySchedulePrefix: string;
  pollLimit: number;
  pollIntervalMilliseconds?: number;
  mode?: DiagnosticMode;
};

export type DiagnosticResult = {
  ok: boolean;
  phaseASuccess: boolean;
  transportProofSuccess: boolean;
  manualInvocationCount: number;
  code?: string;
  temporaryScheduleAbsent?: boolean;
  cleanupDeferred?: boolean;
};

export async function runControlledSisenseDiagnostic(
  input: ControllerInput,
  adapter: ControllerAdapter,
): Promise<DiagnosticResult> {
  let existing: PersistedAttempt | null;
  try {
    existing = await input.ledger.load();
  } catch {
    return result(noSuccess(), "ledger_read_failed", 0);
  }
  if (existing) {
    const code = existing.state === "complete" ? "attempt_already_complete" : "unresolved_previous_attempt";
    return result(noSuccess(), code, existing.manualInvocationCount, { cleanupDeferred: existing.state !== "complete" });
  }
  if (!isRevision(input.expectedRevision)) return result(noSuccess(), "expected_revision_invalid", 0);

  const mode = input.mode ?? "diagnostic";
  if (mode === "diagnostic" && (!isScopeLabel(input.artistName) || !isScopeLabel(input.trackTitle))) {
    return result(noSuccess(), "diagnostic_scope_invalid", 0);
  }

  let schedulesBefore: ScheduleRecord[];
  try {
    schedulesBefore = await adapter.listSchedules();
  } catch {
    return result(noSuccess(), "schedule_inventory_failed", 0);
  }
  const dailyBefore = schedulesBefore.find((schedule) => schedule.scheduleId === input.dailyScheduleId);
  if (!dailyBefore) return result(noSuccess(), "daily_scheduler_missing", 0);
  if (dailyBefore.name !== "Daily validation scheduler" || dailyBefore.enabled !== true) {
    return result(noSuccess(), "daily_scheduler_invalid", 0);
  }

  const preexistingSisenseSchedules = findSisenseSchedules(schedulesBefore, input);
  if (preexistingSisenseSchedules.length > 0) {
    return result(noSuccess(), "preexisting_sisense_schedule", 0, { cleanupDeferred: false });
  }

  const scheduleRequest = createTemporaryRequest(input);

  const attempt: PersistedAttempt = {
    version: 1,
    attemptId: input.attemptId,
    state: "preflight_complete",
    manualInvocationCount: 0,
    mode,
    preflight: {
      dailyFingerprint: fingerprintSchedule(dailyBefore),
      scheduleInventoryFingerprint: fingerprintInventory(schedulesBefore),
      sisenseScheduleFingerprint: fingerprintInventory(preexistingSisenseSchedules),
      deploymentHistoryFingerprint: "",
    },
    scheduleRequest: {
      name: scheduleRequest.name,
      fingerprint: fingerprintScheduleRequest(scheduleRequest),
    },
  };
  let persistenceFailed = false;
  const persist = async (): Promise<boolean> => {
    try {
      await input.ledger.save(attempt);
      return true;
    } catch {
      persistenceFailed = true;
      return false;
    }
  };
  if (!(await persist())) return result(noSuccess(), "ledger_persist_failed", 0);

  let temporary: ScheduleRecord;
  try {
    temporary = await adapter.createDisabledSchedule(scheduleRequest);
  } catch {
    attempt.state = "unresolved";
    attempt.outcome = "schedule_create_failed";
    await persist();
    return result(noSuccess(), "schedule_create_failed", 0, { cleanupDeferred: true });
  }
  if (!temporary.scheduleId) {
    attempt.state = "unresolved";
    attempt.outcome = "schedule_create_invalid";
    await persist();
    return result(noSuccess(), "schedule_create_invalid", 0, { cleanupDeferred: true });
  }
  attempt.schedule = { scheduleId: temporary.scheduleId, fingerprint: fingerprintSchedule(temporary) };
  attempt.state = "schedule_created";
  if (!(await persist())) {
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "ledger_persist_failed", persist, persistenceFailed);
  }

  let readback: ScheduleRecord | null;
  try {
    readback = await adapter.readSchedule(temporary.scheduleId);
  } catch {
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "schedule_readback_failed", persist, persistenceFailed);
  }
  if (!readback || !matchesRequestedSchedule(readback, scheduleRequest)) {
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "schedule_readback_mismatch", persist, persistenceFailed);
  }

  let deploymentsBefore: DeploymentRecord[];
  try {
    deploymentsBefore = await adapter.listDeployments(temporary.scheduleId);
  } catch {
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "deployment_history_snapshot_failed", persist, persistenceFailed);
  }
  if (!attempt.preflight) throw new Error("Preflight snapshot is required before manual invocation.");
  attempt.preflight.deploymentHistoryFingerprint = fingerprintDeploymentInventory(deploymentsBefore);
  attempt.state = "manual_invocation_committed";
  attempt.manualInvocationCount = 1;
  if (!(await persist())) {
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "ledger_persist_failed", persist, persistenceFailed);
  }

  try {
    await adapter.runManual(temporary.scheduleId);
  } catch {
    // A client throw may still have reached Dokploy. Reconciliation is mandatory.
  }
  attempt.state = "reconciling_deployment";
  await persist();

  let reconciliation: Awaited<ReturnType<typeof reconcileDeployment>>;
  try {
    reconciliation = await reconcileDeployment(input, adapter, temporary.scheduleId, deploymentsBefore);
  } catch {
    attempt.state = "unresolved";
    attempt.outcome = "deployment_reconciliation_failed";
    await persist();
    return result(noSuccess(), "deployment_reconciliation_failed", 1, { cleanupDeferred: true });
  }
  if (reconciliation.kind === "unknown") {
    attempt.state = "unresolved";
    attempt.outcome = reconciliation.code;
    await persist();
    return result(noSuccess(), reconciliation.code, 1, { cleanupDeferred: true });
  }

  const deployment = reconciliation.deployment;
  attempt.deployment = {
    deploymentId: deployment.deploymentId,
    status: deployment.status,
    logPath: deployment.logPath ?? "unavailable",
    serverId: deployment.serverId ?? "unavailable",
  };
  attempt.state = "deployment_terminal";
  await persist();

  if (!deployment.logPath) {
    attempt.probe = { kind: "retrieval_unavailable", code: "deployment_log_invalid" };
    attempt.state = "probe_recorded";
    if (!(await persist())) {
      return result(noSuccess(), "ledger_persist_failed", attempt.manualInvocationCount, { cleanupDeferred: true });
    }
    return cleanupTerminal(input, adapter, attempt, noSuccess(), "deployment_metadata_invalid", persist, persistenceFailed);
  }

  let probe: ProbeOutcome;
  try {
    probe = await adapter.probeDeploymentLog({
      deploymentId: deployment.deploymentId,
      logPath: deployment.logPath,
      ...(deployment.serverId ? { serverId: deployment.serverId } : {}),
    }, mode);
  } catch {
    probe = { kind: "retrieval_unavailable", code: "deployment_log_connection" };
  }
  const sanitizedProbe = sanitizeProbeOutcome(probe);
  attempt.probe = sanitizedProbe;
  attempt.state = "probe_recorded";
  if (!(await persist())) {
    return result(noSuccess(), "ledger_persist_failed", attempt.manualInvocationCount, { cleanupDeferred: true });
  }

  const evidence = assessEvidence(sanitizedProbe, deployment.status, mode, input);
  return cleanupTerminal(input, adapter, attempt, evidence.success, evidence.code, persist, persistenceFailed);
}

async function reconcileDeployment(
  input: ControllerInput,
  adapter: ControllerAdapter,
  scheduleId: string,
  deploymentsBefore: DeploymentRecord[],
): Promise<{ kind: "terminal"; deployment: DeploymentRecord } | { kind: "unknown"; code: string }> {
  const beforeIds = new Set(deploymentsBefore.map((deployment) => deployment.deploymentId));
  let deployments = await adapter.listDeployments(scheduleId);

  for (let poll = 0; ; poll += 1) {
    const candidates = deployments.filter((deployment) => !beforeIds.has(deployment.deploymentId));
    if (candidates.length > 1) return { kind: "unknown", code: "deployment_ambiguous" };

    const deployment = candidates[0];
    if (deployment && isTerminalStatus(deployment.status)) return { kind: "terminal", deployment };
    if (poll >= input.pollLimit) {
      return {
        kind: "unknown",
        code: deployment ? "terminal_status_unknown" : "deployment_ambiguous",
      };
    }

    await adapter.pause(input.pollIntervalMilliseconds ?? 10_000);
    deployments = await adapter.listDeployments(scheduleId);
  }
}

async function cleanupTerminal(
  input: ControllerInput,
  adapter: ControllerAdapter,
  attempt: PersistedAttempt,
  success: ExecutionSuccess,
  code: string | undefined,
  persist: () => Promise<boolean>,
  persistenceFailed: boolean,
): Promise<DiagnosticResult> {
  const temporaryId = attempt.schedule?.scheduleId;
  if (!temporaryId || !attempt.preflight) {
    throw new Error("Terminal cleanup requires a created schedule and preflight snapshot.");
  }

  let schedulesBeforeCleanup: ScheduleRecord[] | null = null;
  try {
    schedulesBeforeCleanup = await adapter.listSchedules();
  } catch { /* Delete is still safe because the schedule/deployment is known terminal. */ }
  attempt.cleanup = {
    before: "pending",
    beforeSnapshot: {
      temporarySchedulePresent: schedulesBeforeCleanup
        ? schedulesBeforeCleanup.some((schedule) => schedule.scheduleId === temporaryId)
        : "unavailable",
      sisenseScheduleFingerprint: schedulesBeforeCleanup
        ? fingerprintInventory(findSisenseSchedules(schedulesBeforeCleanup, input))
        : "unavailable",
    },
  };
  attempt.state = "cleanup_pending";
  const cleanupPendingPersisted = await persist();

  let schedulesAfterCleanup: ScheduleRecord[];
  try {
    await adapter.deleteSchedule(temporaryId);
    schedulesAfterCleanup = await adapter.listSchedules();
  } catch {
    attempt.state = "cleanup_failed";
    attempt.outcome = "cleanup_failed";
    await persist();
    return result(noSuccess(), "cleanup_failed", attempt.manualInvocationCount, { cleanupDeferred: true });
  }
  const dailyAfter = schedulesAfterCleanup.find((schedule) => schedule.scheduleId === input.dailyScheduleId);
  const remainingSisenseSchedules = findSisenseSchedules(schedulesAfterCleanup, input);
  const temporaryScheduleAbsent = !schedulesAfterCleanup.some((schedule) => schedule.scheduleId === temporaryId);

  attempt.cleanup.after = "complete";
  attempt.cleanup.afterSnapshot = {
    temporarySchedulePresent: !temporaryScheduleAbsent,
    sisenseScheduleFingerprint: fingerprintInventory(remainingSisenseSchedules),
  };
  let finalSuccess = success;
  let finalCode = code;
  if (!dailyAfter || fingerprintSchedule(dailyAfter) !== attempt.preflight.dailyFingerprint) {
    finalSuccess = noSuccess();
    finalCode = "daily_scheduler_changed";
  } else if (!temporaryScheduleAbsent || remainingSisenseSchedules.length > 0) {
    finalSuccess = noSuccess();
    finalCode = "sisense_schedule_remaining";
  } else if (fingerprintInventory(schedulesAfterCleanup) !== attempt.preflight.scheduleInventoryFingerprint) {
    finalSuccess = noSuccess();
    finalCode = "schedule_inventory_changed";
  }
  attempt.state = "complete";
  attempt.outcome = finalCode;
  const cleanupCompletePersisted = await persist();

  if (persistenceFailed || !cleanupPendingPersisted || !cleanupCompletePersisted) {
    return result(noSuccess(), "ledger_persist_failed", attempt.manualInvocationCount, { temporaryScheduleAbsent });
  }

  return result(
    finalSuccess,
    finalSuccess.phaseASuccess || finalSuccess.transportProofSuccess ? undefined : finalCode,
    attempt.manualInvocationCount,
    { temporaryScheduleAbsent },
  );
}

function createTemporaryRequest(input: ControllerInput): CreateScheduleRequest {
  const mode = input.mode ?? "diagnostic";
  return {
    name: `${input.temporarySchedulePrefix}${input.attemptId}`,
    enabled: false,
    scheduleType: "compose",
    composeId: input.composeId,
    appName: input.appName,
    serviceName: input.serviceName,
    shellType: "sh",
    timezone: "UTC",
    command: mode === "transport-proof"
      ? transportProofCommand(input.expectedRevision)
      : `node -e "const fs=require('node:fs');process.exit(fs.readFileSync('/app/.release-revision','utf8').trim()==='${input.expectedRevision}'?0:1)" && npm run sisense:scrape -- --date-range \"7 Days\" --aggregation Daily --artist-name ${shellQuote(input.artistName!)} --track-title ${shellQuote(input.trackTitle!)}`,
    cronExpression: "0 0 1 1 *",
    description: mode === "transport-proof"
      ? "One-attempt Label Suite transport proof"
      : "One-attempt Sisense seven-day diagnostic",
  };
}

function matchesRequestedSchedule(schedule: ScheduleRecord, request: CreateScheduleRequest): boolean {
  return (
    schedule.name === request.name &&
    schedule.enabled === false &&
    schedule.scheduleType === request.scheduleType &&
    schedule.composeId === request.composeId &&
    schedule.appName === request.appName &&
    schedule.serviceName === request.serviceName &&
    schedule.shellType === request.shellType &&
    schedule.timezone === request.timezone &&
    schedule.command === request.command &&
    schedule.cronExpression === request.cronExpression &&
    schedule.description === request.description
  );
}

function findSisenseSchedules(schedules: ScheduleRecord[], input: ControllerInput): ScheduleRecord[] {
  return schedules.filter(
    (schedule) => schedule.serviceName === input.serviceName || schedule.name.startsWith(input.temporarySchedulePrefix),
  );
}

function isTerminalStatus(status: string): boolean {
  return status === "done" || status === "error" || status === "failed" || status === "success";
}

function assessEvidence(
  probe: SanitizedProbeOutcome,
  deploymentStatus: string,
  mode: DiagnosticMode,
  input: ControllerInput,
): { success: ExecutionSuccess; code?: string } {
  if (probe.kind === "retrieval_unavailable") return { success: noSuccess(), code: probe.code };
  if (probe.kind === "log_without_marker") return { success: noSuccess(), code: probe.code };
  if (probe.kind === "valid_failure_marker") return { success: noSuccess(), code: probe.failure.code };
  if (deploymentStatus !== "done") return { success: noSuccess(), code: "terminal_status_not_done" };
  if (probe.terminal !== "done") return { success: noSuccess(), code: "terminal_command_error" };

  if (mode === "transport-proof") {
    if (probe.kind !== "valid_transport_proof") return { success: noSuccess(), code: "transport_proof_marker_schema" };
    if (
      probe.proof.expectedRevision !== input.expectedRevision ||
      probe.proof.observedRevision !== input.expectedRevision
    ) {
      return { success: noSuccess(), code: "transport_proof_revision_mismatch" };
    }
    return { success: { phaseASuccess: false, transportProofSuccess: true } };
  }

  if (probe.kind !== "valid_marker") return { success: noSuccess(), code: "diagnostic_marker_schema" };
  if (
    probe.summary.providerFilterState.artist !== input.artistName ||
    probe.summary.providerFilterState.track !== input.trackTitle
  ) {
    return { success: noSuccess(), code: "diagnostic_scope_mismatch" };
  }
  return isPhaseASuccess(probe.summary)
    ? { success: { phaseASuccess: true, transportProofSuccess: false } }
    : { success: noSuccess(), code: "phase_a_result_gate_failed" };
}

function isPhaseASuccess(summary: DiagnosticSummary): boolean {
  const effective = new Set(summary.effectiveWidgetKeys);
  const downloaded = new Set(summary.downloadedWidgetKeys);
  const observedEmpty = new Set(summary.observedEmptyWidgets.map((widget) => widget.key));
  const files = new Set(summary.files.map((file) => file.widgetKey));
  const hasNoDuplicates =
    effective.size === summary.effectiveWidgetKeys.length &&
    downloaded.size === summary.downloadedWidgetKeys.length &&
    observedEmpty.size === summary.observedEmptyWidgets.length &&
    files.size === summary.files.length;
  const coverageMatches =
    [...downloaded, ...observedEmpty].length === effective.size &&
    [...downloaded, ...observedEmpty].every((key) => effective.has(key)) &&
    [...downloaded].every((key) => !observedEmpty.has(key));
  return (
    summary.mode === "scrape" &&
    summary.requestedDateRange === "7 Days" &&
    summary.requestedAggregation === "Daily" &&
    summary.providerFilterState.dateRange === "7 Days" &&
    summary.providerFilterState.aggregation === "Daily" &&
    summary.databaseLockHeld === true &&
    summary.effectiveWidgetKeys.length > 0 &&
    hasNoDuplicates &&
    coverageMatches &&
    summary.effectiveWidgetCount === summary.effectiveWidgetKeys.length &&
    summary.skippedWidgets.length === 0 &&
    summary.completenessState === "complete" &&
    summary.fileCount === summary.files.length &&
    summary.files.length === summary.downloadedWidgetKeys.length &&
    [...files].every((key) => downloaded.has(key)) &&
    summary.files.reduce((total, file) => total + file.rowCount, 0) > 0
  );
}

function sanitizeProbeOutcome(probe: ProbeOutcome): SanitizedProbeOutcome {
  if (probe.kind === "valid_marker" || probe.kind === "valid_transport_proof") return probe;
  if (probe.kind === "valid_failure_marker") {
    const failure = probe.failure;
    if (
      (probe.terminal !== "done" && probe.terminal !== "error") ||
      !isDiagnosticFailure(failure)
    ) {
      return { kind: "log_without_marker", terminal: "error", code: "diagnostic_failure_marker_schema" };
    }
    return {
      kind: "valid_failure_marker",
      terminal: probe.terminal,
      failure: { version: 1, code: failure.code },
    };
  }
  if (probe.kind === "log_without_marker") return { kind: probe.kind, terminal: probe.terminal, code: probe.code };
  return { kind: probe.kind, code: probe.code };
}

function isDiagnosticFailure(value: unknown): value is DiagnosticFailure {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isDiagnosticFailureCode(value.code)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function result(
  success: ExecutionSuccess,
  code: string | undefined,
  manualInvocationCount: number,
  extra: Omit<DiagnosticResult, "ok" | "phaseASuccess" | "transportProofSuccess" | "code" | "manualInvocationCount"> = {},
): DiagnosticResult {
  return {
    ok: success.phaseASuccess || success.transportProofSuccess,
    ...success,
    ...(code ? { code } : {}),
    manualInvocationCount,
    ...extra,
  };
}

type ExecutionSuccess = Pick<DiagnosticResult, "phaseASuccess" | "transportProofSuccess">;

function noSuccess(): ExecutionSuccess {
  return { phaseASuccess: false, transportProofSuccess: false };
}

function transportProofCommand(expectedRevision: string): string {
  return `node -e 'const fs=require("node:fs");const expected="${expectedRevision}";const rawRevision=fs.readFileSync("/app/.release-revision","utf8").trim();const observedRevision=/^[a-f0-9]{40}$/.test(rawRevision)?rawRevision:"invalid";process.stdout.write("LABEL_SUITE_TRANSPORT_PROOF "+JSON.stringify({version:1,expectedRevision:expected,observedRevision})+"\\n");if(rawRevision!==expected){process.exitCode=1}'`;
}

function isRevision(value: string): boolean {
  return /^[a-f0-9]{40}$/.test(value);
}

function isScopeLabel(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\0\r\n]/.test(value);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function fingerprintSchedule(schedule: ScheduleRecord): string {
  return fingerprint({
    scheduleId: schedule.scheduleId,
    name: schedule.name,
    enabled: schedule.enabled,
    scheduleType: schedule.scheduleType,
    composeId: schedule.composeId,
    appName: schedule.appName,
    serviceName: schedule.serviceName,
    shellType: schedule.shellType,
    timezone: schedule.timezone,
    commandSha256: createHash("sha256").update(schedule.command).digest("hex"),
    cronExpression: schedule.cronExpression ?? null,
    description: schedule.description ?? null,
  });
}

function fingerprintScheduleRequest(schedule: CreateScheduleRequest): string {
  return fingerprint({
    name: schedule.name,
    enabled: schedule.enabled,
    scheduleType: schedule.scheduleType,
    composeId: schedule.composeId,
    appName: schedule.appName,
    serviceName: schedule.serviceName,
    shellType: schedule.shellType,
    timezone: schedule.timezone,
    commandSha256: createHash("sha256").update(schedule.command).digest("hex"),
    cronExpression: schedule.cronExpression ?? null,
    description: schedule.description ?? null,
  });
}

function fingerprintInventory(schedules: ScheduleRecord[]): string {
  return fingerprint(schedules.map((schedule) => fingerprintSchedule(schedule)).sort());
}

function fingerprintDeploymentInventory(deployments: DeploymentRecord[]): string {
  return fingerprint(
    deployments
      .map((deployment) => ({ deploymentId: deployment.deploymentId, status: deployment.status }))
      .sort((left, right) => left.deploymentId.localeCompare(right.deploymentId)),
  );
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
