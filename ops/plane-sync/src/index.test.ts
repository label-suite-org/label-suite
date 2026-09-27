import { describe, expect, it } from "vitest";
import { installShutdownHandlers } from "./index.js";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, resolve: () => settle() };
}

describe("installShutdownHandlers", () => {
  it("stops once for repeated signals and removes both handlers after shutdown", async () => {
    const handlers = new Map<string, () => void>();
    let stops = 0;
    const stopping = deferred();
    const source = {
      on(signal: string, handler: () => void) { handlers.set(signal, handler); },
      removeListener(signal: string, handler: () => void) {
        if (handlers.get(signal) === handler) handlers.delete(signal);
      },
    };
    const dispose = installShutdownHandlers({
      stop: async () => { stops += 1; await stopping.promise; },
    }, source);

    handlers.get("SIGTERM")?.();
    handlers.get("SIGINT")?.();
    await Promise.resolve();
    expect(stops).toBe(1);
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);

    stopping.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(handlers.size).toBe(0);
    dispose();
  });
});
