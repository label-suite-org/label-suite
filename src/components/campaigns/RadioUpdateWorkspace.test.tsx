/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import { deriveCampaignDocument } from "../../lib/campaign-rich-text";
import CampaignOutreachWorkspace from "./CampaignOutreachWorkspace";

const pageContent = {
  label_line: "True Nature", title: "Fountain Edits", release_note: "A note.", artwork_asset_id: "art-1", focus_track_ids: ["track-1"],
  listen_url: "https://example.com/listen", download_url: null, metadata_url: null, contact_name: "Label desk", contact_email: "radio@example.com", network_statement: "Shared with our independent radio network.",
};
const radioData = {
  page: { page: { id: "page-1", campaign_id: "campaign-1", slug: "fountain-edits", status: "draft", current_draft_revision_id: "revision-1", current_published_revision_id: null }, draft: { id: "revision-1", version: 1, content: pageContent, review_status: "reviewed", content_hash: "hash", authored_at: null, reviewed_at: null, created_at: null, updated_at: null }, revisions: [{ id: "revision-1", version: 1, content: pageContent, review_status: "reviewed", content_hash: "hash", authored_at: null, reviewed_at: null, created_at: null, updated_at: null }] },
  artwork_options: [{ id: "art-1", asset_name: "Cover", version: "v1", file_link: "https://example.com/art.jpg", approval_status: "approved" }],
  tracks: [{ id: "track-1", title: "Fountain", audio_url: null, position: 1 }],
  radio_drafts: [],
} as unknown as CampaignOutreachWorkspaceData["radioUpdate"];

function data() {
  return { campaign: { id: "campaign-1", name: "Fountain", linked_release_id: "release-1" }, prompt: null, activity: { items: [], proposals: [], sourceStates: [] }, queue: { now: [], followUp: [], waiting: [], completed: [] }, leads: [], sources: [], dogfood: [], tracks: [], radioUpdate: radioData, unlinked_tasks: [] } as unknown as CampaignOutreachWorkspaceData;
}

const previewProjection = {
  content: { label_line: "True Nature", title: "Fountain Edits", release_note: "A note.", release_note_html: "<h2>A note.</h2>", listen_url: "https://example.com/listen", download_url: null, metadata_url: null, contact_name: "Label desk", contact_email: "radio@example.com", network_statement: "Shared with our independent radio network." },
  artworkUrl: "https://example.com/art.jpg", tracks: [{ title: "Fountain", duration: 180, credits: [] }], releaseDate: null, catalogNumber: null,
  publishedAt: "2026-08-04T10:00:00.000Z", updatedAt: "2026-08-04T10:00:00.000Z",
};

describe("RadioUpdateWorkspace lane", () => {
  let root: Root; let host: HTMLDivElement;
  beforeEach(() => {
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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).includes("/preview") ? previewProjection : { id: "draft-1", version: 1, status: "draft", body: "Manual body", subject: "Manual subject", context_snapshot: { page_revision_id: "revision-1" } }), { status: 201, headers: { "Content-Type": "application/json" } })));
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

  it("keeps Focused selected by default and opens Radio update without a send action", async () => {
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Focused");
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    expect(host.textContent).toContain("Page draft");
    expect(host.textContent).toContain("Create saved first radio version");
    expect(host.textContent).toContain("Creates a persisted radio draft version");
    expect(host.textContent).not.toMatch(/>Send</);
    expect(host.textContent).toContain("Preview · not public · reviewed revision");
    expect(host.textContent).toContain("Fountain Edits");
    const preview = host.querySelector('[aria-label="Authenticated preview · not public"]');
    expect(preview?.textContent).not.toContain("revision-1");
    expect(preview?.textContent).not.toContain("Published");
  });

  it("uses manual-first route and typed approval/publication gates", async () => {
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const body = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    await act(async () => setEditorText(body, "Manual body"));
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement;
    await act(async () => save.click());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/campaigns/campaign-1/radio-update-drafts/manual", expect.anything());
    expect(host.querySelector('input[placeholder="Type publish"]')).not.toBeNull();
    expect(host.querySelector('input[placeholder="Type approve"]')).not.toBeNull();
    expect(host.textContent).toContain("Reviewed preview is available in this editor; it is not public.");
  });

  it("authors the revisioned release note with the Campaign editor and submits canonical document plus derived text", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/preview")) return new Response(JSON.stringify(previewProjection), { status: 200 });
      if (url.endsWith("/public-page") && init?.method === "POST") {
        const submitted = JSON.parse(String(init.body)) as { content: unknown };
        return new Response(JSON.stringify({
          page: { ...radioData.page.page, current_draft_revision_id: "revision-2" },
          revision: { ...radioData.page.revisions[0], id: "revision-2", version: 2, review_status: "draft", content: submitted.content },
        }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());

    const editor = host.querySelector('[role="textbox"][aria-label="Release note"]') as HTMLElement;
    expect(editor).not.toBeNull();
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(host.textContent).toContain("Up to 20,000 characters");
    const heading = [...host.querySelectorAll("button")].find((button) => button.textContent === "Heading 2") as HTMLButtonElement;
    await act(async () => heading.click());

    const review = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Mark page reviewed")) as HTMLButtonElement;
    const publish = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Publish (owner)")) as HTMLButtonElement;
    expect(review.disabled).toBe(true);
    expect(publish.disabled).toBe(true);
    expect(host.textContent).toContain("Unsaved page changes");

    const save = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Save page draft")) as HTMLButtonElement;
    await act(async () => save.click());
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/public-page") && init?.method === "POST");
    const payload = JSON.parse(String(request?.[1]?.body)) as { content: { release_note: string; release_note_document: unknown } };
    expect(payload.content.release_note).toBe("A note.");
    expect(payload.content.release_note_document).toEqual({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A note." }] }],
    });
    expect(review.disabled).toBe(false);
  });

  it("blocks review and publish while structured page fields are unsaved", async () => {
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    vi.mocked(fetch).mockClear();
    const title = [...host.querySelectorAll("input")].find((node) => node.value === "Fountain Edits") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(title, "Changed title"); title.dispatchEvent(new Event("input", { bubbles: true })); });
    const review = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Mark page reviewed")) as HTMLButtonElement;
    const publish = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Publish (owner)")) as HTMLButtonElement;
    const revisionSelector = [...host.querySelectorAll("select")].find((select) => select.value === "revision-1") as HTMLSelectElement;
    expect(review.disabled).toBe(true);
    expect(publish.disabled).toBe(true);
    expect(revisionSelector.disabled).toBe(true);
    expect(host.textContent).toContain("Unsaved page changes");
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("blocks approval while saved email text is dirty", async () => {
    const withDraft = data();
    withDraft.radioUpdate.radio_drafts = [{ id: "draft-1", org_id: "org", campaign_id: "campaign-1", lead_id: null, enrichment_run_id: null, scope: "radio_update", version: 1, status: "draft", subject: "Saved subject", body: "Saved body", context_snapshot: { page_revision_id: "revision-1" }, approval_hash: null, approved_by: null, approved_at: null, created_at: new Date(), updated_at: new Date() }];
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={withDraft} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const body = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    await act(async () => setEditorText(body, "Edited body"));
    const approve = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Approve email draft")) as HTMLButtonElement;
    const revisionSelector = [...host.querySelectorAll("select")].find((select) => select.value === "revision-1") as HTMLSelectElement;
    expect(approve.disabled).toBe(true);
    expect(revisionSelector.disabled).toBe(true);
    expect(host.textContent).toContain("Unsaved email changes");
    expect(host.querySelectorAll('[aria-label="AI assist"]')).toHaveLength(2);
    expect([...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Create saved first radio version"))).toBeUndefined();
    expect(host.textContent).not.toContain("Operator instruction (optional)");
  });

  it("refreshes the persisted page baseline after the first save", async () => {
    const savedRevision = { ...radioData.page.revisions[0], id: "revision-2", version: 2, review_status: "draft" };
    const savedPage = { ...radioData.page.page, slug: "fountain-edits", current_draft_revision_id: "revision-2" };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public-page") && init?.method === "POST") return new Response(JSON.stringify({ page: savedPage, revision: savedRevision }), { status: 200 });
      if (url.includes("/preview")) return new Response(JSON.stringify(previewProjection), { status: 200 });
      return new Response(JSON.stringify({ id: "draft-1", version: 1, status: "draft", body: "Manual body", subject: "Manual subject", context_snapshot: { page_revision_id: "revision-1" } }), { status: 201 });
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save page draft")) as HTMLButtonElement;
    await act(async () => save.click());
    const review = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Mark page reviewed")) as HTMLButtonElement;
    expect(review.disabled).toBe(false);
    expect(host.textContent).toContain("Page draft v2 saved");
  });

  it("adopts the server-normalized slug after saving a noncanonical slug", async () => {
    const savedRevision = { ...radioData.page.revisions[0], id: "revision-2", version: 2, review_status: "draft" };
    const savedPage = { ...radioData.page.page, slug: "fountain-edits", current_draft_revision_id: "revision-2" };
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public-page") && init?.method === "POST") return new Response(JSON.stringify({ page: savedPage, revision: savedRevision }), { status: 200 });
      if (url.includes("/preview")) return new Response(JSON.stringify(previewProjection), { status: 200 });
      return new Response(JSON.stringify({ id: "draft-1", version: 1, status: "draft", body: "Manual body", subject: "Manual subject", context_snapshot: { page_revision_id: "revision-1" } }), { status: 201 });
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const slugInput = [...host.querySelectorAll("input")].find((node) => node.value === "fountain-edits") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(slugInput, "Fountain Edits"); slugInput.dispatchEvent(new Event("input", { bubbles: true })); });
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save page draft")) as HTMLButtonElement;
    await act(async () => save.click());
    const review = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Mark page reviewed")) as HTMLButtonElement;
    expect(review.disabled).toBe(false);
    expect(slugInput.value).toBe("fountain-edits");
  });

  it("marks first-draft email edits dirty before a matching draft exists", async () => {
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const subject = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Subject"))?.querySelector("input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(subject, "First subject"); subject.dispatchEvent(new Event("input", { bubbles: true })); });
    const body = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    await act(async () => setEditorText(body, "First body"));
    const revisionSelector = [...host.querySelectorAll("select")].find((select) => select.value === "revision-1") as HTMLSelectElement;
    expect(revisionSelector.disabled).toBe(true);
    expect(host.textContent).toContain("Unsaved email changes");
  });

  it("submits formatted radio email copy as a canonical document and keeps the reviewed-page dependency", async () => {
    const withDraft = data();
    withDraft.radioUpdate.radio_drafts = [{ id: "draft-1", org_id: "org", campaign_id: "campaign-1", lead_id: null, enrichment_run_id: null, scope: "radio_update", version: 1, status: "draft", subject: "Saved subject", body: "Saved body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved body" }] }] }, context_snapshot: { page_revision_id: "revision-1" }, approval_hash: null, approved_by: null, approved_at: null, created_at: new Date(), updated_at: new Date() }];
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={withDraft} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const editor = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    expect(editor).not.toBeNull();
    editor.innerHTML = "<p><em>Saved body</em></p>";
    await act(async () => editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "!" })));
    expect(host.textContent).toContain("Unsaved email changes");
    expect((([...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Approve email draft")) as HTMLButtonElement)).disabled).toBe(true);
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement;
    await act(async () => save.click());
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/api/campaign-outreach-drafts/draft-1") && init?.method === "PATCH");
    const payload = JSON.parse(String(request?.[1]?.body)) as { body_document: { content: Array<{ content?: Array<{ marks?: unknown }> }> }; body: string };
    expect(payload.body).toBe("Saved body");
    expect(payload).toEqual({
      subject: "Saved subject",
      body: "Saved body",
      body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Saved body", marks: [{ type: "italic" }] }] }] },
    });
  });

  it("keeps a malformed stored radio document read-only until an explicit repair save replaces it", async () => {
    const withMalformedDraft = data();
    withMalformedDraft.radioUpdate.radio_drafts = [{ id: "draft-1", org_id: "org", campaign_id: "campaign-1", lead_id: null, enrichment_run_id: null, scope: "radio_update", version: 1, status: "draft", subject: "Saved subject", body: "Readable legacy body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Readable legacy body" }] }] }, body_document_repair_required: true, context_snapshot: { page_revision_id: "revision-1" }, approval_hash: null, approved_by: null, approved_at: null, created_at: new Date(), updated_at: new Date() }];
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={withMalformedDraft} canMutate canPublish />));
    await act(async () => ([...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement).click());

    const editor = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement;
    expect(host.textContent).toContain("Stored rich text needs repair");
    expect(editor.getAttribute("contenteditable")).not.toBe("true");
    expect(save.disabled).toBe(true);

    await act(async () => [...host.querySelectorAll("button")].find((node) => node.textContent === "Repair and edit draft")?.click());
    expect(editor.getAttribute("contenteditable")).toBe("true");
    await act(async () => setEditorText(editor, "Repaired radio body"));
    await act(async () => save.click());
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/campaign-outreach-drafts/draft-1") && init?.method === "PATCH");
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ body: "Repaired radio body", body_document: { type: "doc" } });
  });

  it("converts provider legacy radio text into a canonical document before manual save", async () => {
    const withDraft = data();
    withDraft.radioUpdate.radio_drafts = [];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/preview")) return new Response(JSON.stringify(previewProjection), { status: 200 });
      if (url.endsWith("/radio-update-drafts") && init?.method === "POST") return new Response(JSON.stringify({ id: "generated-1", version: 1, status: "draft", body: "Generated radio legacy body", subject: "Generated subject", context_snapshot: { page_revision_id: "revision-1" } }), { status: 201 });
      if (url.endsWith("/campaign-outreach-drafts/generated-1") && init?.method === "PATCH") return new Response(JSON.stringify({ id: "saved-2", version: 2, status: "draft", body: "Generated radio legacy body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Generated radio legacy body" }] }] }, subject: "Generated subject", context_snapshot: { page_revision_id: "revision-1" } }), { status: 201 });
      return new Response("{}", { status: 200 });
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={withDraft} canMutate canPublish />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const generate = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Create saved first radio version")) as HTMLButtonElement;
    await act(async () => generate.click());
    const editor = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    expect(editor.textContent).toContain("Generated radio legacy body");
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement;
    await act(async () => save.click());
    const request = vi.mocked(fetch).mock.calls.find(([url, init]) => String(url).endsWith("/campaign-outreach-drafts/generated-1") && init?.method === "PATCH");
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ subject: "Generated subject", body: "Generated radio legacy body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Generated radio legacy body" }] }] } });
  });

  it("keeps radio email actions gated by an unreviewed page revision", async () => {
    const unreviewed = structuredClone(data());
    unreviewed.radioUpdate.page.draft!.review_status = "draft";
    unreviewed.radioUpdate.page.revisions[0].review_status = "draft";
    unreviewed.radioUpdate.radio_drafts = [{ id: "draft-1", org_id: "org", campaign_id: "campaign-1", lead_id: null, enrichment_run_id: null, scope: "radio_update", version: 1, status: "draft", subject: "Ready subject", body: "Ready body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ready body" }] }] }, context_snapshot: { page_revision_id: "revision-1" }, approval_hash: null, approved_by: null, approved_at: null, created_at: new Date(), updated_at: new Date() }];
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/public-page/review") && init?.method === "POST") return new Response(JSON.stringify({ revision: { ...radioData.page.revisions[0], review_status: "reviewed" } }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={unreviewed} canMutate canPublish />));
    await act(async () => ([...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement).click());
    expect((host.querySelector('button') as HTMLButtonElement)).toBeTruthy();
    const generate = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Create saved first radio version")) as HTMLButtonElement;
    const save = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement;
    const approve = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Approve email draft")) as HTMLButtonElement;
    const review = [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Mark page reviewed")) as HTMLButtonElement;
    expect(generate).toBeUndefined();
    expect(save.disabled).toBe(true);
    expect(approve.disabled).toBe(true);
    expect(review.disabled).toBe(false);
    expect(host.querySelectorAll('[aria-label="AI assist"]')).toHaveLength(0);
    await act(async () => review.click());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/campaigns/campaign-1/public-page/review", expect.objectContaining({ method: "POST" }));
    expect(save.disabled).toBe(false);
    expect(approve.disabled).toBe(false);
  });

  it("locks revision switching while an AI decision is in flight so accepted copy remains with its proposed radio owner", async () => {
    const withDraft = structuredClone(data());
    const draft = { id: "draft-1", org_id: "org", campaign_id: "campaign-1", lead_id: null, enrichment_run_id: null, scope: "radio_update" as const, version: 1, status: "draft" as const, subject: "Saved subject", body: "Saved body", body_document: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Saved body" }] }] }, context_snapshot: { page_revision_id: "revision-1" }, approval_hash: null, approved_by: null, approved_at: null, created_at: new Date(), updated_at: new Date() };
    withDraft.radioUpdate.radio_drafts = [draft];
    withDraft.radioUpdate.page.revisions.push({ ...withDraft.radioUpdate.page.revisions[0]!, id: "revision-2", version: 2 });
    let resolveDecision: ((response: Response) => void) | undefined;
    const proposal = {
      run_id: "run-1", input_document_hash: deriveCampaignDocument(draft.body_document, 10_000).hash,
      proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "AI radio body" }] }] }, rationale: "Clearer radio copy.", citation_ids: [], status: "ready",
      comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Saved body", proposed: "AI radio body" }] },
      display: { provider: "openrouter", model: "safe-model", context_manifest: {}, citations: [] },
    };
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("campaign-editor-ai-runs/run-1")) return new Promise<Response>((resolve) => { resolveDecision = resolve; });
      if (url.includes("/editor-ai-runs")) return Promise.resolve(new Response(JSON.stringify(proposal), { status: 201, headers: { "Content-Type": "application/json" } }));
      if (url.includes("/preview")) return Promise.resolve(new Response(JSON.stringify(previewProjection), { status: 200 }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={withDraft} canMutate canPublish />));
    await act(async () => ([...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement).click());
    const radioEditor = host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    const radioAssist = radioEditor.closest("section")?.querySelector('[aria-label="AI assist"]') as HTMLElement;
    await act(async () => [...radioAssist.querySelectorAll("button")].find((node) => node.textContent === "Suggest changes")?.click());
    await act(async () => [...radioAssist.querySelectorAll("button")].find((node) => node.textContent === "Accept suggestion")?.click());

    const revisionSelector = [...host.querySelectorAll("select")].find((select) => select.value === "revision-1") as HTMLSelectElement;
    expect(revisionSelector.disabled).toBe(true);
    const focusedTab = host.querySelector('#outreach-tab-focused') as HTMLButtonElement;
    expect(focusedTab.disabled).toBe(true);
    expect(([...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save manual version")) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => focusedTab.click());
    expect(host.querySelector('[role="textbox"][aria-label="Radio email body"]')).not.toBeNull();
    await act(async () => resolveDecision?.(new Response(JSON.stringify({ run_id: "run-1", status: "accepted" }), { status: 200, headers: { "Content-Type": "application/json" } })));

    expect(revisionSelector.value).toBe("revision-1");
    expect((host.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement).textContent).toContain("AI radio body");
    expect(( [...host.querySelectorAll("button")].find((node) => node.textContent?.includes("Save page draft")) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the radio editor read-only and its lane width-constrained on narrow screens", async () => {
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={data()} canMutate={false} canPublish={false} />));
    const radio = [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent?.includes("Radio update")) as HTMLButtonElement;
    await act(async () => radio.click());
    const panel = host.querySelector('[role="tabpanel"][aria-labelledby="outreach-tab-radio"]') as HTMLElement;
    const editor = panel.querySelector('[role="textbox"][aria-label="Radio email body"]') as HTMLElement;
    expect(editor.getAttribute("contenteditable")).not.toBe("true");
    vi.mocked(fetch).mockClear();
    const before = editor.textContent;
    editor.dispatchEvent(new KeyboardEvent("keydown", { key: "x", bubbles: true }));
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "x" }));
    expect(editor.textContent).toBe(before);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect((panel.querySelector('button') as HTMLButtonElement).disabled).toBe(true);
    expect(panel.querySelector('[aria-label="Radio update operator desk"]')?.className).toContain("min-w-0");
    for (const width of [320, 390]) {
      host.style.width = `${width}px`;
      expect(panel.querySelector('section[aria-labelledby="radio-page-title"]')?.className).toContain("min-w-0");
      expect(panel.querySelector('section[aria-labelledby="radio-email-title"]')?.className).toContain("min-w-0");
      expect(panel.querySelector('section[aria-labelledby="radio-audience-title"]')?.className).toContain("min-w-0");
    }
  });
});

function setEditorText(editor: HTMLElement, text: string) {
  editor.innerHTML = `<p>${text}</p>`;
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}
