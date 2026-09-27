import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RetryableSyncError } from "./errors.js";
import { buildHealthSnapshot } from "./health.js";
import { createRuntime } from "./runtime.js";
import { createSyncServer } from "./server.js";
import { SqliteDeliveryStore } from "./store.js";
import type { CompactDelivery, PublicHealth, SyncConfig } from "./types.js";

const directories: string[] = [];

interface Capture<T> {
  value: T | null;
}

function capture<T>(): Capture<T> {
  return { value: null };
}

function required<T>(captured: Capture<T>, label: string): T {
  if (captured.value === null) throw new Error(`${label} was not captured`);
  return captured.value;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, resolve: () => settle() };
}

function config(directory: string): SyncConfig {
  const revisionFile = join(directory, "revision");
  writeFileSync(revisionFile, "69b2410da4eeba0a340c1ede94da2ff916cf67d0\n", "utf8");
  return {
    repository: "label-suite-org/label-suite_neon_r2",
    writeMode: "dry-run",
    host: "127.0.0.1",
    port: 0,
    bodyLimitBytes: 1_048_576,
    databasePath: join(directory, "deliveries.sqlite"),
    reconcileIntervalMs: 60_000,
    envelopeRetentionMs: 86_400_000,
    githubAppId: "1",
    githubInstallationId: "2",
    githubPrivateKeyBase64: "not-used-by-runtime",
    githubWebhookSecret: "not-used-by-runtime",
    planeBaseUrl: new URL("https://plane.example.test"),
    planeApiToken: "not-used-by-runtime",
    planeWorkspace: "workspace",
    planeProjectId: "9c9e4853-9b2b-4021-bbac-76a836d4b9d7",
    revisionFile,
  };
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-runtime-"));
  directories.push(directory);
  return directory;
}

function publicHealth(revision: string): PublicHealth {
  return {
    status: "ok",
    revision,
    lastAcceptedAt: null,
    lastPlaneMutationAt: null,
    lastReconciliationAt: "2026-08-02T10:00:00.000Z",
    pending: 0,
    permanentlyFailed: 0,
    lastErrorCode: null,
  };
}

function delivery(deliveryId: string, occurredAt = "2026-08-02T10:00:00.000Z"): CompactDelivery {
  return {
    deliveryId,
    event: "issues",
    action: "opened",
    repository: "label-suite-org/label-suite_neon_r2",
    subjectKind: "issue",
    subjectNumber: 128,
    actorLogin: "nature-boy",
    occurredAt,
  };
}

async function connectWire(server: Server, wire: string): Promise<Socket> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("runtime server did not bind a TCP port");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: address.port });
    socket.once("error", reject);
    socket.once("connect", () => {
      socket.removeListener("error", reject);
      const ignoreForcedReset = () => undefined;
      socket.on("error", ignoreForcedReset);
      socket.once("close", () => socket.removeListener("error", ignoreForcedReset));
      socket.write(wire);
      resolve(socket);
    });
  });
}

async function waitForHttpResponse(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    let received = Buffer.alloc(0);
    const cleanup = () => {
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onData = (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const headerEnd = received.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = received.subarray(0, headerEnd).toString("latin1");
      const length = Number(/content-length:\s*(\d+)/i.exec(header)?.[1] ?? "0");
      if (received.byteLength < headerEnd + 4 + length) return;
      cleanup();
      resolve();
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

async function waitForSocketClose(socket: Socket): Promise<void> {
  if (socket.destroyed) return;
  await new Promise<void>((resolve) => socket.once("close", () => resolve()));
}

async function boundedStop(runtime: { stop(): Promise<void> }, waitMs = 100): Promise<"stopped" | "timeout"> {
  return boundedCompletion(runtime.stop(), waitMs);
}

async function boundedCompletion(stopping: Promise<void>, waitMs = 100): Promise<"stopped" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      stopping.then(() => "stopped" as const),
      new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), waitMs); }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("createRuntime", () => {
  it("publishes an initial health snapshot after its first worker unit without waiting for reconciliation", async () => {
    const directory = temporaryDirectory();
    const calls: string[] = [];
    const runtime = await createRuntime(config(directory), {
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { calls.push("worker"); return "idle" as const; },
      reconcile: async () => { calls.push("reconcile"); return {} as never; },
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => { calls.push("health"); },
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["worker", "health"]);
    await runtime.stop();
  });

  it("starts once, seeds the registry, uses the file revision, and serializes worker and reconciliation units", async () => {
    const directory = temporaryDirectory();
    const revision = "69b2410da4eeba0a340c1ede94da2ff916cf67d0";
    const calls: string[] = [];
    const scheduled = capture<() => Promise<void>>();
    const workerGate = deferred();
    const runtime = await createRuntime(config(directory), {
      createServer: ({ health }) => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
        health,
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => {
        calls.push("worker:start");
        await workerGate.promise;
        calls.push("worker:end");
        return "idle" as const;
      },
      reconcile: async () => { calls.push("reconcile"); return { applied: 0 } as never; },
      buildHealth: async () => publicHealth(revision),
      reportHealth: async () => { calls.push("health"); },
      schedule: (callback) => { scheduled.value = callback; return 1 as never; },
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    await runtime.start();
    await Promise.resolve();
    expect(calls).toEqual(["worker:start"]);

    workerGate.resolve();
    await required(scheduled, "reconciliation schedule")();
    expect(calls).toEqual(["worker:start", "worker:end", "health", "reconcile", "health"]);
    await runtime.stop();
  });

  it("waits for the current serialized unit before closing and does not start a new one after stopping", async () => {
    const directory = temporaryDirectory();
    const workerGate = deferred();
    const calls: string[] = [];
    const scheduled = capture<() => Promise<void>>();
    const runtime = await createRuntime(config(directory), {
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { calls.push("server:close"); callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { calls.push("worker:start"); await workerGate.promise; calls.push("worker:end"); return "idle" as const; },
      reconcile: async () => { calls.push("reconcile"); return {} as never; },
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: (callback) => { scheduled.value = callback; return 1 as never; },
      clearSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
      shutdownTimeoutMs: 25,
    });

    await runtime.start();
    await Promise.resolve();
    const stopping = runtime.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toEqual(["worker:start", "server:close"]);
    workerGate.resolve();
    await stopping;
    await required(scheduled, "reconciliation schedule")();
    expect(calls).toEqual(["worker:start", "server:close", "worker:end"]);
  });

  it("falls back to a safe revision marker when the revision file is missing without exposing configuration values", async () => {
    const directory = temporaryDirectory();
    const health = capture<() => Promise<PublicHealth>>();
    const runtime = await createRuntime({ ...config(directory), revisionFile: join(directory, "missing") }, {
      createServer: ({ health: readHealth }) => {
        health.value = readHealth;
        return {
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
        };
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      buildHealth: async ({ revision }) => publicHealth(revision),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    await expect(required(health, "health callback")()).resolves.toMatchObject({ revision: "unknown" });
    await runtime.stop();
  });

  it("returns at its shutdown deadline but defers persistence close until the serialized lane settles", async () => {
    const directory = temporaryDirectory();
    let closed = 0;
    const storeClosed = deferred();
    const workerGate = deferred();
    let workerCalls = 0;
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const store = SqliteDeliveryStore.open(path);
        const close = store.close.bind(store);
        store.close = () => { closed += 1; close(); storeClosed.resolve(); };
        return store;
      },
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { workerCalls += 1; await workerGate.promise; return "idle" as const; },
      reconcile: async () => { throw new Error("reconcile must not begin after deadline"); },
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      waitForShutdown: async () => undefined,
      log: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    await Promise.resolve();
    await runtime.stop();

    expect(closed).toBe(0);
    expect(workerCalls).toBe(1);
    workerGate.resolve();
    await storeClosed.promise;
    expect(closed).toBe(1);
    expect(workerCalls).toBe(1);
    await runtime.stop();
    expect(closed).toBe(1);
  });

  it("rejects an asynchronous bind failure with a sanitized code and removes its temporary listener", async () => {
    const directory = temporaryDirectory();
    const occupied = createHttpServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    const address = occupied.address();
    if (!address || typeof address === "string") throw new Error("occupied server did not bind");
    const created = capture<Server>();
    const runtime = await createRuntime({ ...config(directory), port: address.port }, {
      createServer: (deps) => {
        const server = createSyncServer(deps);
        created.value = server;
        return server;
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      log: () => undefined,
    });

    await expect(runtime.start()).rejects.toMatchObject({ code: "server_listen_failed", message: "server_listen_failed" });
    expect(required(created, "bind-failure server").listenerCount("error")).toBe(0);
    await runtime.stop();
    await new Promise<void>((resolve, reject) => occupied.close((error) => error ? reject(error) : resolve()));
  });

  it("removes its one-shot bind listener after a successful start and stop", async () => {
    const directory = temporaryDirectory();
    const created = capture<Server>();
    const runtime = await createRuntime(config(directory), {
      createServer: (deps) => {
        const server = createSyncServer(deps);
        created.value = server;
        return server;
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
    });

    await runtime.start();
    expect(required(created, "started server").listenerCount("error")).toBe(0);
    await runtime.stop();
    expect(required(created, "started server").listenerCount("error")).toBe(0);
  });

  it("bounds shutdown and force-closes a partial-header socket when the lane is idle", async () => {
    const directory = temporaryDirectory();
    const server = capture<Server>();
    let storeClosed = 0;
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const store = SqliteDeliveryStore.open(path);
        const close = store.close.bind(store);
        store.close = () => { storeClosed += 1; close(); };
        return store;
      },
      createServer: (deps) => {
        const created = createSyncServer(deps);
        server.value = created;
        return created;
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      shutdownTimeoutMs: 10,
      log: () => undefined,
    });
    await runtime.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const runningServer = required(server, "runtime server");
    let serverClosed = 0;
    runningServer.once("close", () => { serverClosed += 1; });
    const socket = await connectWire(runningServer, "POST /github HTTP/1.1\r\nHost: localhost");

    const stopping = runtime.stop();
    const outcome = await boundedCompletion(stopping);
    const serverClosedAtReturn = serverClosed;
    if (outcome === "timeout") socket.destroy();
    await stopping;
    await waitForSocketClose(socket);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(outcome).toBe("stopped");
    expect(socket.destroyed).toBe(true);
    expect(runningServer.listening).toBe(false);
    expect(serverClosed).toBe(1);
    expect(serverClosedAtReturn).toBe(1);
    expect(storeClosed).toBe(1);
  });

  it("force-closes partial HTTP sockets at the deadline but keeps persistence open for a late lane", async () => {
    const directory = temporaryDirectory();
    const server = capture<Server>();
    let storeClosed = 0;
    const closed = deferred();
    const workerGate = deferred();
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const store = SqliteDeliveryStore.open(path);
        const close = store.close.bind(store);
        store.close = () => { storeClosed += 1; close(); closed.resolve(); };
        return store;
      },
      createServer: (deps) => {
        const created = createSyncServer(deps);
        server.value = created;
        return created;
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { await workerGate.promise; return "idle" as const; },
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      shutdownTimeoutMs: 10,
      log: () => undefined,
    });
    await runtime.start();
    await Promise.resolve();
    const runningServer = required(server, "runtime server");
    let serverClosed = 0;
    runningServer.once("close", () => { serverClosed += 1; });
    const sockets = await Promise.all([
      connectWire(runningServer, "POST /github HTTP/1.1\r\nHost: one"),
      connectWire(runningServer, "POST /github HTTP/1.1\r\nHost: two"),
    ]);

    const stopping = runtime.stop();
    const outcome = await boundedCompletion(stopping);
    const serverClosedAtReturn = serverClosed;
    if (outcome === "timeout") for (const socket of sockets) socket.destroy();
    await stopping;
    const closedBeforeRelease = storeClosed;
    workerGate.resolve();
    await closed.promise;
    await Promise.all(sockets.map(waitForSocketClose));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(outcome).toBe("stopped");
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    expect(closedBeforeRelease).toBe(0);
    expect(storeClosed).toBe(1);
    expect(runningServer.listening).toBe(false);
    expect(serverClosed).toBe(1);
    expect(serverClosedAtReturn).toBe(1);
  });

  it("closes multiple completed keep-alive sockets before the deadline and repeated stop stays idempotent", async () => {
    const directory = temporaryDirectory();
    const server = capture<Server>();
    let storeClosed = 0;
    let reconcileClears = 0;
    let workerClears = 0;
    const logs: Array<{ code: string }> = [];
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const store = SqliteDeliveryStore.open(path);
        const close = store.close.bind(store);
        store.close = () => { storeClosed += 1; close(); };
        return store;
      },
      createServer: (deps) => {
        const created = createSyncServer(deps);
        server.value = created;
        return created;
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => { reconcileClears += 1; },
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => { workerClears += 1; },
      shutdownTimeoutMs: 50,
      log: (event) => { logs.push(event); },
    });
    await runtime.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    const runningServer = required(server, "runtime server");
    const sockets = await Promise.all([
      connectWire(runningServer, "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n"),
      connectWire(runningServer, "GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n"),
    ]);
    await Promise.all(sockets.map(waitForHttpResponse));

    const outcomes = await Promise.all([boundedStop(runtime), boundedStop(runtime)]);
    await Promise.all(sockets.map(waitForSocketClose));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const activeHandles = (process as unknown as { _getActiveHandles(): unknown[] })._getActiveHandles();

    expect(outcomes).toEqual(["stopped", "stopped"]);
    expect(sockets.every((socket) => socket.destroyed)).toBe(true);
    expect(runningServer.listening).toBe(false);
    expect(activeHandles).not.toContain(runningServer);
    for (const socket of sockets) expect(activeHandles).not.toContain(socket);
    expect(storeClosed).toBe(1);
    expect(reconcileClears).toBe(1);
    expect(workerClears).toBe(1);
    expect(logs).not.toContainEqual(expect.objectContaining({ code: "shutdown_timeout" }));
  });

  it("cancels a pending start during stop without leaving the runtime or store pending", async () => {
    const directory = temporaryDirectory();
    let closed = 0;
    let serverClosed = 0;
    let timersStarted = 0;
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const store = SqliteDeliveryStore.open(path);
        const close = store.close.bind(store);
        store.close = () => { closed += 1; close(); };
        return store;
      },
      createServer: () => ({
        listen() { /* deliberately never binds */ },
        close(callback: (error?: Error) => void) { serverClosed += 1; callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      schedule: () => { timersStarted += 1; return 1 as never; },
      clearSchedule: () => undefined,
      scheduleWorker: () => { timersStarted += 1; return 2 as never; },
      clearWorkerSchedule: () => undefined,
    });

    const starting = runtime.start();
    const rejected = expect(starting).rejects.toMatchObject({ code: "server_start_cancelled" });
    await runtime.stop();
    await rejected;

    expect(serverClosed).toBe(1);
    expect(closed).toBe(1);
    expect(timersStarted).toBe(0);
  });

  it("wakes the dedicated worker pump immediately after durable webhook acceptance", async () => {
    const directory = temporaryDirectory();
    const accepted = capture<() => void>();
    const workerTimers: Array<{ callback: () => Promise<void>; delay: number }> = [];
    let clears = 0;
    let workerCalls = 0;
    const runtime = await createRuntime(config(directory), {
      createServer: (deps) => {
        if (deps.onDeliveryAccepted === undefined) throw new Error("runtime must provide a delivery acceptance callback");
        accepted.value = deps.onDeliveryAccepted;
        return {
          listen(_port: number, _host: string, callback: () => void) { callback(); },
          close(callback: (error?: Error) => void) { callback(); },
        };
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { workerCalls += 1; return "idle" as const; },
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: (callback, delay) => { workerTimers.push({ callback, delay }); return workerTimers.length as never; },
      clearWorkerSchedule: () => { clears += 1; },
    });

    await runtime.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(workerCalls).toBe(1);
    expect(workerTimers.at(-1)?.delay).toBe(1_000);
    required(accepted, "delivery acceptance callback")();
    expect(workerTimers.at(-1)?.delay).toBe(0);
    await workerTimers.at(-1)?.callback();
    expect(workerCalls).toBe(2);
    await runtime.stop();
    expect(clears).toBeGreaterThan(0);
  });

  it("drains more than one bounded worker batch without busy-spinning", async () => {
    const directory = temporaryDirectory();
    const workerTimers: Array<{ callback: () => Promise<void>; delay: number }> = [];
    let workerCalls = 0;
    const runtime = await createRuntime(config(directory), {
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => { workerCalls += 1; return workerCalls <= 40 ? "completed" as const : "idle" as const; },
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: (callback, delay) => { workerTimers.push({ callback, delay }); return workerTimers.length as never; },
      clearWorkerSchedule: () => undefined,
    });

    await runtime.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(workerCalls).toBe(32);
    expect(workerTimers.at(-1)?.delay).toBe(0);
    await workerTimers.at(-1)?.callback();
    expect(workerCalls).toBe(41);
    expect(workerTimers.at(-1)?.delay).toBe(1_000);
    await runtime.stop();
  });

  it("schedules a retry at its persisted due time instead of polling in a tight loop", async () => {
    const directory = temporaryDirectory();
    const workerTimers: Array<{ callback: () => Promise<void>; delay: number }> = [];
    const store = capture<SqliteDeliveryStore>();
    let workerCalls = 0;
    const now = new Date("2026-08-02T10:00:00.000Z");
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const opened = SqliteDeliveryStore.open(path);
        store.value = opened;
        opened.recordDelivery(delivery("retry-due"), now);
        return opened;
      },
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => {
        workerCalls += 1;
        const claimed = required(store, "retry store").claimNext(now);
        if (!claimed) return "idle" as const;
        required(store, "retry store").retryDelivery(claimed.lease, "plane_service_unavailable", now);
        return "retry" as const;
      },
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: (callback, delay) => { workerTimers.push({ callback, delay }); return workerTimers.length as never; },
      clearWorkerSchedule: () => undefined,
      now: () => now,
    });

    await runtime.start();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(workerCalls).toBe(1);
    expect(workerTimers.at(-1)?.delay).toBeGreaterThanOrEqual(1_000);
    expect(workerTimers.at(-1)?.delay).toBeLessThan(1_100);
    await runtime.stop();
  });

  it("persists sanitized health-report failures until a deterministic recovery", async () => {
    const directory = temporaryDirectory();
    const readHealth = capture<() => Promise<PublicHealth>>();
    const reconcileTimer = capture<() => Promise<void>>();
    let fail = true;
    const runtime = await createRuntime(config(directory), {
      createServer: (deps) => {
        readHealth.value = deps.health;
        return {
          listen(_port: number, _host: string, callback: () => void) { callback(); },
          close(callback: (error?: Error) => void) { callback(); },
        };
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async ({ store }, options) => {
        store.setMaxTimestamp("last-successful-reconciliation-at", options.now);
        return {} as never;
      },
      buildHealth: buildHealthSnapshot,
      reportHealth: async () => {
        if (fail) throw new RetryableSyncError("plane_service_unavailable");
      },
      schedule: (callback) => { reconcileTimer.value = callback; return 1 as never; },
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    await required(reconcileTimer, "reconciliation schedule")();
    await expect(required(readHealth, "health callback")()).resolves.toMatchObject({ status: "failed", lastErrorCode: "plane_service_unavailable" });
    fail = false;
    await required(reconcileTimer, "reconciliation schedule")();
    await expect(required(readHealth, "health callback")()).resolves.toMatchObject({ status: "ok", lastErrorCode: null });
    await runtime.stop();
  });

  it("never persists raw exception text as a runtime health code", async () => {
    const directory = temporaryDirectory();
    const readHealth = capture<() => Promise<PublicHealth>>();
    const runtime = await createRuntime(config(directory), {
      createServer: (deps) => {
        readHealth.value = deps.health;
        return {
          listen(_port: number, _host: string, callback: () => void) { callback(); },
          close(callback: (error?: Error) => void) { callback(); },
        };
      },
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      reportHealth: async () => { throw new Error("Bearer private-token-value"); },
      schedule: () => 1 as never,
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      now: () => new Date("2026-08-02T10:00:00.000Z"),
    });

    await runtime.start();
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    const snapshot = await required(readHealth, "health callback")();
    expect(snapshot).toMatchObject({ status: "failed", lastErrorCode: "runtime_failure" });
    expect(JSON.stringify(snapshot)).not.toContain("private-token-value");
    await runtime.stop();
  });

  it("prunes only completed envelopes on the configured reconciliation cadence", async () => {
    const directory = temporaryDirectory();
    const store = capture<SqliteDeliveryStore>();
    const reconcileTimer = capture<() => Promise<void>>();
    let reconcileDelay = 0;
    const now = new Date("2026-08-02T10:00:00.000Z");
    const runtime = await createRuntime(config(directory), {
      openStore: (path) => {
        const opened = SqliteDeliveryStore.open(path);
        store.value = opened;
        for (const [id, createdAt] of [["old", "2026-07-31T10:00:00.000Z"], ["recent", "2026-08-02T09:00:00.000Z"]] as const) {
          opened.recordDelivery(delivery(id, createdAt), createdAt);
          const claimed = opened.claimNext(createdAt);
          if (!claimed) throw new Error("test delivery was not claimed");
          opened.completeDelivery(claimed.lease, createdAt);
        }
        opened.recordDelivery(delivery("retry"), now);
        const retry = opened.claimNext(now);
        if (!retry) throw new Error("retry delivery was not claimed");
        opened.retryDelivery(retry.lease, "plane_service_unavailable", now);
        opened.recordDelivery(delivery("failed"), now);
        const failed = opened.claimNext(now);
        if (!failed) throw new Error("failed delivery was not claimed");
        opened.failDelivery(failed.lease, "plane_mapping_ambiguous", now);
        opened.recordDelivery(delivery("pending"), now);
        return opened;
      },
      createServer: () => ({
        listen(_port: number, _host: string, callback: () => void) { callback(); },
        close(callback: (error?: Error) => void) { callback(); },
      }),
      createClients: () => ({ github: {} as never, plane: {} as never }),
      loadRegistry: () => ({ version: 1, entries: [] }),
      runWorker: async () => "idle" as const,
      reconcile: async () => ({} as never),
      buildHealth: async () => publicHealth("revision"),
      reportHealth: async () => undefined,
      schedule: (callback, delay) => { reconcileTimer.value = callback; reconcileDelay = delay; return 1 as never; },
      clearSchedule: () => undefined,
      scheduleWorker: () => 2 as never,
      clearWorkerSchedule: () => undefined,
      now: () => now,
    });

    await runtime.start();
    expect(reconcileDelay).toBe(60_000);
    await required(reconcileTimer, "reconciliation schedule")();
    const deliveryStore = required(store, "delivery store");
    expect(deliveryStore.healthStats()).toMatchObject({ completed: 2, pending: 1, retry: 1, permanentlyFailed: 1 });
    expect(deliveryStore.pruneCompleted("2026-08-01T10:00:00.000Z")).toBe(0);
    expect(deliveryStore.pruneCompleted("2026-08-03T10:00:00.000Z")).toBe(1);
    expect(deliveryStore.healthStats()).toMatchObject({ pending: 1, retry: 1, permanentlyFailed: 1 });
    await runtime.stop();
  });
});
