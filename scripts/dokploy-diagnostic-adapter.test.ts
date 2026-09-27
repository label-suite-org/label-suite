import { describe, expect, it } from "vitest";

import {
  createDokployDiagnosticAdapter,
  createDokployDiagnosticAdapterFromTransport,
  type DokployTransport,
} from "./dokploy-diagnostic-adapter";
import type { CreateScheduleRequest, DiagnosticSummary } from "./sisense-diagnostic-controller";

const schedule = {
  scheduleId: "schedule-1",
  name: "issue-82-sisense-7d-diagnostic-attempt-1",
  enabled: false,
  scheduleType: "compose",
  composeId: "compose-1",
  appName: "label-suite",
  serviceName: "label-suite-sisense-sync",
  shellType: "sh",
  timezone: "UTC" as const,
  command: "safe-command",
  cronExpression: "0 0 1 1 *",
  description: "One-attempt Sisense seven-day diagnostic",
};

const productionDailySchedule = {
  scheduleId: "daily-1",
  name: "Daily validation scheduler",
  enabled: true,
  scheduleType: "compose",
  composeId: "compose-1",
  appName: "label-suite",
  serviceName: "label-suite-scheduler",
  shellType: "sh",
  timezone: null,
  command: "npm run jobs:schedule",
  cronExpression: "0 0 * * *",
};

const summary: DiagnosticSummary = {
  version: 1,
  runId: "sisense_20260803120000_1234abcd",
  mode: "scrape",
  requestedDateRange: "7 Days",
  requestedAggregation: "Daily",
  observedAt: "2026-08-03T12:00:00.000Z",
  providerFilterState: { artist: "True Blue", dateRange: "7 Days", aggregation: "Daily", track: "Fountain" },
  databaseLockHeld: true,
  effectiveWidgetKeys: ["apple-streams-source"],
  effectiveWidgetCount: 1,
  downloadedWidgetKeys: ["apple-streams-source"],
  observedEmptyWidgets: [],
  skippedWidgets: [],
  completenessState: "complete",
  fileCount: 1,
  files: [{ widgetKey: "apple-streams-source", rowCount: 7, sha256: "a".repeat(64) }],
};

describe("Dokploy diagnostic adapter transport contract", () => {
  it("preserves a provider Daily scheduler with a null timezone in inventory", async () => {
    const transport = fakeTransport({ json: [[productionDailySchedule]] });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });

    await expect(adapter.listSchedules()).resolves.toEqual([productionDailySchedule]);
  });

  it.each([undefined, "", false, 0, {}, []])("rejects invalid schedule inventory timezones: %j", async (timezone) => {
    const transport = fakeTransport({ json: [[{ ...productionDailySchedule, timezone }]] });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });

    await expect(adapter.listSchedules()).rejects.toMatchObject({ code: "schedule_record_invalid" });
  });

  it("normalizes CLI JSON shapes and preserves deployment log metadata", async () => {
    const transport = fakeTransport({
      json: [
        [schedule],
        schedule,
        [{ deploymentId: "deployment-1", status: "done", logPath: "/etc/dokploy/schedules/deployment-1.log", serverId: "server-1" }],
        { status: "done", deploymentId: "deployment-1", logPath: "/etc/dokploy/schedules/deployment-1.log", serverId: "server-1" },
      ],
    });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });

    await expect(adapter.listSchedules()).resolves.toEqual([schedule]);
    await expect(adapter.readSchedule("schedule-1")).resolves.toEqual(schedule);
    await expect(adapter.listDeployments("schedule-1")).resolves.toEqual([{
      deploymentId: "deployment-1",
      status: "done",
      logPath: "/etc/dokploy/schedules/deployment-1.log",
      serverId: "server-1",
    }]);
    await expect(adapter.runManual("schedule-1")).resolves.toEqual({
      kind: "response",
      status: "done",
      deploymentId: "deployment-1",
      logPath: "/etc/dokploy/schedules/deployment-1.log",
      serverId: "server-1",
    });
  });

  it("posts enabled false, deletes by exact ID, and sanitizes probe evidence", async () => {
    const transport = fakeTransport({
      post: schedule,
      log: `SISENSE_DIAGNOSTIC_SUMMARY ${JSON.stringify({ ...summary, secret: "discard", files: [{ ...summary.files[0], path: "/raw/private.csv" }] })}\nCommand executed successfully\n`,
    });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });
    const request: CreateScheduleRequest = { ...schedule };
    delete (request as Partial<typeof schedule>).scheduleId;

    await expect(adapter.createDisabledSchedule(request)).resolves.toEqual(schedule);
    await adapter.deleteSchedule("schedule-1");
    const probe = await adapter.probeDeploymentLog({
      deploymentId: "deployment-1",
      logPath: "/etc/dokploy/schedules/deployment-1.log",
      serverId: "server-1",
    }, "diagnostic");

    expect(transport.posts).toEqual([{ endpoint: "schedule.create", body: expect.objectContaining({ enabled: false }) }]);
    expect(transport.commands).toEqual([["schedule", "delete", "--scheduleId", "schedule-1", "--json"]]);
    expect(probe).toEqual({ kind: "valid_marker", terminal: "done", summary });
  });

  it("classifies the bounded transport proof marker without retaining extra log fields", async () => {
    const transport = fakeTransport({
      log: `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({
        version: 1,
        expectedRevision: "a".repeat(40),
        observedRevision: "a".repeat(40),
        ignored: "discard",
      })}\nCommand executed successfully\n`,
    });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });

    await expect(adapter.probeDeploymentLog({
      deploymentId: "deployment-1",
      logPath: "/etc/dokploy/schedules/deployment-1.log",
      serverId: "server-1",
    }, "transport-proof")).resolves.toEqual({
      kind: "valid_transport_proof",
      terminal: "done",
      proof: {
        version: 1,
        expectedRevision: "a".repeat(40),
        observedRevision: "a".repeat(40),
      },
    });
  });

  it("probes an approved deployment log when the provider omits server metadata", async () => {
    const transport = fakeTransport({
      log: `LABEL_SUITE_TRANSPORT_PROOF ${JSON.stringify({
        version: 1,
        expectedRevision: "a".repeat(40),
        observedRevision: "a".repeat(40),
      })}\nCommand executed successfully\n`,
    });
    const adapter = createDokployDiagnosticAdapterFromTransport({ composeId: "compose-1", transport });

    await expect(adapter.probeDeploymentLog({
      deploymentId: "deployment-1",
      logPath: "/etc/dokploy/schedules/deployment-1.log",
    }, "transport-proof")).resolves.toEqual({
      kind: "valid_transport_proof",
      terminal: "done",
      proof: {
        version: 1,
        expectedRevision: "a".repeat(40),
        observedRevision: "a".repeat(40),
      },
    });
  });

  it.each([
    ["traversal", "/etc/dokploy/schedules/../secrets.log"],
    ["Windows-style backslash", "/etc/dokploy/schedules/..\\secrets.log"],
    ["NUL byte", "/etc/dokploy/schedules/deployment-1.log\0ignored"],
    ["unapproved directory", "/tmp/deployment-1.log"],
  ])("rejects an unapproved %s log path before opening a connection", async (_label, logPath) => {
    const adapter = createDokployDiagnosticAdapter({
      composeId: "compose-1",
      connection: { url: "not-a-valid-url", token: "unused" },
    });

    await expect(adapter.probeDeploymentLog({
      deploymentId: "deployment-1",
      logPath,
    }, "transport-proof")).resolves.toEqual({
      kind: "retrieval_unavailable",
      code: "deployment_log_invalid",
    });
  });
});

function fakeTransport(input: { json?: unknown[]; post?: unknown; log?: string }): DokployTransport & {
  posts: Array<{ endpoint: string; body: unknown }>;
  commands: string[][];
} {
  const json = [...(input.json ?? [])];
  const posts: Array<{ endpoint: string; body: unknown }> = [];
  const commands: string[][] = [];
  return {
    posts,
    commands,
    async json() { return json.shift(); },
    async post(endpoint, body) { posts.push({ endpoint, body }); return input.post; },
    async command(args) { commands.push(args); },
    async readDeploymentLog() { return { kind: "log", value: input.log ?? "" }; },
  };
}
