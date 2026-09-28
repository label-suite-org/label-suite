/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import SpotifyIdentityReview from "./SpotifyIdentityReview";

it("requires explicit selection and confirmation, preserves failed choices, and clears stale proposals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
    input: { object_type: "album", external_id: "spotify-album", external_url: "https://open.spotify.com/album/fixture", name: "Album" },
    match_method: "upc", status: "ambiguous", candidates: [{ object_type: "album", object_id: "release-a", title: "Album", score: 100 }],
  }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SpotifyIdentityReview connectionId="spotify-connection" />));
    await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const confirm = [...host.querySelectorAll("button")].find(button => button.textContent === "Confirm match")!;
    expect(confirm.disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const select = host.querySelector("select")!;
    await act(async () => { select.value = "release-a"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Try again" }, { status: 503 }));
    await act(async () => confirm.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Try again");
    expect(select.value).toBe("release-a");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ connection_id: "spotify-connection", label_suite_object_type: "release", label_suite_object_id: "release-a" });
    fetchMock.mockResolvedValueOnce(Response.json({ link: { id: "link" } }));
    await act(async () => confirm.click());
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Spotify match saved.");
    expect(confirm.disabled).toBe(true);
    const input = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "spotify:track:1234567890123456789012");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
