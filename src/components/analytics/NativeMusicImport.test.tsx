/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NativeMusicImport from "./NativeMusicImport";

const preview = {
  kind: "preview", sha256: "a".repeat(64), provider: "apple_music_for_artists", artistName: "Fixture artist",
  dateFrom: "2026-01-01", dateThrough: "2026-01-02", capturedAt: "2026-01-03T12:00:00Z",
  metric: "plays", artistTotal: 8, rowCount: 2, total: 7,
};
let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<NativeMusicImport artists={[{ id: "artist-a", name: "Fixture artist" }]} selectedArtistId="artist-a" />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function reply(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status }); }
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function chooseFile() {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["{}"], "capture.json", { type: "application/json" })] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => button(label).click()); }

it("preselects the scoped artist and previews reporting, capture time, song sum and separate rollup before applying", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply({ kind: "imported", runId: "run-a" }));
  vi.stubGlobal("fetch", fetch);
  expect(container.querySelector("select")?.value).toBe("artist-a");
  expect(container.textContent).toContain("Reloading Analytics reads saved data");
  await chooseFile();
  await click("Preview native snapshot");
  expect(container.textContent).toContain("Reporting window: 2026-01-01–2026-01-02");
  expect(container.textContent).toContain(new Date(preview.capturedAt).toLocaleString());
  expect(container.textContent).toContain("Song sum: 7 plays");
  expect(container.textContent).toContain("Separate artist rollup: 8 plays");
  await click("Import this native snapshot");
  const form = fetch.mock.calls[1][1].body as FormData;
  expect(form.get("artist_id")).toBe("artist-a");
  expect(form.get("expected_sha256")).toBe(preview.sha256);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("importing an older capture does not replace it");
  expect(container.querySelector("a")?.getAttribute("href")).toBe("/analytics?section=overview&artist=artist-a");
});

it("reports duplicate replay as a no-op instead of a newly saved capture", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply({ kind: "duplicate", runId: "original-run" })));
  await chooseFile();
  await click("Preview native snapshot");
  await click("Import this native snapshot");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("This exact file was already imported. No new capture was saved.");
});

it("clears a previous preview after a failed re-preview and never leaves an apply action", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(preview)).mockResolvedValueOnce(reply({ error: "Snapshot no longer available" }, 503)));
  await chooseFile();
  await click("Preview native snapshot");
  await click("Preview native snapshot");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Snapshot no longer available");
  expect(container.textContent).not.toContain("Import this native snapshot");
});

it.each([
  ["server error", () => Promise.resolve(reply({ error: "Archive unavailable" }, 503))],
  ["lost response", () => Promise.reject(new TypeError("Failed to fetch"))],
  ["unconfirmed result", () => Promise.resolve(reply({ kind: "imported" }))],
])("keeps %s distinct from success and directs review before retrying", async (_name, apply) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(reply(preview)).mockImplementationOnce(apply));
  await chooseFile();
  await click("Preview native snapshot");
  await click("Import this native snapshot");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Import could not be confirmed. Review saved captures before trying again.");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  expect(container.textContent).not.toContain("Import this native snapshot");
});

it("rejects a malformed preview before an apply action can appear", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ ...preview, capturedAt: undefined })));
  await chooseFile();
  await click("Preview native snapshot");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid snapshot preview");
  expect(container.textContent).not.toContain("Import this native snapshot");
});
