// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ReleaseCalendar } from "./ReleaseCalendar";
let root: Root;
let container: HTMLDivElement;
const status = { configured: true, connected: true, enabled: true, email: "team@example.com", calendarId: "shared", calendarName: "True Nature", lastSyncedAt: null, error: null, links: [{ id: "link", title: "Deliver masters", conflict: "Dates changed in both places", localDate: "2026-11-01", googleDate: "2026-11-02", etag: "v1", ignored: false, resolution: null }] };
async function render(canManage: boolean) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReleaseCalendar releaseId="release" canManage={canManage} />));
}
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });
it("shows both conflict dates and submits the reviewed versions to resolve", async () => {
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => new Response(JSON.stringify(options ? { ok: true } : status)));
  vi.stubGlobal("fetch", fetch);
  await render(true);
  expect(container.textContent).toContain("True Nature");
  expect(container.textContent).toContain("Suite: 2026-11-01");
  expect(container.textContent).toContain("Google: 2026-11-02");
  const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "Use Google date")!;
  await act(async () => button.click());
  expect(JSON.parse(String(fetch.mock.calls.find((call) => call[1]?.method === "POST")?.[1]?.body))).toEqual({ action: "resolve", releaseId: "release", id: "link", choice: "google", localDate: "2026-11-01", etag: "v1" });
});
it("keeps connection and resolution controls unavailable to read-only members", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(status))));
  await render(false);
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(container.textContent).toContain("workspace owner or operator");
});
