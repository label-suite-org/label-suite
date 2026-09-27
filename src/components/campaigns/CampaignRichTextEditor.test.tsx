/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveCampaignDocument, legacyTextToCampaignDocument, type CampaignDocument } from "../../lib/campaign-rich-text";
import { CampaignRichTextEditor } from "./CampaignRichTextEditor";

const doc = (text = ""): CampaignDocument => ({
  type: "doc",
  content: [{ type: "paragraph", content: text ? [{ type: "text", text }] : [] }],
});

function editorText(host: HTMLElement): HTMLElement {
  const element = host.querySelector('[role="textbox"]');
  if (!element) throw new Error("Campaign editor textbox was not rendered");
  return element as HTMLElement;
}

function button(host: HTMLElement, name: string): HTMLButtonElement {
  const element = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === name);
  if (!element) throw new Error(`Campaign editor button ${name} was not rendered`);
  return element;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

describe("CampaignRichTextEditor", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    if (typeof Range.prototype.getClientRects !== "function") {
      Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [] });
    }
    if (typeof Range.prototype.getBoundingClientRect !== "function") {
      Object.defineProperty(Range.prototype, "getBoundingClientRect", {
        configurable: true,
        value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
      });
    }
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
      // Tiptap defers editor destruction with a 1 ms timer. Let it finish
      // while jsdom's window still exists, rather than leaking into teardown.
      await new Promise<void>((resolve) => setTimeout(resolve, 1));
    });
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders a labelled, keyboard-focusable editor with a wrap-safe toolbar", async () => {
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    const textbox = editorText(host);
    expect(textbox.getAttribute("aria-label")).toBe("Campaign goal");
    expect(textbox.getAttribute("contenteditable")).toBe("true");
    expect(textbox.getAttribute("tabindex")).toBe("0");
    expect(host.querySelector('[role="toolbar"]')?.className).toContain("flex-wrap");
    expect(host.querySelector('[role="toolbar"]')?.className).toContain("overflow-x-auto");
    expect(document.body.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });

  it("keeps its toolbar wrap-safe at a 320 px viewport", async () => {
    vi.stubGlobal("innerWidth", 320);
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    expect(window.innerWidth).toBe(320);
    expect(host.querySelector('[role="toolbar"]')?.className).toContain("min-w-0");
    expect(host.querySelector('[role="toolbar"]')?.className).toContain("flex-wrap");
    expect(document.body.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
  });

  it("formats the current block and inline selection through visible toolbar controls", async () => {
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    await click(button(host, "Heading 2"));
    expect(host.querySelector("h2")?.textContent).toBe("Fountain");
    await click(button(host, "Heading 3"));
    expect(host.querySelector("h3")?.textContent).toBe("Fountain");
    await click(button(host, "Paragraph"));
    expect(host.querySelector("p")?.textContent).toBe("Fountain");
    await click(button(host, "Bold"));
    expect(button(host, "Bold").getAttribute("aria-pressed")).toBe("true");
    await click(button(host, "Italic"));
    expect(button(host, "Italic").getAttribute("aria-pressed")).toBe("true");
  });

  it("formats the editor when a keyboard-focused toolbar control is activated", async () => {
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    const heading = button(host, "Heading 2");
    heading.focus();
    expect(document.activeElement).toBe(heading);
    await click(heading);
    expect(host.querySelector("h2")?.textContent).toBe("Fountain");
    expect(document.activeElement).toBe(editorText(host));
  });

  it("restores a DOM text selection before a keyboard toolbar action", async () => {
    const marked: CampaignDocument = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Selected words", marks: [{ type: "italic" }] }] }] };
    await act(async () => root.render(<CampaignRichTextEditor id="notes" label="Notes" value={marked} maxCharacters={20_000} onChange={() => undefined} />));
    const text = editorText(host).querySelector("em")!.firstChild!;
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(text);
    await act(async () => {
      editorText(host).focus();
      selection.removeAllRanges(); selection.addRange(range);
      expect(selection.toString()).toBe("Selected words");
      const italic = button(host, "Italic");
      italic.focus();
      // Keyboard activation has no mousedown and may precede selectionchange.
      italic.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(editorText(host).querySelector("em")).toBeNull();
    expect(editorText(host).textContent).toBe("Selected words");
    await act(async () => {
      const caret = document.createRange();
      caret.setStart(editorText(host).querySelector("p")!.firstChild!, 3);
      caret.collapse(true);
      selection.removeAllRanges(); selection.addRange(caret);
      const bold = button(host, "Bold"); bold.focus();
      bold.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(editorText(host).querySelector("strong")).toBeNull();
  });

  it("supports links, both lists, blockquotes, and history without unsupported formatting controls", async () => {
    vi.stubGlobal("prompt", vi.fn(() => "https://example.com/listen"));
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    await click(button(host, "Bullet list"));
    expect(host.querySelector("ul")?.textContent).toBe("Fountain");
    await click(button(host, "Link"));
    expect(button(host, "Unlink").disabled).toBe(false);
    await click(button(host, "Unlink"));
    expect(button(host, "Unlink").disabled).toBe(true);
    expect(button(host, "Undo").disabled).toBe(false);
    await click(button(host, "Undo"));
    expect(button(host, "Redo").disabled).toBe(false);
    await click(button(host, "Redo"));
    expect(host.textContent).not.toMatch(/strike|underline|code block|horizontal rule/i);

    const secondHost = document.createElement("div");
    document.body.appendChild(secondHost);
    const secondRoot = createRoot(secondHost);
    await act(async () => secondRoot.render(<CampaignRichTextEditor id="notes" label="Campaign notes" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));
    await click(button(secondHost, "Ordered list"));
    expect(secondHost.querySelector("ol")?.textContent).toBe("Fountain");
    act(() => secondRoot.unmount());
    secondHost.remove();

    const thirdHost = document.createElement("div");
    document.body.appendChild(thirdHost);
    const thirdRoot = createRoot(thirdHost);
    await act(async () => thirdRoot.render(<CampaignRichTextEditor id="quote" label="Campaign quote" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));
    await click(button(thirdHost, "Block quote"));
    expect(thirdHost.querySelector("blockquote")?.textContent).toBe("Fountain");
    act(() => thirdRoot.unmount());
    thirdHost.remove();
  });

  it("emits a valid link as a canonical href-only document without rolling back", async () => {
    const onChange = vi.fn();
    vi.stubGlobal("prompt", vi.fn(() => "https://example.com/listen"));
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={onChange} />));

    const textNode = editorText(host).firstChild?.firstChild;
    if (!textNode) throw new Error("Campaign editor content was not rendered");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, "Fountain".length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    await click(button(host, "Link"));

    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toEqual({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "Fountain", marks: [{ type: "link", attrs: { href: "https://example.com/listen" } }] }],
      }],
    });
    expect(editorText(host).querySelector('a[href="https://example.com/listen"]')?.textContent).toBe("Fountain");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("restores the last valid document when an editor update exceeds the character limit", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Stable")} maxCharacters={10_000} onChange={onChange} />));

    await act(async () => {
      const textbox = editorText(host);
      textbox.textContent = "x".repeat(10_001);
      textbox.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect(editorText(host).textContent).toBe("Stable");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Character limit exceeded");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears dirty state when undo restores the current value baseline", async () => {
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    await click(button(host, "Heading 2"));
    expect(host.textContent).toContain("Unsaved changes");
    await click(button(host, "Undo"));

    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("clears dirty state when the parent supplies the newly saved canonical value", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={onChange} />));

    await click(button(host, "Heading 2"));
    const savedDocument = onChange.mock.calls[0]?.[0] as CampaignDocument;
    expect(host.textContent).toContain("Unsaved changes");
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={savedDocument} maxCharacters={20_000} onChange={onChange} />));

    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("keeps ordinary edits and AI accepts dirty when a controlled parent echoes under the same baseline key", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} baselineKey="campaign:campaign-1" maxCharacters={20_000} onChange={onChange} />));
    await click(button(host, "Heading 2"));
    const echoedEdit = onChange.mock.calls.at(-1)?.[0] as CampaignDocument;
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={echoedEdit} baselineKey="campaign:campaign-1" maxCharacters={20_000} onChange={onChange} />));
    expect(host.textContent).toContain("Unsaved changes");

    const proposal = doc("AI accepted copy");
    vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("run-1")
      ? { run_id: "run-1", status: "accepted" }
      : { run_id: "run-1", input_document_hash: deriveCampaignDocument(echoedEdit, 20_000).hash, proposed_document: proposal, rationale: "Clearer", citation_ids: [], status: "ready", comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Fountain", proposed: "AI accepted copy" }] }, display: { provider: "test", model: "test", context_manifest: {}, citations: [] } }), { status: url.includes("run-1") ? 200 : 201, headers: { "Content-Type": "application/json" } }))));
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={echoedEdit} baselineKey="campaign:campaign-1" maxCharacters={20_000} aiAvailable aiAssist={{ campaignId: "campaign-1", surface: "campaign_goal", references: { lead_id: null, draft_id: null, page_revision_id: null } }} onChange={onChange} />));
    await click(button(host, "Suggest changes"));
    await click(button(host, "Accept suggestion"));
    const echoedAiAccept = onChange.mock.calls.at(-1)?.[0] as CampaignDocument;
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={echoedAiAccept} baselineKey="campaign:campaign-1" maxCharacters={20_000} aiAvailable aiAssist={{ campaignId: "campaign-1", surface: "campaign_goal", references: { lead_id: null, draft_id: null, page_revision_id: null } }} onChange={onChange} />));
    expect(editorText(host).textContent).toBe("AI accepted copy");
    expect(host.textContent).toContain("Unsaved changes");
  });

  it("resets a controlled editor only when its saved baseline key changes", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} baselineKey="draft:one" maxCharacters={20_000} onChange={onChange} />));
    await click(button(host, "Heading 2"));
    const localDocument = onChange.mock.calls.at(-1)?.[0] as CampaignDocument;
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={localDocument} baselineKey="draft:one" maxCharacters={20_000} onChange={onChange} />));
    expect(host.textContent).toContain("Unsaved changes");

    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={localDocument} baselineKey="draft:two" maxCharacters={20_000} onChange={onChange} />));
    expect(host.textContent).not.toContain("Unsaved changes");

    await click(button(host, "Heading 3"));
    expect(host.textContent).toContain("Unsaved changes");
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("External saved version")} baselineKey="draft:three" maxCharacters={20_000} onChange={onChange} />));
    expect(editorText(host).textContent).toBe("External saved version");
    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("replaces edited content with a different parent canonical value without leaving stale dirty state", async () => {
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} onChange={() => undefined} />));

    await click(button(host, "Heading 2"));
    expect(host.textContent).toContain("Unsaved changes");

    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("New campaign direction")} maxCharacters={20_000} onChange={() => undefined} />));

    expect(editorText(host).textContent).toBe("New campaign direction");
    expect(host.textContent).not.toContain("Unsaved changes");
  });

  it("initializes canonical legacy content and emits only validated dirty documents", async () => {
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={legacyTextToCampaignDocument("First line\nsecond line")} maxCharacters={20_000} onChange={onChange} />));

    expect(editorText(host).textContent).toContain("First line");
    await click(button(host, "Heading 2"));
    expect(onChange).toHaveBeenCalledOnce();
    const [changed, derived] = onChange.mock.calls[0] as [CampaignDocument, { plainText: string }];
    expect(changed.type).toBe("doc");
    expect(derived.plainText).toBe("First line\nsecond line");
    expect(host.textContent).toContain("Unsaved changes");
  });

  it("keeps editing controls and callbacks disabled in read-only state", async () => {
    const onChange = vi.fn();
    const onAiRequest = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="notes" label="Campaign notes" value={doc("Locked")} maxCharacters={10_000} readOnly onChange={onChange} onAiRequest={onAiRequest} />));

    expect(editorText(host).getAttribute("contenteditable")).toBe("false");
    expect(button(host, "Bold").disabled).toBe(true);
    expect(button(host, "Draft from campaign context").disabled).toBe(true);
    await click(button(host, "Bold"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onAiRequest).not.toHaveBeenCalled();
  });

  it("offers empty-state actions and reports selection or document AI scope without mutating content", async () => {
    const onChange = vi.fn();
    const onAiRequest = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc()} maxCharacters={20_000} aiAvailable onChange={onChange} onAiRequest={onAiRequest} />));

    expect(host.textContent).toContain("Start blank");
    expect(host.textContent).toContain("Paste existing copy");
    await click(button(host, "Draft from campaign context"));
    expect(onAiRequest).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "draft", scope: "document", selection: null, currentDocument: doc() }));
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} aiAvailable onChange={onChange} onAiRequest={onAiRequest} />));
    const textNode = editorText(host).firstChild?.firstChild;
    if (!textNode) throw new Error("Campaign editor content was not rendered");
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, "Fountain".length);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await click(button(host, "Draft from campaign context"));
    expect(onAiRequest).toHaveBeenLastCalledWith(expect.objectContaining({ operation: "draft", scope: "selection", selection: { from: 1, to: 9 }, currentDocument: doc("Fountain") }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("mounts the reviewable AI assist against the canonical editor document", async () => {
    await act(async () => root.render(<CampaignRichTextEditor
      id="goal"
      label="Campaign goal"
      value={doc("Fountain")}
      maxCharacters={20_000}
      aiAvailable
      aiAssist={{ campaignId: "campaign-1", surface: "campaign_goal", references: { lead_id: null, draft_id: null, page_revision_id: null } }}
      onChange={() => undefined}
    />));

    expect(host.querySelector('[aria-label="AI assist"]')).not.toBeNull();
    expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Draft from campaign context")).toBeUndefined();
  });

  it("locks the editor while an AI accept is pending so a late response cannot overwrite a new edit", async () => {
    let resolveDecision: ((response: Response) => void) | undefined;
    const proposed = doc("Suggested");
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (!url.includes("editor-ai-runs/run-1")) return Promise.resolve(new Response(JSON.stringify({ run_id: "run-1", input_document_hash: deriveCampaignDocument(doc("Fountain"), 20_000).hash, proposed_document: proposed, rationale: "Clearer", citation_ids: [], status: "ready", comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Fountain", proposed: "Suggested" }] }, display: { provider: "test", model: "test", context_manifest: {}, citations: [] } }), { status: 201, headers: { "Content-Type": "application/json" } }));
      return new Promise<Response>((resolve) => { resolveDecision = resolve; });
    }));
    const onChange = vi.fn();
    await act(async () => root.render(<CampaignRichTextEditor id="goal" label="Campaign goal" value={doc("Fountain")} maxCharacters={20_000} aiAvailable aiAssist={{ campaignId: "campaign-1", surface: "campaign_goal", references: { lead_id: null, draft_id: null, page_revision_id: null } }} onChange={onChange} />));
    await click(button(host, "Suggest changes"));
    await click(button(host, "Accept suggestion"));
    expect(editorText(host).getAttribute("contenteditable")).toBe("false");
    await act(async () => { editorText(host).textContent = "Attempted edit"; editorText(host).dispatchEvent(new Event("input", { bubbles: true })); });
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => { resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })); await Promise.resolve(); await Promise.resolve(); });
    expect(onChange).toHaveBeenLastCalledWith(proposed, expect.objectContaining({ plainText: "Suggested" }));
  });
});
