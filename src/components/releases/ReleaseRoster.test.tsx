// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ReleaseRoster } from "./ReleaseRoster";

it("restores release search from the URL and records changes for browser Back", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/releases?q=Saved%20search&filter=attention&sort=title");
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ReleaseRoster releases={[]} artists={[]} canMutate={false} />));
    const search = host.querySelector<HTMLInputElement>("input")!;
    expect(search.value).toBe("Saved search");
    expect(window.location.search).toContain("filter=attention");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Second search");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Second search");
    await act(async () => { window.history.replaceState(null, "", "/releases?q=Restored"); window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(search.value).toBe("Restored");
    expect(window.location.search).toBe("?q=Restored");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
