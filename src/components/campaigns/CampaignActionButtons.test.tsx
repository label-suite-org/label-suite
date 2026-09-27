/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignDocument } from "../../lib/campaign-rich-text";
import { CampaignEditButton } from "./CampaignActionButtons";

const doc = (text: string): CampaignDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("CampaignEditButton rich text", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("edits canonical documents in the existing modal and preserves short fields", async () => {
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => ({
      ok: false,
      json: async () => ({ error: "Captured request" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(
      <CampaignEditButton
        campaign={{
          id: "campaign-1",
          revision: 1,
          campaign_name: "Airplay launch",
          owner: "Malthe",
          goal: "stale compatibility text",
          goal_document: doc("Earn airplay"),
          notes_document: doc("Pitch on Monday"),
        }}
        releases={[]}
        artists={[]}
      />,
    ));

    await click(host.querySelector('button[aria-label="Edit Airplay launch"]') as HTMLButtonElement);

    expect(host.querySelector('[role="textbox"][aria-label="Campaign goal"]')?.textContent).toBe("Earn airplay");
    expect(host.querySelector('[role="textbox"][aria-label="Campaign notes"]')?.textContent).toBe("Pitch on Monday");
    expect(host.querySelector('textarea[name="goal"]')).toBeNull();
    expect(host.querySelector('textarea[name="notes"]')).toBeNull();

    await act(async () => {
      host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(request.method).toBe("PUT");
    expect(body).toMatchObject({
      id: "campaign-1",
      campaign_name: "Airplay launch",
      owner: "Malthe",
      goal_document: doc("Earn airplay"),
      notes_document: doc("Pitch on Monday"),
    });
    expect(body).not.toHaveProperty("goal");
    expect(body).not.toHaveProperty("notes");
  });

  it("keeps the edit dialog mounted when its backdrop is attempted during a deferred AI decision", async () => {
    const goal = doc("Goal copy");
    const { deriveCampaignDocument } = await import("../../lib/campaign-rich-text");
    let resolveDecision: ((response: Response) => void) | undefined;
    const proposal = { run_id: "run-1", input_document_hash: deriveCampaignDocument(goal, 20_000).hash, proposed_document: goal, rationale: "Clearer.", citation_ids: [], status: "ready", comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: false, before: "Goal copy", proposed: "Goal copy" }] }, display: { provider: "openrouter", model: "safe-model", context_manifest: {}, citations: [] } };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("campaign-editor-ai-runs/run-1")) return new Promise<Response>((resolve) => { resolveDecision = resolve; });
      if (url.includes("/editor-ai-runs")) return Promise.resolve(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
      throw new Error(`Unexpected fetch ${url}`);
    }));
    await act(async () => root.render(<CampaignEditButton campaign={{ id: "campaign-1", revision: 1, campaign_name: "Airplay launch", goal_document: goal, notes_document: doc("Notes") }} releases={[]} artists={[]} />));
    await click(host.querySelector('button[aria-label="Edit Airplay launch"]') as HTMLButtonElement);
    const assist = host.querySelector('[role="textbox"][aria-label="Campaign goal"]')?.closest("section")?.querySelector('[aria-label="AI assist"]') as HTMLElement;
    await click([...assist.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes") as HTMLButtonElement);
    await click([...assist.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion") as HTMLButtonElement);
    await click(host.querySelector(".fixed.inset-0") as HTMLElement);
    expect(host.querySelector('[role="textbox"][aria-label="Campaign goal"]')).not.toBeNull();
    await act(async () => resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await click(host.querySelector(".fixed.inset-0") as HTMLElement);
    expect(host.querySelector('[role="textbox"][aria-label="Campaign goal"]')).toBeNull();
  });
});
