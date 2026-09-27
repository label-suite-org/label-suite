/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailComposer } from "./EmailComposer";

const station = {
  id: "station-1",
  name: "Release Gate FM",
  email: "dj@release-gate.fm",
  dj_name: "Fixture DJ",
  city: "Copenhagen",
  country: "DK",
};

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("EmailComposer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      results: [{ station_id: station.id, email: station.email, status: "sent" }],
    }), { headers: { "content-type": "application/json" } })));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderReadyComposer() {
    await act(async () => {
      root.render(
        <EmailComposer
          selectedStations={[station]}
          templates={[]}
          campaigns={[{ id: "campaign-1", campaign_name: "Release Gate Campaign" }]}
          onClose={vi.fn()}
        />,
      );
    });

    const subject = container.querySelector('input[placeholder="Email subject line…"]') as HTMLInputElement;
    const body = container.querySelector('textarea[placeholder="Email body — HTML supported…"]') as HTMLTextAreaElement;
    const campaign = container.querySelectorAll("select")[1] as HTMLSelectElement;
    await act(async () => {
      setInputValue(campaign, "campaign-1");
      setInputValue(subject, "Release Gate Subject");
      setInputValue(body, "Release Gate Body");
      await Promise.resolve();
    });

    const reviewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send to 1 station")) as HTMLButtonElement;
    await act(async () => {
      reviewButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    return { reviewButton };
  }

  it("requires explicit confirmation before the send-boundary POST", async () => {
    await renderReadyComposer();

    expect(document.body.textContent).toContain("Release Gate FM <dj@release-gate.fm>");
    expect(document.body.textContent).toContain("Release Gate Campaign");
    expect(document.body.textContent).toContain("Release Gate Subject");
    expect(document.body.textContent).toContain("Release Gate Body");
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const cancelButton = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Cancel");
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const sendAgain = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send to 1 station"));
    await act(async () => {
      sendAgain?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    const confirmButton = Array.from(document.body.querySelector('[role="dialog"]')!.querySelectorAll("button")).find((button) => button.textContent?.includes("Confirm send to 1 station"));
    await act(async () => {
      confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/email/send");
    expect(container.textContent).toContain("Sent");
  });

  it("cancels on Escape without posting and restores focus to the review button", async () => {
    await renderReadyComposer();
    expect(document.activeElement?.textContent).toBe("Cancel");

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    const restoredReviewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send to 1 station"));
    expect(document.activeElement).toBe(restoredReviewButton);
  });

  it("contains Tab focus within the confirmation controls", async () => {
    await renderReadyComposer();
    const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement;
    const cancelButton = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Cancel") as HTMLButtonElement;
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.includes("Confirm send")) as HTMLButtonElement;

    expect(document.activeElement).toBe(cancelButton);
    await act(async () => {
      cancelButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(confirmButton);

    await act(async () => {
      confirmButton.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(cancelButton);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
