import { describe, expect, it } from "vitest";
import type { CampaignDocument } from "../lib/campaign-rich-text";
import {
  buildEditorAiContext,
  buildEditorAiProviderInput,
  buildEditorAiProposal,
  hashCampaignEditorDocument,
  createCampaignEditorAiRunSchema,
  decideProposal,
  extractSelectedDocument,
  replaceSelectedDocument,
} from "./campaign-editor-ai-core";

const doc = (...texts: string[]): CampaignDocument => ({
  type: "doc",
  content: texts.map((text) => ({
    type: "paragraph" as const,
    content: text ? [{ type: "text" as const, text }] : [],
  })),
});

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    campaign: { id: "campaign-1", name: "Fountain", goal: "Earn airplay", notes: "Keep it focused" },
    release: { id: "release-1", title: "Fountain Edits", artist_name: "Nature Boy", track_titles: ["Fountain", "Fountain (Dub)"] },
    lead: { id: "lead-1", target_name: "NTS", musical_fit: "Leftfield electronic", pitch_angle: "Offer the dub" },
    prompt: { id: "prompt-1", version: 2, text: "Write plainly" },
    research: [
      { id: "pending-1", status: "pending", value: "pending fact", rationale: "not reviewed", citation_ids: ["cite-pending"], evidence: [{ id: "cite-pending", title: "Pending", url: "https://example.test/pending", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "pending" }] },
      { id: "accepted-1", status: "accepted", value: "accepted fact", rationale: "operator accepted", citation_ids: ["cite-1"], evidence: [{ id: "cite-1", title: "Accepted source", url: "https://example.test/accepted", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "accepted" }] },
      { id: "uncited-1", status: "accepted", value: "uncited fact", rationale: "no source", citation_ids: [] },
    ],
    ...overrides,
  };
}

describe("campaign editor AI bounded context", () => {
  it("projects only authorized fields and accepted cited research", () => {
    const context = buildEditorAiContext(fixture({ secret: "must not leak" }));
    expect(context).toMatchObject({ campaign: fixture().campaign, release: fixture().release, lead: fixture().lead, prompt: fixture().prompt });
    expect(context.accepted_research).toEqual([{ id: "accepted-1", value: "accepted fact", rationale: "operator accepted", citation_ids: ["cite-1"] }]);
    expect(JSON.stringify(context)).not.toContain("pending fact");
    expect(JSON.stringify(context)).not.toContain("uncited fact");
    expect(JSON.stringify(context)).not.toContain("must not leak");
  });

  it.each([
    ["campaign_goal", { lead_id: null, draft_id: null, page_revision_id: null }],
    ["campaign_notes", { lead_id: null, draft_id: null, page_revision_id: null }],
    ["public_release_note", { lead_id: null, draft_id: null, page_revision_id: "revision-1" }],
    ["focused_outreach_body", { lead_id: "lead-1", draft_id: "draft-1", page_revision_id: null }],
    ["radio_update_body", { lead_id: null, draft_id: "draft-1", page_revision_id: "revision-1" }],
  ])("enforces ownership for %s", (surface, ids) => {
    const parsed = createCampaignEditorAiRunSchema.parse({
      surface,
      operation: "improve",
      scope: "document",
      selection: null,
      current_document: doc("Current"),
      input_document_hash: hashCampaignEditorDocument(doc("Current"), surface as never),
      instruction: null,
      ...ids,
    });
    expect(parsed.surface).toBe(surface);
  });

  it("rejects wrong IDs and overlong instructions", () => {
    expect(() => createCampaignEditorAiRunSchema.parse({
      surface: "campaign_goal", operation: "draft", scope: "document", selection: null,
      current_document: doc("Current"), input_document_hash: hashCampaignEditorDocument(doc("Current"), "campaign_goal"), instruction: null,
      lead_id: "lead-1", draft_id: null, page_revision_id: null,
    })).toThrow(/surface|lead/i);
    expect(() => createCampaignEditorAiRunSchema.parse({
      surface: "campaign_notes", operation: "custom", scope: "document", selection: null,
      current_document: doc("Current"), input_document_hash: "hash", instruction: "x".repeat(501),
      lead_id: null, draft_id: null, page_revision_id: null,
    })).toThrow(/instruction/i);
  });

  it("requires both domain owners for focused and radio surfaces", () => {
    const base = { operation: "draft", scope: "document", selection: null, current_document: doc("Current"), input_document_hash: hashCampaignEditorDocument(doc("Current"), "focused_outreach_body"), instruction: null } as const;
    expect(() => createCampaignEditorAiRunSchema.parse({ ...base, surface: "focused_outreach_body", lead_id: "lead-1", draft_id: null, page_revision_id: null })).toThrow(/draft/i);
    expect(() => createCampaignEditorAiRunSchema.parse({ ...base, surface: "focused_outreach_body", lead_id: "lead-1", draft_id: "draft-1", page_revision_id: "revision-1" })).toThrow(/page/i);
    expect(() => createCampaignEditorAiRunSchema.parse({ ...base, surface: "radio_update_body", lead_id: null, draft_id: null, page_revision_id: "revision-1" })).toThrow(/draft/i);
    expect(() => createCampaignEditorAiRunSchema.parse({ ...base, surface: "radio_update_body", lead_id: "lead-1", draft_id: "draft-1", page_revision_id: "revision-1" })).toThrow(/lead/i);
  });
});

describe("campaign editor AI document scope", () => {
  it("verifies the exact current document hash before building provider input", () => {
    const current = doc("Current");
    expect(() => buildEditorAiProviderInput({
      surface: "campaign_goal", operation: "improve", scope: "document", selection: null,
      current_document: current, input_document_hash: "not-the-hash", instruction: null,
      lead_id: null, draft_id: null, page_revision_id: null,
    }, fixture())).toThrow(/hash/i);
    const canonicalHash = hashCampaignEditorDocument(current, "campaign_goal");
    expect(() => buildEditorAiProviderInput({
      surface: "campaign_goal", operation: "improve", scope: "document", selection: null,
      current_document: current, input_document_hash: ` ${canonicalHash} `, instruction: null,
      lead_id: null, draft_id: null, page_revision_id: null,
    }, fixture())).toThrow(/hash|sha/i);
  });

  it("requires null selection for document scope and gives provider no mutation/tool fields", () => {
    const current = doc("Current");
    const input = buildEditorAiProviderInput({
      surface: "campaign_goal", operation: "improve", scope: "document", selection: null,
      current_document: current, input_document_hash: buildEditorAiProviderInput.hashFor(current, "campaign_goal"), instruction: null,
      lead_id: null, draft_id: null, page_revision_id: null,
    }, fixture());
    expect(input.selected_document).toBeNull();
    expect(Object.keys(input).sort()).toEqual(["context", "current_document", "instruction", "operation", "scope", "selected_document", "surface"]);
  });
});

describe("campaign editor AI selection replacement", () => {
  it("extracts and replaces a selected ProseMirror slice", () => {
    const current = doc("First line", "Second line");
    const selection = { from: 1, to: 6 };
    expect(extractSelectedDocument(current, selection)).toEqual(doc("First"));
    expect(replaceSelectedDocument(current, selection, doc("New"))).toEqual(doc("New line", "Second line"));
  });

  it("preserves marks and open cross-paragraph context", () => {
    const current: CampaignDocument = { type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "hello ", marks: [{ type: "bold" }] }, { type: "text", text: "world" }] },
      { type: "paragraph", content: [{ type: "text", text: "second" }] },
    ] };
    const selected = extractSelectedDocument(current, { from: 3, to: 18 });
    expect(selected).toEqual({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "llo ", marks: [{ type: "bold" }] }, { type: "text", text: "world" }] },
      { type: "paragraph", content: [{ type: "text", text: "seco" }] },
    ] });
    expect(replaceSelectedDocument(current, { from: 3, to: 18 }, doc("New first", "New second"))).toEqual({ type: "doc", content: [
      { type: "paragraph", content: [{ type: "text", text: "he", marks: [{ type: "bold" }] }, { type: "text", text: "New first" }] },
      { type: "paragraph", content: [{ type: "text", text: "New secondnd" }] },
    ] });
  });

  it("replaces top-level cross-paragraph and wholly interior ranges inline", () => {
    const current = doc("one", "two");
    expect(extractSelectedDocument(current, { from: 2, to: 5 })).toEqual(doc("ne"));
    expect(replaceSelectedDocument(current, { from: 2, to: 5 }, doc("X"))).toEqual(doc("oX", "two"));
    expect(extractSelectedDocument(doc("hello"), { from: 2, to: 4 })).toEqual(doc("el"));
    expect(replaceSelectedDocument(doc("hello"), { from: 2, to: 4 }, doc("X"))).toEqual(doc("hXlo"));
  });

  it("preserves nested list-item selections and rejects incompatible replacements", () => {
    const current: CampaignDocument = { type: "doc", content: [
      { type: "bulletList", content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "tail" }] },
    ] };
    const selection = { from: 2, to: 14 };
    expect(extractSelectedDocument(current, selection)).toEqual({ type: "doc", content: [{ type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "first" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "se" }] }] },
    ] }] });
    expect(replaceSelectedDocument(current, selection, { type: "doc", content: [{ type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "more" }] }] },
    ] }] })).toEqual({ type: "doc", content: [{ type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "morecond" }] }] },
    ] }, { type: "paragraph", content: [{ type: "text", text: "tail" }] }] });
    expect(() => replaceSelectedDocument(current, { from: 3, to: 9 }, doc("wrong"))).toThrow(/compatible|list/i);
  });

  it("keeps list-to-paragraph boundaries and ordered-list start attributes", () => {
    const current: CampaignDocument = { type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "tail" }] },
    ] };
    const boundary = { from: 2, to: 11 };
    expect(extractSelectedDocument(current, boundary)).toEqual({ type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "t" }] },
    ] });
    expect(replaceSelectedDocument(current, boundary, { type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "tail replacement" }] },
    ] })).toEqual({ type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "new" }] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "tail replacementail" }] },
    ] });

    const ordered: CampaignDocument = { type: "doc", content: [{ type: "orderedList", attrs: { start: 4 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] },
    ] }] };
    expect(extractSelectedDocument(ordered, { from: 2, to: 14 })).toEqual({ type: "doc", content: [{ type: "orderedList", attrs: { start: 4 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "seco" }] }] },
    ] }] });
    expect(() => replaceSelectedDocument(current, boundary, doc("incompatible"))).toThrow(/compatible|context/i);
  });

  it("replaces a nested interior inline slice inside its existing list item", () => {
    const current: CampaignDocument = { type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [
        { type: "text", text: "first", marks: [{ type: "italic" }] },
      ] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "tail", marks: [{ type: "bold" }] }] },
    ] };
    const selection = { from: 2, to: 5 };
    expect(extractSelectedDocument(current, selection)).toEqual({ type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "fi", marks: [{ type: "italic" }] },
    ] }] });
    expect(replaceSelectedDocument(current, selection, doc("NEW"))).toEqual({ type: "doc", content: [
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [
        { type: "text", text: "NEW" },
        { type: "text", text: "rst", marks: [{ type: "italic" }] },
      ] }] }] },
      { type: "paragraph", content: [{ type: "text", text: "tail", marks: [{ type: "bold" }] }] },
    ] });
    expect(() => replaceSelectedDocument(current, selection, { type: "doc", content: [{ type: "bulletList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "wrapped" }] }] },
    ] }] })).toThrow(/compatible|inline|context/i);
  });

  it("preserves whether ordered-list start was explicitly represented", () => {
    const omitted: CampaignDocument = { type: "doc", content: [{ type: "orderedList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
    ] }] };
    expect(extractSelectedDocument(omitted, { from: 1, to: 4 })).toEqual({ type: "doc", content: [{ type: "orderedList", content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "o" }] }] },
    ] }] });
    const explicit = { ...omitted, content: [{ ...omitted.content[0], attrs: { start: 1 } }] } as CampaignDocument;
    expect(extractSelectedDocument(explicit, { from: 1, to: 4 })).toEqual({ type: "doc", content: [{ type: "orderedList", attrs: { start: 1 }, content: [
      { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "o" }] }] },
    ] }] });
  });

  it.each([
    { from: 6, to: 1 },
    { from: 1, to: 1 },
    { from: 0, to: 2 },
    { from: 1, to: 999 },
  ])("rejects invalid selection %#", (selection) => {
    expect(() => extractSelectedDocument(doc("First"), selection)).toThrow(/selection/i);
  });

  it("validates and stores a complete proposal, reporting changed top-level blocks", () => {
    const current = doc("First", "Second");
    const result = buildEditorAiProposal({
      request: {
        surface: "campaign_goal", operation: "improve", scope: "selection", selection: { from: 1, to: 6 },
        current_document: current, input_document_hash: buildEditorAiProviderInput.hashFor(current, "campaign_goal"), instruction: null,
        lead_id: null, draft_id: null, page_revision_id: null,
      },
      authorizedContext: fixture(),
      providerResult: { replacement_document: doc("New"), rationale: "Clearer", citation_ids: [] },
    });
    expect(result.proposed_document).toEqual(doc("New", "Second"));
    expect(result.changed_top_level_block_indexes).toEqual([0]);
    expect(result.comparison).toMatchObject({ changed_top_level_block_indexes: [0], before_label: "Current", proposed_label: "Proposed" });
    expect(result.input_document_hash).toBe(hashCampaignEditorDocument(current, "campaign_goal"));
  });
});

describe("campaign editor AI research boundary", () => {
  it("extracts only authorized nested strings and evidence-backed citation IDs", () => {
    const context = buildEditorAiContext(fixture({ research: [
      { id: "nested", status: "accepted", suggested_value: { value: "safe value", rationale: "safe rationale", contact_route: "secret@example.com", nested: { token: "secret-token" } }, evidence: [{ id: "cite-good", title: "Good", url: "https://example.test/good", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "Good source" }], citation_ids: ["cite-good"] },
      { id: "bad-time", status: "accepted", value: "bad time", rationale: "bad", citation_ids: ["cite-bad-time"], evidence: [{ id: "cite-bad-time", title: "Bad", url: "https://example.test/bad", retrieved_at: "not-a-date", citation_text: "Bad" }] },
      { id: "bad-url", status: "accepted", value: "bad url", rationale: "bad", citation_ids: ["cite-bad-url"], evidence: [{ id: "cite-bad-url", title: "Bad", url: "javascript:alert(1)", retrieved_at: "2026-08-08T10:00:00.000Z", citation_text: "Bad" }] },
      { id: "unbacked", status: "accepted", value: "unbacked", rationale: "bad", citation_ids: ["cite-unbacked"], evidence: [] },
    ] }));
    expect(context.accepted_research).toEqual([{ id: "nested", value: "safe value", rationale: "safe rationale", citation_ids: ["cite-good"] }]);
    expect(JSON.stringify(context)).not.toContain("secret@example.com");
    expect(JSON.stringify(context)).not.toContain("secret-token");
  });
});

describe("campaign editor AI decisions", () => {
  it("allows decisions only while ready and marks hash mismatches stale", () => {
    expect(decideProposal({ storedHash: "a".repeat(64), currentHash: "b".repeat(64), decision: "accepted", currentStatus: "ready" })).toEqual({ status: "stale" });
    expect(decideProposal({ storedHash: "a".repeat(64), currentHash: "a".repeat(64), decision: "accepted", currentStatus: "ready" })).toEqual({ status: "accepted" });
    expect(decideProposal({ storedHash: "a".repeat(64), currentHash: "a".repeat(64), decision: "rejected", currentStatus: "running" })).toEqual({ status: "invalid" });
    expect(() => decideProposal({ storedHash: "a".repeat(64), currentHash: "a".repeat(64), decision: "accepted" } as never)).toThrow(/status/i);
    expect(() => decideProposal({ storedHash: "x", currentHash: "x", decision: "accepted", currentStatus: "ready" })).toThrow(/hash/i);
  });
});
