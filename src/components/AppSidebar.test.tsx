/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "./AppSidebar";
import { SidebarProvider } from "./ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";

let reactActEnvironment: typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

function stubBrowser(pathname: string, isMobile = false) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: isMobile ? 375 : 1280,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    writable: true,
    value: isMobile ? 812 : 1024,
  });

  const location = {
    href: `http://localhost${pathname}`,
    pathname,
    hash: "",
    search: "",
    assign: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    toString: () => `http://localhost${pathname}`,
  } as unknown as Location;

  vi.stubGlobal("location", location);
  vi.stubGlobal(
    "matchMedia",
    ((query: string) => ({
      matches: isMobile,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })) as typeof window.matchMedia,
  );
}

async function renderSidebar(pathname: string, isMobile = false) {
  const onToggleTheme = vi.fn();
  stubBrowser(pathname, isMobile);

  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <TooltipProvider>
        <SidebarProvider defaultOpen>
          <AppSidebar orgName="Test Org" dark={false} onToggleTheme={onToggleTheme} />
        </SidebarProvider>
      </TooltipProvider>,
    );
  });

  return {
    container,
    root,
    onToggleTheme,
    getSidebarState: () =>
      container.querySelector("[data-slot=\"sidebar\"][data-state]") as
        | HTMLDivElement
        | null,
  };
}

async function cleanupSidebar(container: HTMLDivElement, root: Root) {
  await act(async () => {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    vi.runOnlyPendingTimers();
  });
}

function getCookieValue(key: string) {
  const value = document.cookie.split("; ").find((entry) => entry.startsWith(`${key}=`));
  return value ? value.split("=")[1] : "";
}

beforeEach(() => {
  vi.useFakeTimers();
  reactActEnvironment = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  document.cookie = "";
});

afterEach(() => {
  delete reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.cookie = "";
});

describe("AppSidebar", () => {
  it("adds stable aria-labels and tooltip labels for icon-only controls", async () => {
    document.cookie = "sidebar_state=false; path=/; max-age=604800";

    const { container, root } = await renderSidebar("/dashboard");
    const sidebarState = container.querySelector("[data-slot='sidebar'][data-state]") as
      | HTMLDivElement
      | null;
    expect(sidebarState?.dataset.state).toBe("collapsed");

    const menuButtons = [...container.querySelectorAll("[data-sidebar='menu-button']")];
    expect(menuButtons.length).toBeGreaterThan(0);

    for (const button of menuButtons) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      expect(button.getAttribute("title")).toBeTruthy();
    }

    const tooltipTriggers = [...container.querySelectorAll("[data-slot='tooltip-trigger']")];
    expect(tooltipTriggers.length).toBeGreaterThan(0);

    const dashboardLink = container.querySelector("[href='/dashboard']") as HTMLAnchorElement | null;
    expect(dashboardLink?.getAttribute("title")).toBe("Open dashboard");
    expect(dashboardLink?.getAttribute("data-slot")).toBe("tooltip-trigger");
    expect(dashboardLink?.className).not.toContain("group-data-[collapsible=icon]:hidden");
    expect(container.querySelector("button a[href='/dashboard']")).toBeNull();

    await cleanupSidebar(container, root);
  });

  it("persists collapse state after pointer, keyboard, and touch-style toggles", async () => {
    document.cookie = "sidebar_state=false; path=/; max-age=604800";
    const { container, root, getSidebarState } = await renderSidebar("/dashboard");

    const trigger = container.querySelector("[data-sidebar='trigger']") as HTMLButtonElement | null;
    const rail = container.querySelector("[data-sidebar='rail']") as HTMLButtonElement | null;

    expect(trigger).toBeTruthy();
    expect(rail).toBeTruthy();
    expect(getSidebarState()?.dataset.state).toBe("collapsed");
    expect(trigger?.className).not.toContain("group-data-[collapsible=icon]:hidden");

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getSidebarState()?.dataset.state).toBe("expanded");
    expect(getCookieValue("sidebar_state")).toBe("true");

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    });
    expect(getSidebarState()?.dataset.state).toBe("collapsed");
    expect(getCookieValue("sidebar_state")).toBe("false");

    await act(async () => {
      rail?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(getSidebarState()?.dataset.state).toBe("expanded");
    expect(getCookieValue("sidebar_state")).toBe("true");

    await cleanupSidebar(container, root);
  });

  it("renders responsive mobile shell without overlap controls", async () => {
    const { container, root } = await renderSidebar("/dashboard", true);

    expect(document.querySelector("[data-sidebar='rail']")).toBeNull();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    });

    const dashboardLink = document.querySelector('[href="/dashboard"]') as HTMLAnchorElement | null;
    expect(dashboardLink?.getAttribute("title")).toBe("Open dashboard");
    expect(dashboardLink?.getAttribute("aria-label")).toBeTruthy();

    await cleanupSidebar(container, root);
  });

  it("keeps current-page state updated for route navigation changes", async () => {
    const { container, root } = await renderSidebar("/dashboard");

    expect(container.querySelector('[href="/dashboard"][aria-current="page"]')).toBeTruthy();

    await act(async () => {
      window.location.pathname = "/artists";
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(container.querySelector('[href="/artists"][aria-current="page"]')).toBeTruthy();
    expect(container.querySelector('[href="/dashboard"][aria-current="page"]')).toBeNull();

    await cleanupSidebar(container, root);
  });

  it("retains focus on the trigger with keyboard toggle", async () => {
    document.cookie = "sidebar_state=true; path=/; max-age=604800";
    const { container, root, getSidebarState } = await renderSidebar("/dashboard");
    const trigger = container.querySelector("[data-sidebar='trigger']") as HTMLButtonElement | null;

    expect(getSidebarState()?.dataset.state).toBe("expanded");
    trigger?.focus();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, bubbles: true }));
    });

    expect(document.activeElement).toBe(trigger);
    expect(getSidebarState()?.dataset.state).toBe("collapsed");

    await cleanupSidebar(container, root);
  });

  it("expands parent menu state for child routes in contextual hierarchy", async () => {
    const { container, root } = await renderSidebar("/works");

    expect(container.querySelector('[href="/releases"][aria-current="page"]')).toBeNull();
    expect(container.querySelector('[href="/releases"][aria-expanded="true"]')).toBeTruthy();
    expect(container.querySelector('[href="/works"][aria-current="page"]')).toBeTruthy();
    expect(container.querySelector('[data-sidebar="menu-sub"]')).toBeTruthy();
    expect(container.querySelector('[data-sidebar="menu-sub-button"][href="/works"]')).toBeTruthy();
    expect(container.querySelector('[href="/works"][aria-current="page"]')).toBeInstanceOf(HTMLAnchorElement);
    expect(container.querySelector('[href="/analytics"][aria-expanded="false"]')).toBeTruthy();

    await act(async () => {
      window.location.pathname = "/radio-plugging";
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(container.querySelector('[href="/campaigns"][aria-current="page"]')).toBeNull();
    expect(container.querySelector('[href="/campaigns"][aria-expanded="true"]')).toBeTruthy();
    expect(container.querySelector('[href="/releases"][aria-expanded="false"]')).toBeTruthy();
    expect(container.querySelector('[href="/radio-plugging"][aria-current="page"]')).toBeTruthy();

    await cleanupSidebar(container, root);
  });

});
