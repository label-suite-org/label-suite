/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ArtistCreateDialog } from "./ArtistCreateDialog";

vi.mock("./ArtistForm", () => ({ ArtistForm: () => <input aria-label="Artist name" /> }));

it("opens an accessible artist dialog and closes it with Escape", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ArtistCreateDialog />));
    await act(async () => container.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe("New Artist");
    await act(async () => dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
