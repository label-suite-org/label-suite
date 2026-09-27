/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CampaignAiAssist } from "./CampaignAiAssist";

const currentDocument = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Before copy" }] }] };
const proposal = {
  run_id: "run-1", input_document_hash: "a".repeat(64), proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Proposed copy" }] }] }, rationale: "Clearer.", citation_ids: ["cite-1"], status: "ready",
  comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Before copy", proposed: "Proposed copy" }] },
  display: { provider: "openrouter", model: "safe-model", context_manifest: { campaign: { id: "campaign-1", updated_at: "2026-08-08T10:00:00.000Z" }, citation_ids: ["cite-1"] }, citations: [{ id: "cite-1", title: "Accepted source", url: "https://example.test/source" }] },
};

function requestBody(call: unknown): unknown {
  const init = Array.isArray(call) ? call[1] as RequestInit | undefined : undefined;
  return JSON.parse(String(init?.body));
}

describe("CampaignAiAssist", () => {
  let host: HTMLDivElement; let root: Root;
  beforeEach(() => { host = document.createElement("div"); globalThis.document.body.append(host); root = createRoot(host); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("sends the selected operation with canonical document scope and reviews locally without domain actions", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("editor-ai-runs") && !url.includes("run-1") ? proposal : { run_id: "run-1", status: "accepted" }), { status: url.includes("run-1") ? 200 : 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const onApply = vi.fn();
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={() => undefined} />));
    const select = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
    await act(async () => { select.value = "shorten"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(requestBody(fetchMock.mock.calls[0])).toMatchObject({ operation: "shorten", scope: "document", current_document: currentDocument });
    expect(host.textContent).toContain("Review AI suggestion");
    expect(host.textContent).toContain("Before");
    expect(host.textContent).toContain("Proposed");
    expect(host.textContent).toContain("Before · Current");
    expect(host.textContent).toContain("Changed block 1: Proposed copy");
    expect(host.textContent).toContain("Provider: openrouter");
    expect(host.textContent).toContain("Context manifest: campaign-1");
    const citation = [...host.querySelectorAll("a")].find((anchor) => anchor.textContent === "Accepted source") as HTMLAnchorElement;
    expect(citation.href).toBe("https://example.test/source");
    expect(citation.target).toBe("_blank");
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    expect(onApply).toHaveBeenCalledWith(proposal.proposed_document);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).not.toContain(expect.stringMatching(/save|approve|publish|send|stage/));
  });

  it("moves keyboard focus to the review heading after a valid suggestion", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } })));
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    const suggest = [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes") as HTMLButtonElement;
    suggest.focus();
    await act(async () => suggest.click());

    expect(document.activeElement).toBe([...host.querySelectorAll("h3")].find((heading) => heading.textContent === "Review AI suggestion"));
  });

  it("offers all bounded operations, requires tone/custom instructions, and carries a selection", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_notes" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={{ from: 1, to: 7 }} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    const select = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
    const suggest = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes") as HTMLButtonElement;
    expect([...select.options].map((option) => option.value)).toEqual(["draft", "enrich", "improve", "shorten", "tone", "custom"]);
    for (const operation of ["draft", "enrich", "improve", "shorten"] as const) {
      await act(async () => root.render(<CampaignAiAssist key={operation} campaignId="campaign-1" surface="campaign_notes" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={{ from: 1, to: 7 }} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
      const currentSelect = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
      await act(async () => { currentSelect.value = operation; currentSelect.dispatchEvent(new Event("change", { bubbles: true })); suggest().click(); });
      expect(requestBody(fetchMock.mock.calls.at(-1))).toMatchObject({ operation, scope: "selection", selection: { from: 1, to: 7 }, surface: "campaign_notes" });
    }
    await act(async () => root.render(<CampaignAiAssist key="tone" campaignId="campaign-1" surface="campaign_notes" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={{ from: 1, to: 7 }} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    const toneSelect = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
    await act(async () => { toneSelect.value = "tone"; toneSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(suggest().disabled).toBe(true);
    const instruction = host.querySelector('input[aria-label="AI instruction"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(instruction, "Warmer"); instruction.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => suggest().click());
    expect(requestBody(fetchMock.mock.calls.at(-1))).toMatchObject({ operation: "tone", instruction: "Warmer" });
    await act(async () => root.render(<CampaignAiAssist key="custom" campaignId="campaign-1" surface="campaign_notes" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={{ from: 1, to: 7 }} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    const customSelect = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
    await act(async () => { customSelect.value = "custom"; customSelect.dispatchEvent(new Event("change", { bubbles: true })); });
    const customInstruction = host.querySelector('input[aria-label="AI instruction"]') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(customInstruction, "Warmer"); customInstruction.dispatchEvent(new Event("input", { bubbles: true })); suggest().click(); });
    expect(requestBody(fetchMock.mock.calls.at(-1))).toMatchObject({ operation: "custom", instruction: "Warmer" });
  });

  it.each([
    ["campaign_goal", { lead_id: null, draft_id: null, page_revision_id: null }],
    ["campaign_notes", { lead_id: null, draft_id: null, page_revision_id: null }],
    ["public_release_note", { lead_id: null, draft_id: null, page_revision_id: "revision-1" }],
    ["focused_outreach_body", { lead_id: "lead-1", draft_id: "draft-1", page_revision_id: null }],
    ["radio_update_body", { lead_id: null, draft_id: "draft-2", page_revision_id: "revision-2" }],
  ] as const)("sends exact authorized references for %s", async (surface, references) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface={surface} references={references} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(requestBody(fetchMock.mock.calls[0])).toMatchObject({ surface, ...references, current_document: currentDocument, input_document_hash: "a".repeat(64) });
  });

  it("records reject or stale decisions without applying copy and returns focus after a rejection", async () => {
    const onApply = vi.fn(); const onReturnFocus = vi.fn();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("run-1") ? { run_id: "run-1", status: "rejected" } : proposal), { status: url.includes("run-1") ? 200 : 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={onReturnFocus} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Reject suggestion")?.click());
    expect(onApply).not.toHaveBeenCalled();
    expect(onReturnFocus).toHaveBeenCalledOnce();
    expect(requestBody(fetchMock.mock.calls[1])).toEqual({ decision: "rejected", current_document_hash: "a".repeat(64) });

    let currentHash = "a".repeat(64);
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url.includes("run-1") ? { error: "stale" } : proposal), { status: url.includes("run-1") ? 409 : 201, headers: { "Content-Type": "application/json" } }));
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={onReturnFocus} getCurrentHash={() => currentHash} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    currentHash = "b".repeat(64);
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Suggestion is stale");
    expect(requestBody(fetchMock.mock.calls.at(-1))).toEqual({ decision: "accepted", current_document_hash: "b".repeat(64) });
  });

  it("keeps stale comparison visible until it is discarded, then permits a new suggestion", async () => {
    const onApply = vi.fn(); const onReturnFocus = vi.fn();
    const secondProposal = { ...proposal, run_id: "run-2" };
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("campaign-editor-ai-runs/run-1")) return new Response(JSON.stringify({ error: "stale" }), { status: 409, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify(fetchMock.mock.calls.filter(([request]) => String(request).includes("editor-ai-runs")).length > 1 ? secondProposal : proposal), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={onReturnFocus} />));

    const suggest = () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes") as HTMLButtonElement;
    await act(async () => suggest().click());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    expect(host.textContent).toContain("Review AI suggestion");
    expect(host.textContent).toContain("Suggestion is stale");
    expect(onApply).not.toHaveBeenCalled();
    expect(( [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion") as HTMLButtonElement).disabled).toBe(true);

    const discard = [...host.querySelectorAll("button")].find((button) => button.textContent === "Discard stale suggestion and retry") as HTMLButtonElement;
    await act(async () => discard.click());
    expect(host.textContent).not.toContain("Review AI suggestion");
    expect(onReturnFocus).toHaveBeenCalledOnce();
    expect(suggest().disabled).toBe(false);
    await act(async () => suggest().click());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("Review AI suggestion");
  });

  it("keeps AI unavailable and read-only states local to AI controls", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(host.textContent).toContain("AI suggestion is unavailable");
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled onApply={() => undefined} onReturnFocus={() => undefined} />));
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.disabled).toBe(true);
  });

  it.each([
    ["malformed", { status: "accepted" }],
    ["for another run", { run_id: "other-run", status: "accepted" }],
    ["for the wrong decision", { run_id: "run-1", status: "rejected" }],
  ])("keeps review and copy intact when a decision 2xx is %s", async (_case, decision) => {
    const onApply = vi.fn();
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.includes("run-1") ? decision : proposal), { status: url.includes("run-1") ? 200 : 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());

    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Review AI suggestion");
    expect(host.textContent).toContain("Could not record the AI decision");
  });

  it("holds the proposal operation/scope and refuses a late accept after the document hash changes", async () => {
    let resolveDecision: ((response: Response) => void) | undefined;
    let currentHash = "a".repeat(64);
    const onApply = vi.fn();
    const onDecisionPending = vi.fn();
    const fetchMock = vi.fn((url: string) => {
      if (!url.includes("run-1")) return Promise.resolve(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
      return new Promise<Response>((resolve) => { resolveDecision = resolve; });
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={() => undefined} getCurrentHash={() => currentHash} onDecisionPending={onDecisionPending} />));
    const select = host.querySelector('select[aria-label="AI operation"]') as HTMLSelectElement;
    await act(async () => { select.value = "shorten"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(host.textContent).toContain("Operation: shorten · Scope: document");
    expect(select.disabled).toBe(true);
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    expect(onDecisionPending).toHaveBeenCalledWith(true);
    currentHash = "b".repeat(64);
    await act(async () => resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })));

    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Suggestion is stale");
    expect(onDecisionPending).toHaveBeenLastCalledWith(false);
  });

  it("fails a malformed create 2xx safely instead of rendering unsafe display data", async () => {
    const malformed = { ...proposal, display: { ...proposal.display, citations: {} } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(malformed), { status: 201, headers: { "Content-Type": "application/json" } })));
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(host.textContent).toContain("AI suggestion is unavailable");
    expect(host.textContent).not.toContain("Review AI suggestion");
  });

  it.each([
    ["a nested document node with an unexpected key", { ...proposal, proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Proposed copy", unexpected: true }] }] } }],
    ["a document over the focused-outreach limit", { ...proposal, proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(10_001) }] }] } }],
    ["an uppercase input hash", { ...proposal, input_document_hash: "A".repeat(64) }],
    ["non-canonical comparison labels", { ...proposal, comparison: { ...proposal.comparison, before_label: "Before" } }],
    ["a fractional comparison index", { ...proposal, comparison: { ...proposal.comparison, blocks: [{ ...proposal.comparison.blocks[0], index: 0.5 }] } }],
    ["empty provider metadata", { ...proposal, display: { ...proposal.display, provider: "" } }],
  ])("fails a create 2xx safely when it contains %s", async (_case, invalidProposal) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(invalidProposal), { status: 201, headers: { "Content-Type": "application/json" } })));
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="focused_outreach_body" references={{ lead_id: "lead-1", draft_id: "draft-1", page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(host.textContent).toContain("AI suggestion is unavailable");
    expect(host.textContent).not.toContain("Review AI suggestion");
  });

  it.each([
    ["a document over the campaign 20,000-character limit", "campaign_goal", { ...proposal, proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x".repeat(20_001) }] }] } }],
    ["a canonical-looking hash for a different document", "campaign_goal", { ...proposal, input_document_hash: "b".repeat(64) }],
  ] as const)("fails safely when a create 2xx has %s", async (_case, surface, invalidProposal) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(invalidProposal), { status: 201, headers: { "Content-Type": "application/json" } })));
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface={surface} references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    expect(host.textContent).toContain("AI suggestion is unavailable");
    expect(host.textContent).not.toContain("Review AI suggestion");
  });

  it("creates only one audited run for same-tick double clicks while creation is pending", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveCreate = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    const suggest = [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes") as HTMLButtonElement;
    await act(async () => { suggest.click(); suggest.click(); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => resolveCreate?.(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } })));
    expect(host.textContent).toContain("Review AI suggestion");
  });

  it("marks a delayed suggestion stale when the editor changes before its response arrives", async () => {
    let resolveCreate: ((response: Response) => void) | undefined;
    let currentHash = "a".repeat(64);
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveCreate = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="campaign_goal" references={{ lead_id: null, draft_id: null, page_revision_id: null }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} getCurrentHash={() => currentHash} />));

    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    currentHash = "b".repeat(64);
    await act(async () => resolveCreate?.(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } })));

    expect(host.textContent).toContain("Review AI suggestion");
    expect(host.textContent).toContain("Suggestion is stale");
    expect(( [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion") as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not record a decision when the proposal owner changes before accept", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="radio_update_body" references={{ lead_id: null, draft_id: "draft-1", page_revision_id: "revision-1" }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="radio_update_body" references={{ lead_id: null, draft_id: "draft-2", page_revision_id: "revision-2" }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={() => undefined} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Suggestion is stale");
  });

  it("does not apply an accepted response after its owner changes while the decision is in flight", async () => {
    let resolveDecision: ((response: Response) => void) | undefined;
    const onApply = vi.fn();
    const fetchMock = vi.fn((url: string) => url.includes("run-1")
      ? new Promise<Response>((resolve) => { resolveDecision = resolve; })
      : Promise.resolve(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="radio_update_body" references={{ lead_id: null, draft_id: "draft-1", page_revision_id: "revision-1" }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={() => undefined} />));
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Suggest changes")?.click());
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Accept suggestion")?.click());
    await act(async () => root.render(<CampaignAiAssist campaignId="campaign-1" surface="radio_update_body" references={{ lead_id: null, draft_id: "draft-2", page_revision_id: "revision-2" }} document={currentDocument} hash={"a".repeat(64)} selection={null} disabled={false} onApply={onApply} onReturnFocus={() => undefined} />));
    await act(async () => resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })));

    expect(onApply).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Suggestion is stale");
  });
});
