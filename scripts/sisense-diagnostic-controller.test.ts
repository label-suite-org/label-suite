import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FileAttemptLedger,
  runControlledSisenseDiagnostic,
  type ControllerAdapter,
  type CreateScheduleRequest,
  type DiagnosticSummary,
  type PersistedAttempt,
  type ScheduleRecord,
} from "./sisense-diagnostic-controller";

const daily: ScheduleRecord = {
  scheduleId: "daily-1",
  name: "Daily validation scheduler",
  enabled: true,
  scheduleType: "compose",
  composeId: "compose-1",
  appName: "label-suite",
  serviceName: "label-suite-scheduler",
  shellType: "sh",
  timezone: "UTC",
  command: "npm run jobs:schedule",
};

function completeSummary(overrides: Partial<DiagnosticSummary> = {}): DiagnosticSummary {
  return {
    version: 1,
    runId: "sisense_20260803120000_1234abcd",
    mode: "scrape",
    requestedDateRange: "7 Days",
    requestedAggregation: "Daily",
    observedAt: "2026-08-03T12:00:00.000Z",
    providerFilterState: { artist: "True Blue", aggregation: "Daily", dateRange: "7 Days", track: "Fountain" },
    databaseLockHeld: true,
    effectiveWidgetKeys: ["apple-streams-source", "tracks-by-growth-rate"],
    effectiveWidgetCount: 2,
    downloadedWidgetKeys: ["apple-streams-source", "tracks-by-growth-rate"],
    observedEmptyWidgets: [],
    skippedWidgets: [],
    completenessState: "complete",
    fileCount: 2,
    files: [
      { widgetKey: "apple-streams-source", rowCount: 7, sha256: "a".repeat(64) },
      { widgetKey: "tracks-by-growth-rate", rowCount: 19, sha256: "b".repeat(64) },
    ],
    ...overrides,
  };
}

function diagnosticInput(ledgerPath: string, mode?: "diagnostic" | "transport-proof") {
  return {
    attemptId: "issue-82-attempt-1",
    ledger: new FileAttemptLedger(ledgerPath),
    composeId: "compose-1",
    appName: "label-suite",
    serviceName: "label-suite-sisense-sync",
    expectedRevision: "a".repeat(40),
    artistName: "True Blue",
    trackTitle: "Fountain",
    dailyScheduleId: daily.scheduleId,
    temporarySchedulePrefix: "issue-82-sisense-7d-diagnostic-",
    pollLimit: 2,
    ...(mode ? { mode } : {}),
  };
}

function fakeAdapter(input: {
  manualOutcome?: ControllerAdapter["runManual"] extends (...args: never[]) => Promise<infer Result> ? Result : never;
  deployments?: ControllerAdapter["listDeployments"] extends (...args: never[]) => Promise<infer Result> ? Result : never;
  deploymentSequence?: Array<ControllerAdapter["listDeployments"] extends (...args: never[]) => Promise<infer Result> ? Result : never>;
  probe?: ControllerAdapter["probeDeploymentLog"] extends (...args: never[]) => Promise<infer Result> ? Result : never;
  manualThrows?: boolean;
  createThrows?: boolean;
  beforeDaily?: ScheduleRecord;
  beforeSchedules?: ScheduleRecord[];
  afterDaily?: ScheduleRecord;
  afterSchedules?: ScheduleRecord[];
  readbackTimezone?: ScheduleRecord["timezone"];
  leaveTemporarySchedule?: boolean;
  deleteThrows?: boolean;
} = {}) {
  let temporary: ScheduleRecord = {
    scheduleId: "temporary-1",
    name: "issue-82-sisense-7d-diagnostic-20260803",
    enabled: false,
    scheduleType: "compose",
    composeId: "compose-1",
    appName: "label-suite",
    serviceName: "label-suite-sisense-sync",
    shellType: "sh",
    timezone: "UTC",
    command: "revision-check && npm run sisense:scrape -- --date-range 7 Days --aggregation Daily",
  };
  let schedules = [input.beforeDaily ?? daily, ...(input.beforeSchedules ?? [])];
  let deployments = input.deployments ?? [{
    deploymentId: "deployment-1",
    status: "done" as const,
    logPath: "/etc/dokploy/schedules/deployment-1.log",
    serverId: "server-1",
  }];
  const calls = { create: 0, manual: 0, history: 0, probe: 0, delete: 0, pause: 0 };
  let createdRequest: CreateScheduleRequest | null = null;
  const adapter: ControllerAdapter = {
    async listSchedules() {
      return schedules.map((schedule) => ({ ...schedule }));
    },
    async createDisabledSchedule(request) {
      calls.create += 1;
      if (input.createThrows) throw new Error("response lost after create");
      expect(request).toMatchObject({ enabled: false, composeId: "compose-1", serviceName: "label-suite-sisense-sync" });
      createdRequest = { ...request };
      temporary = { scheduleId: temporary.scheduleId, ...request };
      schedules = [...schedules, temporary];
      return { ...temporary };
    },
    async readSchedule() {
      return {
        ...temporary,
        ...(input.readbackTimezone === undefined ? {} : { timezone: input.readbackTimezone }),
      };
    },
    async listDeployments() {
      calls.history += 1;
      if (calls.history === 1) return [];
      const sequenceIndex = calls.history - 2;
      const selected = input.deploymentSequence
        ? input.deploymentSequence[Math.min(sequenceIndex, input.deploymentSequence.length - 1)]
        : deployments;
      return (selected ?? []).map((deployment) => ({ ...deployment }));
    },
    async runManual() {
      calls.manual += 1;
      if (input.manualThrows) throw new Error("transport failed after dispatch");
      return input.manualOutcome ?? { kind: "nonzero", code: "trpc_transport_error" };
    },
    async probeDeploymentLog() {
      calls.probe += 1;
      return input.probe ?? { kind: "valid_marker", terminal: "done", summary: completeSummary() };
    },
    async deleteSchedule() {
      calls.delete += 1;
      if (input.deleteThrows) throw new Error("delete unavailable");
      if (!input.leaveTemporarySchedule) schedules = [input.afterDaily ?? daily, ...(input.afterSchedules ?? [])];
    },
    async pause() {
      calls.pause += 1;
      return undefined;
    },
  };
  return {
    adapter,
    calls,
    createdRequest: () => createdRequest,
    setDeployments: (next: typeof deployments) => { deployments = next; },
    setAfterDaily: () => { schedules = [input.afterDaily ?? daily]; },
  };
}

describe("controlled Sisense diagnostic controller", () => {
  it("persists an allowlisted runner failure code before terminal cleanup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_failure_marker",
        terminal: "error",
        failure: { version: 1, code: "provider_filters" },
      },
    });
    let persistedBeforeDelete: unknown;
    const adapter: ControllerAdapter = {
      ...fixture.adapter,
      async deleteSchedule(scheduleId) {
        persistedBeforeDelete = JSON.parse(await readFile(ledgerPath, "utf8"));
        await fixture.adapter.deleteSchedule(scheduleId);
      },
    };

    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), adapter);

      expect(result).toMatchObject({
        ok: false,
        phaseASuccess: false,
        transportProofSuccess: false,
        code: "provider_filters",
        manualInvocationCount: 1,
        temporaryScheduleAbsent: true,
      });
      expect(persistedBeforeDelete).toMatchObject({
        state: "cleanup_pending",
        probe: {
          kind: "valid_failure_marker",
          terminal: "error",
          failure: { version: 1, code: "provider_filters" },
        },
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed and strips a forged adapter failure marker before cleanup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_failure_marker",
        terminal: "error",
        failure: {
          version: 1,
          code: "provider_password_hunter2",
          secret: "hunter2",
          url: "https://example.invalid/private",
        },
        providerText: "This provider response must never reach the ledger.",
      } as unknown as Awaited<ReturnType<ControllerAdapter["probeDeploymentLog"]>>,
    });

    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = await readFile(ledgerPath, "utf8");

      expect(result).toMatchObject({
        ok: false,
        code: "diagnostic_failure_marker_schema",
        manualInvocationCount: 1,
        temporaryScheduleAbsent: true,
      });
      expect(JSON.parse(persisted)).toMatchObject({
        probe: {
          kind: "log_without_marker",
          terminal: "error",
          code: "diagnostic_failure_marker_schema",
        },
      });
      expect(persisted).not.toContain("hunter2");
      expect(persisted).not.toContain("example.invalid");
      expect(persisted).not.toContain("provider response");
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["missing", {}],
    ["null", { failure: null }],
    ["array", { failure: [] }],
    ["string primitive", { failure: "provider_filters" }],
    ["number primitive", { failure: 1 }],
    ["wrong-version record", { failure: { version: 2, code: "provider_filters" } }],
    ["wrong-code-type record", { failure: { version: 1, code: null } }],
  ])("fails closed for a forged %s nested failure shape", async (_shape, marker) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_failure_marker",
        terminal: "error",
        ...marker,
      } as unknown as Awaited<ReturnType<ControllerAdapter["probeDeploymentLog"]>>,
    });

    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));

      expect(result).toMatchObject({
        ok: false,
        code: "diagnostic_failure_marker_schema",
        manualInvocationCount: 1,
        temporaryScheduleAbsent: true,
      });
      expect(persisted).toMatchObject({
        probe: {
          kind: "log_without_marker",
          terminal: "error",
          code: "diagnostic_failure_marker_schema",
        },
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains the schedule when a terminal failure marker cannot be persisted", async () => {
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_failure_marker",
        terminal: "error",
        failure: { version: 1, code: "provider_filters" },
      },
    });
    const ledger = {
      async load(): Promise<PersistedAttempt | null> { return null; },
      async save(attempt: PersistedAttempt): Promise<void> {
        if (attempt.state === "probe_recorded") throw new Error("disk full");
      },
    };

    const result = await runControlledSisenseDiagnostic(
      { ...diagnosticInput("/unused/attempt.json"), ledger },
      fixture.adapter,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "ledger_persist_failed",
      manualInvocationCount: 1,
      cleanupDeferred: true,
    });
    expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 0 });
  });

  it("accepts and preserves a null timezone in the Daily scheduler inventory fingerprint", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const observedDaily = { ...daily, timezone: null };
    const fixture = fakeAdapter({ beforeDaily: observedDaily, afterDaily: observedDaily });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);

      expect(result).toMatchObject({ ok: true, phaseASuccess: true, temporaryScheduleAbsent: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats a null-to-UTC Daily scheduler timezone change as a fingerprint change", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ beforeDaily: { ...daily, timezone: null }, afterDaily: daily });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);

      expect(result).toMatchObject({ ok: false, code: "daily_scheduler_changed", temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ create: 1, manual: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires an exact UTC timezone on temporary schedule readback", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ readbackTimezone: null });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);

      expect(fixture.createdRequest()?.timezone).toBe("UTC");
      expect(result).toMatchObject({ ok: false, code: "schedule_readback_mismatch", manualInvocationCount: 0, temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ create: 1, manual: 0, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the default diagnostic command on the Phase A scrape path", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter();
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);

      expect(result).toMatchObject({ ok: true, phaseASuccess: true, transportProofSuccess: false });
      expect(fixture.createdRequest()?.command).toContain("npm run sisense:scrape");
      expect(fixture.createdRequest()?.command).toContain("--artist-name 'True Blue' --track-title 'Fountain'");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("quotes provider scope as shell data and fails mismatched observed scope closed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_marker",
        terminal: "done",
        summary: completeSummary({
          providerFilterState: { artist: "Wrong Artist", aggregation: "Daily", dateRange: "7 Days", track: "Fountain" },
        }),
      },
    });
    try {
      const input = { ...diagnosticInput(ledgerPath), artistName: "True Blue'; echo injected; '" };
      const result = await runControlledSisenseDiagnostic(input, fixture.adapter);

      expect(fixture.createdRequest()?.command).toContain(`--artist-name 'True Blue'"'"'; echo injected; '"'"'' --track-title 'Fountain'`);
      expect(result).toMatchObject({ ok: false, code: "diagnostic_scope_mismatch", temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ manual: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports a successful transport proof without claiming Phase A", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_transport_proof",
        terminal: "done",
        proof: {
          version: 1,
          expectedRevision: "a".repeat(40),
          observedRevision: "a".repeat(40),
        },
      },
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath, "transport-proof"), fixture.adapter);

      expect(result).toMatchObject({
        ok: true,
        phaseASuccess: false,
        transportProofSuccess: true,
        manualInvocationCount: 1,
        temporaryScheduleAbsent: true,
      });
      expect(fixture.createdRequest()?.command).toContain("LABEL_SUITE_TRANSPORT_PROOF");
      expect(fixture.createdRequest()?.command).toContain("/app/.release-revision");
      expect(fixture.createdRequest()?.command).not.toMatch(/sisense:scrape|--apply|DATABASE_URL/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("probes an approved terminal log without server metadata and records transport proof only", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      deployments: [{
        deploymentId: "deployment-1",
        status: "done",
        logPath: "/etc/dokploy/schedules/deployment-1.log",
      }],
      probe: {
        kind: "valid_transport_proof",
        terminal: "done",
        proof: {
          version: 1,
          expectedRevision: "a".repeat(40),
          observedRevision: "a".repeat(40),
        },
      },
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath, "transport-proof"), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));

      expect(result).toMatchObject({
        ok: true,
        phaseASuccess: false,
        transportProofSuccess: true,
        temporaryScheduleAbsent: true,
      });
      expect(persisted).toMatchObject({
        deployment: {
          deploymentId: "deployment-1",
          status: "done",
          logPath: "/etc/dokploy/schedules/deployment-1.log",
          serverId: "unavailable",
        },
        probe: { kind: "valid_transport_proof" },
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed before probing when a terminal deployment has no usable log path", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      deployments: [{ deploymentId: "deployment-1", status: "done", serverId: "server-1" }],
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));

      expect(result).toMatchObject({
        ok: false,
        phaseASuccess: false,
        transportProofSuccess: false,
        code: "deployment_metadata_invalid",
        temporaryScheduleAbsent: true,
      });
      expect(persisted).toMatchObject({
        deployment: {
          deploymentId: "deployment-1",
          status: "done",
          logPath: "unavailable",
          serverId: "server-1",
        },
        probe: { kind: "retrieval_unavailable", code: "deployment_log_invalid" },
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 0, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails a revision-mismatched transport proof closed after terminal cleanup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_transport_proof",
        terminal: "done",
        proof: {
          version: 1,
          expectedRevision: "a".repeat(40),
          observedRevision: "b".repeat(40),
        },
      },
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath, "transport-proof"), fixture.adapter);

      expect(result).toMatchObject({
        ok: false,
        phaseASuccess: false,
        transportProofSuccess: false,
        code: "transport_proof_revision_mismatch",
        temporaryScheduleAbsent: true,
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("emits a bounded mismatched-revision marker before the generated command exits nonzero", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const revisionPath = path.join(directory, ".release-revision");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_transport_proof",
        terminal: "done",
        proof: {
          version: 1,
          expectedRevision: "a".repeat(40),
          observedRevision: "a".repeat(40),
        },
      },
    });
    try {
      await writeFile(revisionPath, `${"b".repeat(40)}\n`);
      await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath, "transport-proof"), fixture.adapter);
      const generatedCommand = fixture.createdRequest()?.command;
      expect(generatedCommand).toBeTruthy();

      const outcome = await runShellCommand(
        generatedCommand!.replace("/app/.release-revision", revisionPath),
      );

      expect(outcome.status).toBe(1);
      expect(outcome.output).toBe(
        `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({
          version: 1,
          expectedRevision: "a".repeat(40),
          observedRevision: "b".repeat(40),
        })}\n`,
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails missing transport proof evidence closed after terminal cleanup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "log_without_marker",
        terminal: "done",
        code: "transport_proof_marker_count",
      },
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath, "transport-proof"), fixture.adapter);

      expect(result).toMatchObject({
        ok: false,
        phaseASuccess: false,
        transportProofSuccess: false,
        code: "transport_proof_marker_count",
        temporaryScheduleAbsent: true,
      });
      expect(fixture.calls).toMatchObject({ manual: 1, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reconciles a terminal deployment after a manual transport error before cleanup", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter();
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));
      expect((await stat(ledgerPath)).mode & 0o777).toBe(0o600);

      expect(result).toMatchObject({ ok: true, phaseASuccess: true, manualInvocationCount: 1, temporaryScheduleAbsent: true });
      expect(persisted).toMatchObject({
        manualInvocationCount: 1,
        deployment: { deploymentId: "deployment-1", status: "done", logPath: "/etc/dokploy/schedules/deployment-1.log", serverId: "server-1" },
        probe: { kind: "valid_marker" },
        cleanup: { before: "pending", after: "complete" },
        preflight: {
          dailyFingerprint: expect.any(String),
          scheduleInventoryFingerprint: expect.any(String),
          sisenseScheduleFingerprint: expect.any(String),
          deploymentHistoryFingerprint: expect.any(String),
        },
      });
      expect(fixture.calls).toMatchObject({ create: 1, manual: 1, history: 2, probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to repeat an invocation committed before a controller crash", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter();
    try {
      await writeFile(ledgerPath, JSON.stringify({ version: 1, attemptId: "issue-82-attempt-1", state: "manual_invocation_committed", manualInvocationCount: 1 }) + "\n", { mode: 0o600 });
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);

      expect(result).toMatchObject({ ok: false, code: "unresolved_previous_attempt" });
      expect(fixture.calls).toMatchObject({ create: 0, manual: 0, delete: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reconciles after a manual client throw without issuing a second invocation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ manualThrows: true });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: true, manualInvocationCount: 1, temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ manual: 1, history: 2, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("deletes the disabled schedule when persistence fails before manual invocation", async () => {
    const fixture = fakeAdapter();
    let writes = 0;
    const failingLedger = {
      async load(): Promise<PersistedAttempt | null> { return null; },
      async save(): Promise<void> {
        writes += 1;
        if (writes === 2) throw new Error("disk full");
      },
    };
    const input = { ...diagnosticInput("/unused/attempt.json"), ledger: failingLedger };

    const result = await runControlledSisenseDiagnostic(input, fixture.adapter);

    expect(result).toMatchObject({ ok: false, code: "ledger_persist_failed", manualInvocationCount: 0, temporaryScheduleAbsent: true });
    expect(fixture.calls).toMatchObject({ create: 1, manual: 0, delete: 1 });
  });

  it("persists the deterministic schedule request before a create response can be lost", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ createThrows: true });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));
      expect(result).toMatchObject({ ok: false, code: "schedule_create_failed", cleanupDeferred: true });
      expect(persisted).toMatchObject({
        state: "unresolved",
        scheduleRequest: {
          name: "issue-82-sisense-7d-diagnostic-issue-82-attempt-1",
          fingerprint: expect.any(String),
        },
      });
      expect(fixture.calls).toMatchObject({ create: 1, manual: 0, delete: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["zero", []],
    ["multiple", [
      { deploymentId: "deployment-1", status: "done", logPath: "/etc/dokploy/schedules/one.log", serverId: "server-1" },
      { deploymentId: "deployment-2", status: "done", logPath: "/etc/dokploy/schedules/two.log", serverId: "server-1" },
    ]],
  ])("leaves the disabled schedule unresolved when reconciliation finds %s attributable deployments", async (_label, deployments) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ deployments });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "deployment_ambiguous", cleanupDeferred: true });
      expect(fixture.calls).toMatchObject({ manual: 1, delete: 0, probe: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not delete while the only attributable deployment remains nonterminal", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ deployments: [{ deploymentId: "deployment-1", status: "running", logPath: "/etc/dokploy/schedules/one.log", serverId: "server-1" }] });
    try {
      const result = await runControlledSisenseDiagnostic({ ...diagnosticInput(ledgerPath), pollLimit: 1 }, fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "terminal_status_unknown", cleanupDeferred: true });
      expect(fixture.calls).toMatchObject({ manual: 1, history: 3, pause: 1, delete: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("polls when the accepted deployment is not visible immediately", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      deploymentSequence: [[], [{
        deploymentId: "deployment-1",
        status: "done",
        logPath: "/etc/dokploy/schedules/deployment-1.log",
        serverId: "server-1",
      }]],
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: true, phaseASuccess: true, temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ manual: 1, history: 3, pause: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("cleans up after a terminal probe retrieval failure without treating Phase A as successful", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ probe: { kind: "retrieval_unavailable", code: "deployment_log_timeout" } });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "deployment_log_timeout", phaseASuccess: false, temporaryScheduleAbsent: true });
      expect(fixture.calls).toMatchObject({ probe: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("marks cleanup failure as deferred for manual recovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ deleteThrows: true });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "cleanup_failed", cleanupDeferred: true });
      expect(fixture.calls).toMatchObject({ manual: 1, delete: 1 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails the result gate for partial coverage even when terminal marker evidence is valid", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ probe: { kind: "valid_marker", terminal: "done", summary: completeSummary({ completenessState: "partial", skippedWidgets: [{ key: "apple-streams-source", reason: "No uniquely observable export action was available after opening the scoped widget menu." }] }) } });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "phase_a_result_gate_failed", phaseASuccess: false, temporaryScheduleAbsent: true });
      expect(fixture.calls.delete).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts complete accounting with an observed-empty widget and a positive total row count", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      probe: {
        kind: "valid_marker",
        terminal: "done",
        summary: completeSummary({
          downloadedWidgetKeys: ["apple-streams-source"],
          observedEmptyWidgets: [{ key: "tracks-by-growth-rate", reason: "Query returned no matching rows." }],
          fileCount: 1,
          files: [{ widgetKey: "apple-streams-source", rowCount: 7, sha256: "a".repeat(64) }],
        }),
      },
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: true, phaseASuccess: true, temporaryScheduleAbsent: true });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("records a post-cleanup failure when the Daily schedule fingerprint changes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ afterDaily: { ...daily, enabled: false } });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      const persisted = JSON.parse(await readFile(ledgerPath, "utf8"));
      expect(result).toMatchObject({ ok: false, code: "daily_scheduler_changed", temporaryScheduleAbsent: true });
      expect(persisted).toMatchObject({ state: "complete", outcome: "daily_scheduler_changed" });
      expect(fixture.calls.delete).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when any unrelated schedule changes during the attempt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      afterSchedules: [{
        ...daily,
        scheduleId: "unexpected-1",
        name: "Unexpected scheduler",
      }],
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "schedule_inventory_changed", temporaryScheduleAbsent: true });
      expect(fixture.calls.delete).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires the baseline Daily scheduler to be enabled and correctly named", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({ beforeDaily: { ...daily, enabled: false } });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({ ok: false, code: "daily_scheduler_invalid", manualInvocationCount: 0 });
      expect(fixture.calls).toMatchObject({ create: 0, manual: 0, delete: 0 });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("treats a preexisting Sisense schedule as a no-mutation preflight stop", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-sisense-controller-"));
    const ledgerPath = path.join(directory, "attempt.json");
    const fixture = fakeAdapter({
      beforeSchedules: [{
        ...daily,
        scheduleId: "preexisting-sisense",
        name: "Existing Sisense schedule",
        serviceName: "label-suite-sisense-sync",
      }],
    });
    try {
      const result = await runControlledSisenseDiagnostic(diagnosticInput(ledgerPath), fixture.adapter);
      expect(result).toMatchObject({
        ok: false,
        code: "preexisting_sisense_schedule",
        manualInvocationCount: 0,
        cleanupDeferred: false,
      });
      expect(fixture.calls).toMatchObject({ create: 0, manual: 0, delete: 0 });
      await expect(stat(ledgerPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("returns a safe preflight result when the ledger cannot be read", async () => {
    const fixture = fakeAdapter();
    const input = {
      ...diagnosticInput("/unused/attempt.json"),
      ledger: {
        async load(): Promise<PersistedAttempt | null> { throw new Error("unreadable"); },
        async save(): Promise<void> { throw new Error("must not write"); },
      },
    };
    const result = await runControlledSisenseDiagnostic(input, fixture.adapter);
    expect(result).toMatchObject({ ok: false, code: "ledger_read_failed", manualInvocationCount: 0 });
    expect(result.cleanupDeferred).not.toBe(true);
    expect(fixture.calls).toMatchObject({ create: 0, manual: 0, delete: 0 });
  });

  it("returns a safe preflight result when schedule inventory cannot be read", async () => {
    const fixture = fakeAdapter();
    const adapter: ControllerAdapter = {
      ...fixture.adapter,
      async listSchedules() { throw new Error("inventory unavailable"); },
    };
    const result = await runControlledSisenseDiagnostic(diagnosticInput("/unused/attempt.json"), adapter);
    expect(result).toMatchObject({ ok: false, code: "schedule_inventory_failed", manualInvocationCount: 0 });
    expect(result.cleanupDeferred).not.toBe(true);
    expect(fixture.calls).toMatchObject({ create: 0, manual: 0, delete: 0 });
  });
});

function runShellCommand(command: string): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}
