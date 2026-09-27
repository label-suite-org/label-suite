import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import {
  acquireControllerReservation,
  runWithControllerReservation,
} from "./sisense-diagnostic-reservation";

describe("Sisense diagnostic controller reservation", () => {
  it("uses an atomic 0600 file that excludes a second process before work starts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-controller-lock-"));
    const lockFile = path.join(directory, "controller.lock");
    const reservation = await acquireControllerReservation(lockFile, {
      attemptId: "attempt-one",
      ledgerPath: path.join(directory, "attempt-one.json"),
    });
    try {
      expect((await stat(lockFile)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(await readFile(lockFile, "utf8"))).toMatchObject({
        version: 1,
        attemptId: "attempt-one",
      });

      const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "sisense-diagnostic-reservation.ts")).href;
      const childCode = `import { acquireControllerReservation } from ${JSON.stringify(moduleUrl)};
        acquireControllerReservation(${JSON.stringify(lockFile)}, { attemptId: "attempt-two", ledgerPath: "/tmp/two.json" })
          .then(() => process.exit(0))
          .catch(() => process.exit(23));`;
      const status = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--eval", childCode], { stdio: "ignore" });
        child.once("error", reject);
        child.once("close", resolve);
      });
      expect(status).toBe(23);
    } finally {
      await reservation.release();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("retains unresolved reservations and releases only a verified clean result", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-controller-lock-"));
    const retainedLock = path.join(directory, "retained.lock");
    const releasedLock = path.join(directory, "released.lock");
    try {
      const unresolved = await runWithControllerReservation({
        lockFile: retainedLock,
        attemptId: "attempt-unresolved",
        ledgerPath: path.join(directory, "unresolved.json"),
        run: async () => ({
          ok: false,
          phaseASuccess: false,
          transportProofSuccess: false,
          manualInvocationCount: 1,
          code: "deployment_ambiguous",
          cleanupDeferred: true,
        }),
      });
      expect(unresolved.reservationRetained).toBe(true);
      await expect(stat(retainedLock)).resolves.toBeTruthy();

      const clean = await runWithControllerReservation({
        lockFile: releasedLock,
        attemptId: "attempt-clean",
        ledgerPath: path.join(directory, "clean.json"),
        run: async () => ({
          ok: true,
          phaseASuccess: true,
          transportProofSuccess: false,
          manualInvocationCount: 1,
          temporaryScheduleAbsent: true,
        }),
      });
      expect(clean.reservationRetained).toBe(false);
      await expect(stat(releasedLock)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("releases a preflight-only failure that made no schedule or invocation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "label-suite-controller-lock-"));
    const lockFile = path.join(directory, "preflight.lock");
    try {
      const outcome = await runWithControllerReservation({
        lockFile,
        attemptId: "attempt-preflight",
        ledgerPath: path.join(directory, "preflight.json"),
        run: async () => ({
          ok: false,
          phaseASuccess: false,
          transportProofSuccess: false,
          manualInvocationCount: 0,
          code: "daily_scheduler_missing",
        }),
      });
      expect(outcome.reservationRetained).toBe(false);
      await expect(stat(lockFile)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
