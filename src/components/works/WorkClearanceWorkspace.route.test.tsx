/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { WorkClearanceWorkspace } from "./WorkClearanceWorkspace";

describe("work scope navigation", () => {
  it("opens the requested scope, preserves draft rows across tabs, and lets readers navigate without editing", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const originalScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    window.history.replaceState(null, "", "/works/test-work?scope=master");
    const host = document.createElement("div"); document.body.append(host);
    const root = createRoot(host);
    const props = { work: { id: "test-work", title: "Test work" }, roles: [], contacts: [], tracks: [] };
    const click = async (text: string) => act(async () => {
      [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === text)!.click();
    });
    try {
      await act(async () => { root.render(<WorkClearanceWorkspace {...props} />); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Master");
      expect(document.activeElement?.id).toBe("work-master-add");
      expect(host.querySelector("#work-publishing")).toBeNull();
      await click("Activity");
      await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Add master split"))!.click(); });
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Master");
      expect(host.querySelector('[aria-label="Points"]')).not.toBeNull();
      await click("Publishing");
      expect(host.querySelector('[aria-label="Points"]')).toBeNull();
      await click("Master");
      expect(host.querySelector('[aria-label="Points"]')).not.toBeNull();
      await act(async () => { root.render(<WorkClearanceWorkspace {...props} canMutate={false} />); });
      expect((host.querySelector('[aria-label="Points"]') as HTMLInputElement).matches(":disabled")).toBe(true);
      await click("Publishing");
      expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Publishing");
    } finally {
      await act(async () => root.unmount()); host.remove();
      HTMLElement.prototype.scrollIntoView = originalScroll; vi.unstubAllGlobals();
    }
  });
});
