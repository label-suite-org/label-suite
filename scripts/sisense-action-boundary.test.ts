import { afterEach, describe, expect, it, vi } from "vitest";
import { createWakeableCancellation } from "./sisense-action-boundary";

describe("Sisense action-boundary cancellation", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("wakes an observer sleep immediately when the competing action settles", async () => {
    vi.useFakeTimers();
    const cancellation = createWakeableCancellation();
    let settled = false;
    const pending = cancellation.sleep(50).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    cancellation.cancel();
    await pending;

    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows why flag-only cancellation would strand the final polling sleep", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    let settled = false;
    const pending = new Promise<void>((resolve) => {
      setTimeout(() => {
        settled = true;
        resolve();
      }, 50);
    });

    await vi.advanceTimersByTimeAsync(20);
    cancelled = true;
    expect(cancelled).toBe(true);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(29);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(settled).toBe(true);
  });
});
