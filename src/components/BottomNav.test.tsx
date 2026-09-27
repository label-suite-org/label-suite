/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

it("keeps Events, Artists and radio reachable after moving recurring work into primary tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<BottomNav />));
    expect(
      [...host.querySelectorAll("nav a")].map((a) => a.getAttribute("href")),
    ).toEqual([
      "/dashboard",
      "/today",
      "/releases",
      "/campaigns",
      "/ops-tasks",
    ]);
    const more = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "More",
    )!;
    await act(async () => more.click());
    // The More drawer renders through the Sheet portal into document.body
    const drawer = document.body;
    for (const href of ["/events", "/artists"]) {
      expect(drawer.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(drawer.textContent).toContain("Radio Plugging");
    expect(drawer.textContent).toContain("Radio Stations");
    expect(drawer.querySelectorAll('a[href="/events"]')).toHaveLength(1);
    const closeButtons = drawer.querySelectorAll<HTMLButtonElement>('[data-slot="sheet-close"]');
    expect(closeButtons).toHaveLength(1);
    const close = closeButtons[0];
    await act(async () => close.click());
    expect(drawer.querySelector('a[href="/events"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
