/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseFieldCorrection } from "./ReleaseFieldCorrection";
import type { ReleaseReadinessSnapshot } from "../../server/release-correction";
import { uploadFileToStorage } from "../../lib/storage-client";
vi.mock("../../lib/storage-client", () => ({ uploadFileToStorage: vi.fn() }));

const initial: ReleaseReadinessSnapshot = {
  release: { id: "release-1", title: "Fascinator", updated_at: "2026-09-27T10:00:00.000Z", cover_art_url: null, upc_ean: "123", release_date: "2026-12-04", format: "EP" },
  readiness: { isReady: false, missing: ["Cover art", "No tracks"] },
  observed_at: "2026-09-27T10:00:00.000Z",
};

describe("ReleaseFieldCorrection confirmation", () => {
  let host: HTMLDivElement;
  let root: Root;
  const onSnapshot = vi.fn();
  const onDirtyChange = vi.fn();
  const onClose = vi.fn();
  const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent === text)!;
  const input = () => host.querySelector<HTMLInputElement>("#upc")!;
  const submit = async () => { await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };
  const render = async (canManage = true) => { await act(async () => root.render(<ReleaseFieldCorrection releaseId="release-1" field="upc_ean" inputId="upc" initial={initial} canManage={canManage} onSnapshot={onSnapshot} onDirtyChange={onDirtyChange} onClose={onClose} />)); };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    vi.clearAllMocks();
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it.each(["html", "redirect", "conflict", "forbidden", "offline"])("retains input after %s and retries only with an explicitly compared revision", async failure => {
    const failed = failure === "html" ? new Response("<html>Sign in</html>")
      : failure === "conflict" ? Response.json({ error: "Release changed" }, { status: 409 })
        : failure === "forbidden" ? Response.json({ error: "Insufficient permissions" }, { status: 403 })
        : Response.json({ ok: true, ...initial });
    if (failure === "redirect") Object.defineProperty(failed, "redirected", { value: true });
    const latest = { ...initial, release: { ...initial.release, upc_ean: "456", updated_at: "2026-09-27T11:00:00.000Z" } };
    const saved = { ...latest, release: { ...latest.release, upc_ean: "789", updated_at: "2026-09-27T12:00:00.000Z" } };
    const fetchMock = vi.fn();
    if (failure === "offline") fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    else fetchMock.mockResolvedValueOnce(failed);
    fetchMock.mockResolvedValueOnce(Response.json(latest)).mockResolvedValueOnce(Response.json({ ok: true, ...saved }));
    vi.stubGlobal("fetch", fetchMock);
    await render();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "789");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(input().value).toBe("789");
    expect(host.querySelector('[role="status"]')!.textContent).toBe("");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("retained");
    expect(button("Save UPC/EAN").disabled).toBe(true);
    expect(onSnapshot).not.toHaveBeenCalled();
    await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => button("Compare latest record").click());
    expect(host.textContent).toContain("Current UPC/EAN: 456");
    expect(input().value).toBe("789");
    await act(async () => button("Keep my correction").click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await submit();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ field: "upc_ean", value: "789", expected_updated_at: latest.release.updated_at });
    expect(onSnapshot).toHaveBeenLastCalledWith({ ok: true, ...saved });
    expect(host.querySelector('[role="status"]')!.textContent).toContain("UPC/EAN saved. 2 release checks still need attention.");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("shows the current value without write controls for a read-only member", async () => {
    await render(false);
    expect(host.textContent).toContain("UPC/EAN: 123");
    expect(host.textContent).toContain("read-only access");
    expect(host.querySelector("input")).toBeNull();
    expect(button("Save UPC/EAN")).toBeUndefined();
    await act(async () => host.querySelector("form")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps the fetched value visible when checks are unavailable without authorizing a write", async () => {
    await act(async () => root.render(<ReleaseFieldCorrection releaseId="release-1" field="upc_ean" inputId="upc" initial={null} fallbackValue="123" canManage={false} onSnapshot={onSnapshot} onDirtyChange={onDirtyChange} onClose={onClose} />));
    expect(host.textContent).toContain("UPC/EAN: 123");
    expect(host.textContent).toContain("has not been refreshed");
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("permits correcting a confirmed validation rejection without a revision comparison", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Invalid value" }, { status: 400 })));
    await render();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), "789");
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(input().value).toBe("789");
    expect(button("Save UPC/EAN").disabled).toBe(false);
    expect(button("Compare latest record")).toBeUndefined();
    expect(onSnapshot).not.toHaveBeenCalled();
  });

  it("retains an uploaded cover after a stale save and reuses it for the reviewed retry", async () => {
    const key = "releases/release-1/artwork/fixture.png";
    vi.mocked(uploadFileToStorage).mockResolvedValue({ key, url: null });
    const latest = { ...initial, release: { ...initial.release, updated_at: "2026-09-27T11:00:00.000Z" } };
    const saved = { ...latest, release: { ...latest.release, cover_art_url: key } };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "Release changed" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json(latest)).mockResolvedValueOnce(Response.json({ ok: true, ...saved }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<ReleaseFieldCorrection releaseId="release-1" field="cover_art_url" inputId="cover" initial={initial} canManage={true} onSnapshot={onSnapshot} onDirtyChange={onDirtyChange} onClose={onClose} />));
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]')!;
    await act(async () => {
      Object.defineProperty(fileInput, "files", { value: [new File(["fixture"], "fixture.png", { type: "image/png" })] });
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submit();
    expect(host.querySelector<HTMLInputElement>("#cover")!.value).toBe(key);
    await act(async () => button("Compare latest record").click());
    await act(async () => button("Keep my correction").click());
    await submit();
    expect(uploadFileToStorage).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ field: "cover_art_url", value: key, expected_updated_at: latest.release.updated_at });
    expect(host.querySelector('[role="status"]')!.textContent).toContain("Cover art saved.");
  });
});
