import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { DiagnosticResult } from "./sisense-diagnostic-controller";

export class ControllerReservationError extends Error {
  constructor(readonly code: "controller_reserved" | "lock_file_not_absolute" | "reservation_release_failed") {
    super(code);
  }
}

export class ControllerReservation {
  private closed = false;

  constructor(
    private readonly lockFile: string,
    private readonly handle: FileHandle,
  ) {}

  async release(): Promise<void> {
    if (this.closed) return;
    const [owned, current] = await Promise.all([this.handle.stat(), lstat(this.lockFile)]);
    if (owned.dev !== current.dev || owned.ino !== current.ino) {
      await this.retain();
      throw new ControllerReservationError("reservation_release_failed");
    }
    await unlink(this.lockFile);
    await this.retain();
  }

  async retain(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.handle.close();
  }
}

export function defaultControllerLockPath(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".local", "state", "label-suite", "sisense-diagnostic-controller.lock");
}

export async function acquireControllerReservation(
  lockFile: string,
  input: { attemptId: string; ledgerPath: string },
): Promise<ControllerReservation> {
  if (!path.isAbsolute(lockFile)) throw new ControllerReservationError("lock_file_not_absolute");
  await mkdir(path.dirname(lockFile), { recursive: true, mode: 0o700 });

  let handle: FileHandle;
  try {
    handle = await open(lockFile, "wx", 0o600);
  } catch (error: unknown) {
    if (isFileExists(error)) throw new ControllerReservationError("controller_reserved");
    throw error;
  }

  try {
    await handle.writeFile(`${JSON.stringify({
      version: 1,
      reservationId: randomUUID(),
      attemptId: input.attemptId,
      ledgerPath: input.ledgerPath,
      acquiredAt: new Date().toISOString(),
    })}\n`);
    await handle.chmod(0o600);
    await handle.sync();
    await chmod(lockFile, 0o600);
    return new ControllerReservation(lockFile, handle);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(lockFile).catch(() => undefined);
    throw error;
  }
}

export async function runWithControllerReservation(input: {
  lockFile: string;
  attemptId: string;
  ledgerPath: string;
  run: () => Promise<DiagnosticResult>;
}): Promise<{ result: DiagnosticResult; reservationRetained: boolean }> {
  const reservation = await acquireControllerReservation(input.lockFile, {
    attemptId: input.attemptId,
    ledgerPath: input.ledgerPath,
  });
  try {
    const result = await input.run();
    const reservationRetained = !isDefinitelySafeAndClean(result);
    if (reservationRetained) await reservation.retain();
    else await reservation.release();
    return { result, reservationRetained };
  } catch (error) {
    await reservation.retain();
    throw error;
  }
}

function isDefinitelySafeAndClean(result: DiagnosticResult): boolean {
  if (result.cleanupDeferred === true) return false;
  if (result.manualInvocationCount === 0 && result.temporaryScheduleAbsent !== false) return true;
  if (result.temporaryScheduleAbsent !== true) return false;
  return !new Set([
    "cleanup_failed",
    "ledger_persist_failed",
    "daily_scheduler_changed",
    "sisense_schedule_remaining",
    "schedule_inventory_changed",
  ]).has(result.code ?? "");
}

function isFileExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
