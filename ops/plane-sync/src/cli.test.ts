import { describe, expect, it } from "vitest";
import { parseCliArgs, runCli } from "./cli.js";
import type { SyncConfig } from "./types.js";

function config(): SyncConfig {
  return {
    repository: "label-suite-org/label-suite_neon_r2",
    writeMode: "dry-run",
    host: "127.0.0.1",
    port: 8787,
    bodyLimitBytes: 1_048_576,
    databasePath: ":memory:",
    reconcileIntervalMs: 60_000,
    envelopeRetentionMs: 86_400_000,
    githubAppId: "1",
    githubInstallationId: "2",
    githubPrivateKeyBase64: "not-used-by-cli",
    githubWebhookSecret: "not-used-by-cli",
    planeBaseUrl: new URL("https://plane.example.test"),
    planeApiToken: "not-used-by-cli",
    planeWorkspace: "workspace",
    planeProjectId: "9c9e4853-9b2b-4021-bbac-76a836d4b9d7",
    revisionFile: "/revision",
  };
}

describe("parseCliArgs", () => {
  it.each([
    [["bootstrap", "--dry-run"], { command: "bootstrap", apply: false }],
    [["bootstrap", "--apply"], { command: "bootstrap", apply: true }],
    [["reconcile", "--dry-run"], { command: "reconcile", apply: false }],
    [["reconcile", "--apply"], { command: "reconcile", apply: true }],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--reason", "mapping-reviewed", "--operator", "ops@example.test"], {
      command: "recover-failed",
      apply: true,
      deliveryIds: ["delivery-1"],
      reason: "mapping-reviewed",
      operator: "ops@example.test",
    }],
  ])("accepts only the explicit operator form %#", (args, expected) => {
    expect(parseCliArgs(args)).toEqual(expected);
  });

  it.each([
    [[]],
    [["bootstrap"]],
    [["reconcile"]],
    [["unknown", "--dry-run"]],
    [["bootstrap", "--write"]],
    [["bootstrap", "--dry-run", "extra"]],
    [["bootstrap", "--apply", "--dry-run"]],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--reason", "mapping-reviewed"]],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--operator", "ops@example.test"]],
    [["recover-failed", "--apply", "--reason", "mapping-reviewed", "--operator", "ops@example.test"]],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--delivery-id", "delivery-1", "--reason", "mapping-reviewed", "--operator", "ops@example.test"]],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--reason", "   ", "--operator", "ops@example.test"]],
    [["recover-failed", "--apply", "--delivery-id", "delivery-1", "--reason", "mapping-reviewed", "--operator", "   "]],
    [["recover-failed", "--apply", "--reason", "--operator", "--operator", "ops@example.test", "--delivery-id", "delivery-1"]],
  ])("rejects incomplete, unknown, and extra arguments %#", (args) => {
    expect(parseCliArgs(args)).toBeNull();
  });
});

describe("runCli", () => {
  it("runs an explicit bootstrap mode and closes the store after success without writing any token", async () => {
    const output: string[] = [];
    let closed = 0;
    const exit = await runCli(["bootstrap", "--apply"], {
      loadConfig: config,
      openStore: () => ({ close: () => { closed += 1; } }) as never,
      createPlane: () => ({} as never),
      bootstrap: async (_deps, options) => ({ mode: options.apply ? "active" : "dry-run", healthItem: "created" }),
      write: (line) => output.push(line),
    });

    expect(exit).toBe(0);
    expect(closed).toBe(1);
    expect(output).toEqual([JSON.stringify({ mode: "active", healthItem: "created" })]);
    expect(output.join("\n")).not.toContain("not-used-by-cli");
  });

  it("closes the store and returns one sanitized failure when reconciliation fails", async () => {
    const output: string[] = [];
    let closed = 0;
    const exit = await runCli(["reconcile", "--dry-run"], {
      loadConfig: config,
      openStore: () => ({ close: () => { closed += 1; } }) as never,
      createPlane: () => ({} as never),
      createGitHub: () => ({} as never),
      loadRegistry: () => ({ version: 1, entries: [] }),
      reconcile: async () => { throw new Error("Bearer not-used-by-cli"); },
      write: (line) => output.push(line),
    });

    expect(exit).toBe(1);
    expect(closed).toBe(1);
    expect(output).toEqual(["plane_sync_command_failed"]);
  });

  it("runs recover-failed without composing Plane or GitHub clients and prints only bounded counts", async () => {
    const output: string[] = [];
    let closed = 0;
    let recovered: unknown;
    const exit = await runCli([
      "recover-failed",
      "--dry-run",
      "--delivery-id",
      "delivery-1",
      "--reason",
      "mapping-reviewed",
      "--operator",
      "ops@example.test",
    ], {
      loadConfig: config,
      openStore: () => ({ close: () => { closed += 1; } }) as never,
      createPlane: () => { throw new Error("Plane must not be composed"); },
      createGitHub: () => { throw new Error("GitHub must not be composed"); },
      recoverFailed: (_store, options) => {
        recovered = options;
        return { mode: "dry-run", requested: 1, eligible: 1, requeued: 0 };
      },
      write: (line) => output.push(line),
    });

    expect(exit).toBe(0);
    expect(closed).toBe(1);
    expect(recovered).toMatchObject({
      deliveryIds: ["delivery-1"],
      reason: "mapping-reviewed",
      operator: "ops@example.test",
      apply: false,
    });
    expect(output).toEqual([JSON.stringify({ mode: "dry-run", requested: 1, eligible: 1, requeued: 0 })]);
    expect(output.join("\n")).not.toContain("mapping-reviewed");
    expect(output.join("\n")).not.toContain("ops@example.test");
    expect(output.join("\n")).not.toContain("not-used-by-cli");
    expect(output.join("\n")).not.toContain("compact_json");
    expect(output.join("\n")).not.toContain("actor");
    expect(output.join("\n")).not.toContain("body");
  });

  it("prints usage and creates no external composition for invalid arguments", async () => {
    const output: string[] = [];
    const exit = await runCli(["bootstrap"], {
      loadConfig: () => { throw new Error("config should not load"); },
      write: (line) => output.push(line),
    });

    expect(exit).toBe(2);
    expect(output).toEqual(["usage: plane-sync <bootstrap|reconcile> <--dry-run|--apply>"]);
  });
});
