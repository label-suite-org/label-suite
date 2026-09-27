import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import type { SyncRuntime } from "./types.js";

interface SignalSource {
  on(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
  removeListener(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

/** Installs one bounded shutdown path for both container termination signals. */
export function installShutdownHandlers(runtime: Pick<SyncRuntime, "stop">, source: SignalSource = process): () => void {
  let stopping = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    source.removeListener("SIGTERM", handle);
    source.removeListener("SIGINT", handle);
  };
  const handle = () => {
    if (stopping) return;
    stopping = true;
    void runtime.stop().finally(dispose);
  };
  source.on("SIGTERM", handle);
  source.on("SIGINT", handle);
  return dispose;
}

export async function runService(): Promise<SyncRuntime> {
  const runtime = await createRuntime(loadConfig());
  const dispose = installShutdownHandlers(runtime);
  try {
    await runtime.start();
    return runtime;
  } catch (error) {
    dispose();
    await runtime.stop();
    throw error;
  }
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  try {
    await runService();
  } catch {
    process.exitCode = 1;
  }
}
