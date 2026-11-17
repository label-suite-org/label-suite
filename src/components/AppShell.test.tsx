/* @vitest-environment jsdom */
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { serializeClientCapabilities } from "@/server/native-capabilities";

vi.mock("./AppSidebar", () => ({ AppSidebar: () => <aside /> }));
vi.mock("./BottomNav", () => ({ BottomNav: () => <nav aria-label="Phone navigation" /> }));
vi.mock("./DevFeedback", () => ({ DevFeedback: () => null }));
vi.mock("./command-palette/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("./ui/sidebar", () => ({ SidebarProvider: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

it("opens the existing search and retains the payee boundary and content skip target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("dark-mode", "false");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const search = vi.fn();
  window.addEventListener("label-suite:open-command-palette", search);
  const props = { orgName: "Example Label", membershipRole: "member" as const, capabilities: serializeClientCapabilities("member") };
  try {
    await act(async () => root.render(<AppShell {...props}><h1>Current page</h1></AppShell>));
    expect(host.textContent).toContain("Example Label");
    const target = host.querySelector("main#workspace-content");
    expect(target?.textContent).toBe("Current page");
    expect(host.querySelector('a[href="#workspace-content"]')).not.toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Search workspace"]')!.click());
    expect(search).toHaveBeenCalledTimes(1);
    expect(host.querySelector('a[href="/settings"]')).not.toBeNull();
    await act(async () => root.render(<AppShell {...props} isPayee><h1>Payee page</h1></AppShell>));
    expect(host.querySelector('[aria-label="Workspace toolbar"]')).toBeNull();
    expect(host.querySelector("aside, nav")).toBeNull();
    expect(host.querySelector("main")?.textContent).toBe("Payee page");
  } finally {
    await act(async () => root.unmount());
    window.removeEventListener("label-suite:open-command-palette", search);
    localStorage.clear();
    host.remove();
    vi.unstubAllGlobals();
  }
});
