/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import NativeMusicHistory from "./NativeMusicHistory";
import type { NativeMusicCatalogue } from "../../server/native-music-import";

// Chart geometry is covered by rendered-browser checks; this exercises input and totals.
vi.mock("recharts", () => ({ ResponsiveContainer: () => null, CartesianGrid: () => null,
  Line: () => null, LineChart: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null }));

it("keeps the screen usable after an out-of-range typed date and recovers the exact total", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const capture: NativeMusicCatalogue = { version: 1, periodKind: "daily", artistId: "artist", runId: "run",
    provider: "spotify_for_artists", providerArtistId: "A".repeat(22), artistName: "Fixture",
    capturedAt: "2026-02-02T12:00:00Z", dateFrom: "2026-02-01", dateThrough: "2026-02-01",
    territory: "worldwide", metric: "audio_streams", artistTotal: null, acquisition: "signed_in_browser_capture",
    sourceUrl: "https://example.invalid/artist", rows: [{ recordingId: "song", title: "Fixture song", value: 7,
      sourceUrl: "https://example.invalid/song", daily: [{ date: "2026-02-01", value: 7 }] }] };
  try {
    await act(async () => root.render(<NativeMusicHistory captures={[capture]} />));
    expect(container.textContent).toContain("1 of 1 song histories");
    expect(container.textContent).toContain("Available platforms");
    const input = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    for (const value of ["1900-01-01", ""]) {
      await act(async () => { set.call(input, value); input.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(container.querySelector('[role="status"]')?.textContent).toBe("Choose a valid date range.");
    }
    await act(async () => { set.call(input, "2026-02-01"); input.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain("1 of 1 song histories");
    expect(container.querySelector("tbody tr td")?.textContent).toBe("7");
    // A newly imported older window must not expand the initial view into years
    // of missing coverage on the other platform.
    await act(async () => root.render(<NativeMusicHistory key="older" captures={[capture, {
      ...capture, runId: "old", dateFrom: "2024-01-01", dateThrough: "2024-01-01",
      rows: [{ ...capture.rows[0], daily: [{ date: "2024-01-01", value: 7 }] }],
    }]} />));
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("2026-01-05");
    expect(container.textContent).toContain("Captured dates: 2024-01-01–2026-02-01");
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
