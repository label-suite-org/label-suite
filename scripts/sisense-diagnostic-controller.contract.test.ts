import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(new URL("..", import.meta.url).pathname);
const npmCli = process.env.npm_execpath;

describe("Sisense diagnostic controller command", () => {
  it("offers a no-side-effect help path for the reviewed operator controller", async () => {
    expect(npmCli).toBeTruthy();
    const result = await runController(["--help"]);

    expect(result.status).toBe(0);
    expect(result.output).toContain("One-attempt Sisense diagnostic controller");
    expect(result.output).toContain("--evidence-file");
    expect(result.output).toContain("--transport-proof");
    expect(result.output).not.toContain("--lock-file");
    expect(result.output).toContain("~/.local/state/label-suite");
  });

  it("rejects any CLI override of the global controller lock", async () => {
    const result = await runController([
      "--evidence-file", "/tmp/label-suite-diagnostic-evidence.json",
      "--lock-file", "/tmp/alternate-controller.lock",
      "--attempt-id", "attempt-1",
      "--compose-id", "compose-1",
      "--app-name", "label-suite",
      "--service-name", "label-suite-sisense-sync",
      "--expected-revision", "a".repeat(40),
      "--daily-schedule-id", "daily-1",
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('"code":"lock_file_override_forbidden"');
  });

  it("rejects an evidence file that aliases the fixed global lock", async () => {
    const result = await runController([
      "--evidence-file", path.join(os.homedir(), ".local", "state", "label-suite", "sisense-diagnostic-controller.lock"),
      "--attempt-id", "attempt-1",
      "--compose-id", "compose-1",
      "--app-name", "label-suite",
      "--service-name", "label-suite-sisense-sync",
      "--expected-revision", "a".repeat(40),
      "--daily-schedule-id", "daily-1",
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('"code":"lock_file_conflicts_evidence"');
  });

  it("requires explicit provider scope for a Phase A diagnostic", async () => {
    const result = await runController([
      "--evidence-file", "/tmp/label-suite-diagnostic-evidence.json",
      "--attempt-id", "attempt-1",
      "--compose-id", "compose-1",
      "--app-name", "label-suite",
      "--service-name", "label-suite-sisense-sync",
      "--expected-revision", "a".repeat(40),
      "--daily-schedule-id", "daily-1",
    ]);
    expect(result.status).toBe(1);
    expect(result.output).toContain('"code":"diagnostic_scope_missing"');
  });
});

function runController(args: string[]): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCli!, "run", "sisense:diagnostic", "--", ...args], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, output }));
  });
}
