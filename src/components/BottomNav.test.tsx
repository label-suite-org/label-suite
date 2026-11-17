/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";
import { APP_NAV_ITEMS } from "@/lib/navigation";

it("keeps Events, Artists and radio reachable after moving recurring work into primary tabs", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const previousUrl = window.location.href;
  window.history.replaceState(null, "", "/settings");
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
    expect(more.classList.contains("bg-accent")).toBe(true);
    await act(async () => more.click());
    // The More drawer renders through the Sheet portal into document.body
    const drawer = document.body;
    for (const href of [...APP_NAV_ITEMS.map(item => item.url), "/settings"]) {
      expect(drawer.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
    expect(drawer.textContent).toContain("Radio Plugging");
    expect(drawer.textContent).toContain("Radio Stations");
    expect(drawer.querySelector('a[href="/settings"]')?.getAttribute("aria-current")).toBe("page");
    expect(drawer.querySelectorAll('a[href="/events"]')).toHaveLength(1);
    const closeButtons = drawer.querySelectorAll<HTMLButtonElement>('[data-slot="sheet-close"]');
    expect(closeButtons).toHaveLength(1);
    const close = closeButtons[0];
    await act(async () => close.click());
    expect(drawer.querySelector('a[href="/events"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    window.history.replaceState(null, "", previousUrl);
    vi.unstubAllGlobals();
  }
});
