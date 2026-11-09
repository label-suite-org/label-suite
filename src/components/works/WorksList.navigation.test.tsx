// @vitest-environment jsdom
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { WorksList } from "./WorksList";

it("restores work search and queues after navigation while preserving other URL state", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState({ retained: true }, "", "/works?q=Saved&filter=payout&sort=revenue&source=review#list");
  const host = document.createElement("div"); document.body.append(host);
  const view = <WorksList works={[]} canMutate={false} />;
  host.innerHTML = renderToString(view);
  expect(host.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
  let root!: ReturnType<typeof hydrateRoot>;
  try {
    await act(async () => { root = hydrateRoot(host, view); });
    const search = host.querySelector<HTMLInputElement>("input")!;
    expect(search.disabled).toBe(false);
    expect(search.value).toBe("Saved");
    expect(host.querySelector('[aria-label="Filter works"]')?.textContent).toContain("Payout blocked");
    expect(host.querySelector('[aria-label="Sort works"]')?.textContent).toContain("Blocked money");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Changed");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(new URLSearchParams(window.location.search).get("q")).toBe("Changed");
    expect(window.location.href).toContain("source=review#list");
    expect(window.history.state).toEqual({ retained: true });
    await act(async () => {
      window.history.replaceState(null, "", "/works?q=Returned&filter=invalid&sort=invalid");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(search.value).toBe("Returned");
    expect(host.querySelector('[aria-label="Filter works"]')?.textContent).toContain("Priority");
    expect(window.location.search).toBe("?q=Returned");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
