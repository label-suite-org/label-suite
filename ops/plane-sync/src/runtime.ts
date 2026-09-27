import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Server } from "node:http";
import { GitHubClient } from "./github.js";
import { buildHealthSnapshot, reportHealthToPlane, type HealthReportDeps } from "./health.js";
import { logSyncEvent } from "./log.js";
import { PlaneClient } from "./plane.js";
import { reconcile } from "./reconcile.js";
import { indexSeedRegistry, loadSeedRegistry } from "./registry.js";
import {
  createSyncServer,
  forceCloseSyncServerConnections,
  stopSyncServerAccepting,
  type SyncServerDeps,
} from "./server.js";
import { SqliteDeliveryStore } from "./store.js";
import type { ProcessorDeps } from "./processor.js";
import type { PublicHealth, SeedRegistry, SyncConfig, SyncRuntime } from "./types.js";
import { runWorkerOnce } from "./worker.js";

const MAX_WORKER_DELIVERIES_PER_UNIT = 32;
const SHUTDOWN_TIMEOUT_MS = 20_000;

interface ServerLike {
  listen(port: number, host: string, callback: () => void): unknown;
  close(callback: (error?: Error) => void): unknown;
  once?(event: "error", listener: () => void): unknown;
  removeListener?(event: "error", listener: () => void): unknown;
}
type ScheduledTask = ReturnType<typeof setInterval>;
type WorkerScheduledTask = ReturnType<typeof setTimeout>;

interface RuntimeClients {
  github: GitHubClient;
  plane: PlaneClient;
}

export interface RuntimeDependencies {
  openStore?: (path: string) => SqliteDeliveryStore;
  createServer?: (deps: SyncServerDeps) => ServerLike;
  createClients?: (config: SyncConfig) => RuntimeClients;
  loadRegistry?: () => SeedRegistry;
  runWorker?: (deps: ProcessorDeps, now: Date, revision: string) => Promise<"idle" | "completed" | "retry" | "failed">;
  reconcile?: typeof reconcile;
  buildHealth?: (deps: { store: SqliteDeliveryStore; revision: string }, now: Date) => Promise<PublicHealth>;
  reportHealth?: (deps: HealthReportDeps, snapshot: PublicHealth) => Promise<void>;
  schedule?: (callback: () => Promise<void>, intervalMs: number) => ScheduledTask;
  clearSchedule?: (scheduled: ScheduledTask) => void;
  scheduleWorker?: (callback: () => Promise<void>, delayMs: number) => WorkerScheduledTask;
  clearWorkerSchedule?: (scheduled: WorkerScheduledTask) => void;
  now?: () => Date;
  shutdownTimeoutMs?: number;
  waitForShutdown?: (timeoutMs: number) => Promise<void>;
  log?: typeof logSyncEvent;
}

function readRevision(file: string): string {
  try {
    const revision = readFileSync(file, "utf8").trim();
    return /^[0-9a-f]{7,64}$/i.test(revision) ? revision : "unknown";
  } catch {
    return "unknown";
  }
}

function defaultRegistry(): SeedRegistry {
  const path = fileURLToPath(new URL("../config/seed-registry.json", import.meta.url));
  return loadSeedRegistry(JSON.parse(readFileSync(path, "utf8")));
}

function defaultClients(config: SyncConfig): RuntimeClients {
  return {
    github: new GitHubClient({
      appId: config.githubAppId,
      installationId: config.githubInstallationId,
      privateKeyBase64: config.githubPrivateKeyBase64,
      repository: config.repository,
    }),
    plane: new PlaneClient({
      baseUrl: config.planeBaseUrl,
      apiToken: config.planeApiToken,
      workspace: config.planeWorkspace,
      projectId: config.planeProjectId,
    }),
  };
}

function defaultSchedule(callback: () => Promise<void>, intervalMs: number): ScheduledTask {
  return setInterval(() => { void callback(); }, intervalMs);
}

function defaultWorkerSchedule(callback: () => Promise<void>, delayMs: number): WorkerScheduledTask {
  const timer = setTimeout(() => { void callback(); }, delayMs);
  timer.unref();
  return timer;
}

function defaultShutdownDeadline(timeoutMs: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref();
  });
  return {
    promise,
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}

function nextEventLoopTurn(): { promise: Promise<void>; cancel: () => void } {
  let immediate: ReturnType<typeof setImmediate> | null = null;
  const promise = new Promise<void>((resolve) => { immediate = setImmediate(resolve); });
  return {
    promise,
    cancel: () => {
      if (immediate !== null) clearImmediate(immediate);
      immediate = null;
    },
  };
}

function listen(server: ServerLike, port: number, host: string): { promise: Promise<void>; cancel: () => void } {
  let cancel: () => void = () => undefined;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => server.removeListener?.("error", onError);
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    const failure = () => Object.assign(new Error("server_listen_failed"), { code: "server_listen_failed" });
    const onError = () => finish(() => reject(failure()));
    cancel = () => finish(() => reject(Object.assign(new Error("server_start_cancelled"), { code: "server_start_cancelled" })));
    server.once?.("error", onError);
    try {
      server.listen(port, host, () => finish(resolve));
    } catch {
      onError();
    }
  });
  return { promise, cancel };
}

function close(server: ServerLike): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}

function runtimeErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(error.code)) {
    return error.code;
  }
  return "runtime_failure";
}

/**
 * Builds the one-process sync service. The optional dependencies isolate time,
 * scheduling, and external HTTP clients without widening the production HTTP
 * surface or placing runtime credentials in tests.
 */
export async function createRuntime(config: SyncConfig, supplied: RuntimeDependencies = {}): Promise<SyncRuntime> {
  const store = (supplied.openStore ?? SqliteDeliveryStore.open)(config.databasePath);
  let storeClosed = false;
  const closeStore = () => {
    if (storeClosed) return;
    storeClosed = true;
    store.close();
  };
  try {
    const registry = indexSeedRegistry((supplied.loadRegistry ?? defaultRegistry)());
    store.seedMappings({ version: 1, entries: [...registry.byPlaneItem.values()] });
    const revision = readRevision(config.revisionFile);
    const clients = (supplied.createClients ?? defaultClients)(config);
    const now = supplied.now ?? (() => new Date());
    const makeHealth = supplied.buildHealth ?? buildHealthSnapshot;
    const sendHealth = supplied.reportHealth ?? reportHealthToPlane;
    const work = supplied.runWorker ?? runWorkerOnce;
    const runReconcile = supplied.reconcile ?? reconcile;
    const makeServer = supplied.createServer ?? createSyncServer;
    const schedule = supplied.schedule ?? defaultSchedule;
    const clearSchedule = supplied.clearSchedule ?? clearInterval;
    const scheduleWorker = supplied.scheduleWorker ?? defaultWorkerSchedule;
    const clearWorkerSchedule = supplied.clearWorkerSchedule ?? clearTimeout;
    const makeShutdownDeadline = supplied.waitForShutdown === undefined
      ? defaultShutdownDeadline
      : (deadlineMs: number) => ({ promise: supplied.waitForShutdown!(deadlineMs), cancel: () => undefined });
    const log = supplied.log ?? logSyncEvent;
    const timeoutMs = Math.min(Math.max(supplied.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS, 1), SHUTDOWN_TIMEOUT_MS);
    const processorDeps: ProcessorDeps = {
      config,
      store,
      github: clients.github,
      plane: clients.plane,
      registry,
      now,
      log,
    };
    const server = makeServer({
      config,
      store,
      health: () => makeHealth({ store, revision }, now()),
      onDeliveryAccepted: () => requestWorker(0),
    });

    let lifecycle: "new" | "starting" | "started" | "stopping" | "draining" | "stopped" = "new";
    let scheduled: ScheduledTask | null = null;
    let workerScheduled: WorkerScheduledTask | null = null;
    let lane = Promise.resolve();
    let startPromise: Promise<void> | null = null;
    let stopPromise: Promise<void> | null = null;
    let cancelPendingListen: (() => void) | null = null;
    const isStopping = () => lifecycle === "stopping" || lifecycle === "draining";

    const recordFailure = (source: "worker" | "reconcile" | "health", error: unknown) => {
      const code = runtimeErrorCode(error);
      try {
        store.recordRuntimeFailure(source, code, now());
      } catch {
        // A persistence outage is already represented by the unavailable health endpoint.
      }
      log({ level: "warn", code, revision });
    };

    const clearFailure = (source: "worker" | "reconcile" | "health") => {
      try {
        if (store.runtimeFailures().some((failure) => failure.source === source)) store.clearRuntimeFailure(source, now());
      } catch {
        // A persistence outage is already represented by the unavailable health endpoint.
      }
    };

    const reportCurrentHealth = async () => {
      try {
        const snapshot = await makeHealth({ store, revision }, now());
        await sendHealth({ store, plane: clients.plane, now }, snapshot);
        clearFailure("health");
      } catch (error) {
        recordFailure("health", error);
      }
    };

    const runWorkerUnit = async (): Promise<number> => {
      let processed = 0;
      let failed = false;
      try {
        while (processed < MAX_WORKER_DELIVERIES_PER_UNIT && lifecycle === "started") {
          const outcome = await work(processorDeps, now(), revision);
          if (outcome === "idle") break;
          processed += 1;
          if (outcome === "retry" || outcome === "failed") {
            failed = true;
            const code = store.healthStats().lastErrorCode ?? (outcome === "retry" ? "worker_retry" : "worker_failed");
            recordFailure("worker", { code });
            if (outcome === "retry") break;
          }
        }
        if (!failed) clearFailure("worker");
      } catch (error) {
        recordFailure("worker", error);
      }
      return processed;
    };

    const enqueue = (source: "worker" | "reconcile" | "health", operation: () => Promise<void>): Promise<void> => {
      const unit = lane.then(async () => {
        if (lifecycle !== "started") return;
        await operation();
      });
      lane = unit.catch((error: unknown) => {
        recordFailure(source, error);
      });
      return lane;
    };

    function requestWorker(delayMs: number): void {
      if (lifecycle !== "started") return;
      if (workerScheduled !== null) clearWorkerSchedule(workerScheduled);
      workerScheduled = scheduleWorker(async () => {
        workerScheduled = null;
        await runWorkerPump();
      }, Math.max(0, delayMs));
    }

    const nextWorkerDelay = (): number => {
      const readyAt = store.nextReadyDeliveryAt();
      if (readyAt === null) return 1_000;
      return Math.max(0, Date.parse(readyAt) - now().valueOf());
    };

    const runWorkerPump = () => enqueue("worker", async () => {
      const processed = await runWorkerUnit();
      if (lifecycle !== "started") return;
      requestWorker(processed >= MAX_WORKER_DELIVERIES_PER_UNIT ? 0 : nextWorkerDelay());
    });

    const runCycle = () => enqueue("reconcile", async () => {
      try {
        await runReconcile(
          { store, github: clients.github, plane: clients.plane, registry },
          { apply: config.writeMode === "active", now: now() },
        );
        clearFailure("reconcile");
      } catch (error) {
        recordFailure("reconcile", error);
      }
      try {
        store.pruneCompleted(new Date(now().valueOf() - config.envelopeRetentionMs));
      } catch (error) {
        recordFailure("reconcile", error);
      }
      if (lifecycle === "started") await reportCurrentHealth();
    });

    const runInitial = () => enqueue("worker", async () => {
      const processed = await runWorkerUnit();
      if (lifecycle !== "started") return;
      requestWorker(processed >= MAX_WORKER_DELIVERIES_PER_UNIT ? 0 : nextWorkerDelay());
      await reportCurrentHealth();
    });

    const start = async () => {
      if (lifecycle === "started") return;
      if (lifecycle === "stopped") return;
      if (startPromise !== null) return startPromise;
      lifecycle = "starting";
      startPromise = (async () => {
        const binding = listen(server, config.port, config.host);
        cancelPendingListen = binding.cancel;
        await binding.promise;
        cancelPendingListen = null;
        if (lifecycle !== "starting") return;
        lifecycle = "started";
        scheduled = schedule(runCycle, config.reconcileIntervalMs);
        void runInitial();
      })();
      try {
        await startPromise;
      } catch (error) {
        cancelPendingListen = null;
        if (!isStopping()) {
          lifecycle = "stopped";
          await close(server).catch(() => undefined);
          closeStore();
        }
        throw error;
      }
    };

    const stop = async () => {
      if (lifecycle === "stopped") return;
      if (stopPromise !== null) return stopPromise;
      stopPromise = (async () => {
        lifecycle = "stopping";
        cancelPendingListen?.();
        cancelPendingListen = null;
        await startPromise?.catch(() => undefined);
        if (scheduled !== null) {
          clearSchedule(scheduled);
          scheduled = null;
        }
        if (workerScheduled !== null) {
          clearWorkerSchedule(workerScheduled);
          workerScheduled = null;
        }
        stopSyncServerAccepting(server as Server);
        const closePromise = close(server).catch(() => undefined);
        const finalLane = lane;
        let laneSettled = false;
        const laneDone = finalLane.then(() => { laneSettled = true; });
        const shutdownDone = Promise.all([laneDone, closePromise]);
        const deadline = makeShutdownDeadline(timeoutMs);
        const settled = await Promise.race([
          shutdownDone.then(() => true),
          deadline.promise.then(() => false),
        ]);
        deadline.cancel();
        if (settled) {
          closeStore();
          lifecycle = "stopped";
          return;
        }
        log({ level: "warn", code: "shutdown_timeout", revision });
        forceCloseSyncServerConnections(server as Server);
        const forcedCloseTurn = nextEventLoopTurn();
        await Promise.race([closePromise, forcedCloseTurn.promise]);
        forcedCloseTurn.cancel();
        if (laneSettled) {
          closeStore();
          lifecycle = "stopped";
          return;
        }
        lifecycle = "draining";
        void laneDone.then(() => {
          closeStore();
          lifecycle = "stopped";
        });
      })();
      return stopPromise;
    };

    return { start, stop };
  } catch (error) {
    closeStore();
    throw error;
  }
}
