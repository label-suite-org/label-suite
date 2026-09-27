/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignForm } from "./CampaignForm";

function editor(host: HTMLElement, label: string): HTMLElement {
  const element = host.querySelector(`[role="textbox"][aria-label="${label}"]`);
  if (!element) throw new Error(`${label} rich-text editor was not rendered`);
  return element as HTMLElement;
}

async function enterEditorText(element: HTMLElement, text: string): Promise<void> {
  await act(async () => {
    element.textContent = text;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("CampaignForm rich text", () => {
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

  it("creates a campaign with canonical goal and notes documents while context AI waits for first save", async () => {
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => ({
      ok: false,
      json: async () => ({ error: "Captured request" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<CampaignForm onClose={() => undefined} />));

    expect(host.textContent).toContain("Context-aware AI becomes available after the first save");
    expect([...host.querySelectorAll("button")].filter((button) => button.textContent === "Start blank")).toHaveLength(2);
    expect([...host.querySelectorAll("button")].filter((button) => button.textContent === "Paste existing copy")).toHaveLength(2);

    const name = host.querySelector("input[required]") as HTMLInputElement;
    await act(async () => {
      name.value = "Airplay launch";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await enterEditorText(editor(host, "Campaign goal"), "Earn airplay");
    await enterEditorText(editor(host, "Campaign notes"), "Pitch on Monday");

    await act(async () => {
      host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(request.method).toBe("POST");
    expect(body.goal_document).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Earn airplay" }] }],
    });
    expect(body.notes_document).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Pitch on Monday" }] }],
    });
    expect(body).not.toHaveProperty("goal");
    expect(body).not.toHaveProperty("notes");
    expect(JSON.stringify(body)).not.toContain("<p>");
  });

  it("preserves malformed stored goal JSON during an unrelated campaign save until repair is explicit", async () => {
    const fetchMock = vi.fn(async (_input: string, _init: RequestInit) => ({ ok: false, json: async () => ({ error: "Captured request" }) }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignForm onClose={() => undefined} initial={{
      id: "campaign-1", campaign_name: "Existing campaign", revision: 7,
      goal: "Readable legacy goal", goal_document: { type: "table" }, notes: "Safe notes",
    }} />));

    expect(host.textContent).toContain("Stored goal rich text needs repair");
    expect(editor(host, "Campaign goal").getAttribute("contenteditable")).not.toBe("true");
    await act(async () => host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(request.method).toBe("PUT");
    expect(body).toMatchObject({ id: "campaign-1", expected_revision: 7 });
    expect(body).not.toHaveProperty("goal_document");

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Repair goal rich text")?.click());
    expect(editor(host, "Campaign goal").getAttribute("contenteditable")).toBe("true");
    fetchMock.mockClear();
    await act(async () => host.querySelector("form")?.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true })));
    const [, repairRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(repairRequest.body))).toMatchObject({ goal_document: { type: "doc" } });
  });

  it("locks the notes sibling and Cancel while a deferred goal decision is pending, then restores both", async () => {
    const goal = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Goal copy" }] }] };
    const notes = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Notes copy" }] }] };
    let resolveDecision: ((response: Response) => void) | undefined;
    const proposal = { run_id: "run-1", input_document_hash: "", proposed_document: goal, rationale: "Clearer.", citation_ids: [], status: "ready", comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: false, before: "Goal copy", proposed: "Goal copy" }] }, display: { provider: "openrouter", model: "safe-model", context_manifest: {}, citations: [] } };
    const { deriveCampaignDocument } = await import("../../lib/campaign-rich-text");
    proposal.input_document_hash = deriveCampaignDocument(goal, 20_000).hash;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("campaign-editor-ai-runs/run-1")) return new Promise<Response>((resolve) => { resolveDecision = resolve; });
      if (url.includes("/editor-ai-runs")) return Promise.resolve(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
      throw new Error(`Unexpected fetch ${url}`);
    }));
    await act(async () => root.render(<CampaignForm onClose={() => undefined} initial={{ id: "campaign-1", revision: 1, campaign_name: "Campaign", goal_document: goal, notes_document: notes }} />));
    const goalAssist = editor(host, "Campaign goal").closest("section")?.querySelector('[aria-label="AI assist"]') as HTMLElement;
    await act(async () => [...goalAssist.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    await act(async () => [...goalAssist.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    expect(editor(host, "Campaign notes").getAttribute("contenteditable")).not.toBe("true");
    expect(([...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    expect(editor(host, "Campaign notes").getAttribute("contenteditable")).toBe("true");
    expect(([...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel") as HTMLButtonElement).disabled).toBe(false);
  });
});
