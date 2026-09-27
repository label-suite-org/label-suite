/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BugInbox } from "./BugInbox";

describe("BugInbox", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the confirmed status on failure and allows a truthful retry", async () => {
    let finishFailedRequest: ((response: Response) => void) | undefined;
    const failedRequest = new Promise<Response>((resolve) => { finishFailedRequest = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(failedRequest)
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<BugInbox initialBugs={[{
      id: "bug-1",
      title: "Release metadata is incomplete",
      description: null,
      priority: "P1",
      status: "logged",
      auto_generated: false,
    }]} />));

    const statusGroup = host.querySelector('[role="group"]') as HTMLDivElement;
    const buttons = [...statusGroup.querySelectorAll("button")];
    const logged = buttons.find(button => button.textContent === "Logged") as HTMLButtonElement;
    const triaged = buttons.find(button => button.textContent === "Triaged") as HTMLButtonElement;

    expect(statusGroup.getAttribute("aria-label")).toBe("Status for Release metadata is incomplete");
    expect(logged.getAttribute("aria-pressed")).toBe("true");
    expect(triaged.className).toContain("min-h-6");

    await act(async () => {
      triaged.click();
      await Promise.resolve();
    });

    expect(statusGroup.getAttribute("aria-busy")).toBe("true");
    expect(buttons.every(button => button.disabled)).toBe(true);
    triaged.click();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFailedRequest?.(new Response("<html>Sign in</html>", { status: 200, headers: { "Content-Type": "text/html" } }));
      await failedRequest;
      await Promise.resolve();
    });

    expect(logged.getAttribute("aria-pressed")).toBe("true");
    expect(triaged.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("The status could not be saved. Try again.");

    await act(async () => {
      triaged.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logged.getAttribute("aria-pressed")).toBe("false");
    expect(triaged.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Status changed to Triaged.");
  });
});
