// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ArtistRoster } from "./ArtistRoster";

it("restores artist filters and comparison after navigation without discarding other URL state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/artists?q=Saved&filter=quiet&relationship=collaborator&sort=followers&view=ops&source=review#list");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ArtistRoster artists={[]} canMutate={false} />));
    const search = host.querySelector<HTMLInputElement>("input")!;
    expect(search.value).toBe("Saved");
    const compare = Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Compare")!;
    expect(compare.getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("Collaborators");
    expect(host.textContent).toContain("Quiet roster");
    expect(host.textContent).toContain("Followers");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Changed");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Changed");
    expect(window.location.href).toContain("source=review#list");
    await act(async () => { window.history.replaceState(null, "", "/artists?q=Returned&filter=invalid&sort=invalid&view=invalid"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(search.value).toBe("Returned");
    expect(compare.getAttribute("aria-pressed")).toBe("false");
    expect(window.location.search).toBe("?q=Returned");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
