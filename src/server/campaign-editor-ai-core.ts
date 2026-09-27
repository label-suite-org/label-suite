import { Fragment, Node as ProseMirrorNode, ResolvedPos, Schema, Slice } from "@tiptap/pm/model";
import { z } from "zod";
import {
  deriveCampaignDocument,
  parseCampaignDocument,
  type CampaignDocument,
} from "../lib/campaign-rich-text";
import type {
  CampaignEditorAiProviderInput,
  CampaignEditorOperation,
  CampaignEditorScope,
  CampaignEditorSurface,
} from "./campaign-editor-ai-provider";

export type { CampaignEditorOperation, CampaignEditorScope, CampaignEditorSurface } from "./campaign-editor-ai-provider";
export type { CampaignEditorAiProvider, CampaignEditorAiProviderInput } from "./campaign-editor-ai-provider";

export interface CampaignEditorSelection {
  from: number;
  to: number;
}

export type CampaignEditorAiRunStatus = "running" | "ready" | "accepted" | "rejected" | "failed" | "stale";

export interface CreateCampaignEditorAiRunInput {
  surface: CampaignEditorSurface;
  operation: CampaignEditorOperation;
  scope: CampaignEditorScope;
  selection: CampaignEditorSelection | null;
  current_document: CampaignDocument;
  input_document_hash: string;
  instruction: string | null;
  lead_id: string | null;
  draft_id: string | null;
  page_revision_id: string | null;
}

export interface CampaignEditorAiAuthorizedContext {
  campaign: { id: string; name: string; goal: string; notes: string };
  release: { id: string; title: string; artist_name: string | null; track_titles: string[] } | null;
  lead: { id: string; target_name: string; musical_fit: string | null; pitch_angle: string | null } | null;
  prompt: { id: string; version: number; text: string } | null;
  research?: readonly CampaignEditorResearchSuggestion[];
  accepted_research?: readonly CampaignEditorResearchSuggestion[];
  [key: string]: unknown;
}

export interface CampaignEditorResearchSuggestion {
  id: string;
  status?: string;
  value?: string;
  suggested_value?: unknown;
  rationale?: string | null;
  citation_ids?: readonly string[];
  evidence?: readonly {
    id?: string;
    title?: string;
    url?: string;
    retrieved_at?: string;
    citation_text?: string;
  }[];
}

export interface CampaignEditorAiProposal {
  input_document_hash: string;
  proposed_document: CampaignDocument;
  rationale: string;
  citation_ids: string[];
  status: "ready";
  changed_top_level_block_indexes: number[];
  comparison: CampaignEditorComparison;
}

export interface CampaignEditorComparison {
  before_label: "Current";
  proposed_label: "Proposed";
  changed_top_level_block_indexes: number[];
  blocks: Array<{ index: number; changed: boolean; before: string; proposed: string }>;
}

export const campaignEditorSurfaceSchema = z.enum([
  "campaign_goal",
  "campaign_notes",
  "public_release_note",
  "focused_outreach_body",
  "radio_update_body",
]);
export const campaignEditorOperationSchema = z.enum(["draft", "enrich", "improve", "shorten", "tone", "custom"]);
export const campaignEditorScopeSchema = z.enum(["selection", "document"]);
export const campaignEditorSelectionSchema = z.object({ from: z.number().int(), to: z.number().int() }).strict();
export const campaignDocumentSchema = z.custom<CampaignDocument>((value) => {
  if (!value || typeof value !== "object") return false;
  try {
    parseCampaignDocument(value, 20_000);
    return true;
  } catch {
    return false;
  }
}, { message: "Invalid campaign editor document" });

export const createCampaignEditorAiRunSchema = z.object({
  surface: campaignEditorSurfaceSchema,
  operation: campaignEditorOperationSchema,
  scope: campaignEditorScopeSchema,
  selection: campaignEditorSelectionSchema.nullable(),
  current_document: campaignDocumentSchema,
  input_document_hash: z.string().regex(/^[a-f0-9]{64}$/, "Input document hash must be canonical lowercase SHA-256"),
  instruction: z.string().trim().max(500).nullable(),
  lead_id: z.string().trim().min(1).nullable(),
  draft_id: z.string().trim().min(1).nullable(),
  page_revision_id: z.string().trim().min(1).nullable(),
}).strict().superRefine((value, context) => {
  if (value.scope === "document" && value.selection !== null) {
    context.addIssue({ code: "custom", path: ["selection"], message: "Document scope requires a null selection" });
  }
  if (value.scope === "selection" && value.selection === null) {
    context.addIssue({ code: "custom", path: ["selection"], message: "Selection scope requires a selection" });
  }
  if (value.selection && (value.selection.from < 1 || value.selection.to <= value.selection.from)) {
    context.addIssue({ code: "custom", path: ["selection"], message: "Selection must be a non-empty forward range" });
  }

  const noLead = value.lead_id === null;
  const noDraft = value.draft_id === null;
  const noPage = value.page_revision_id === null;
  switch (value.surface) {
    case "campaign_goal":
    case "campaign_notes":
      if (!noLead || !noDraft || !noPage) context.addIssue({ code: "custom", path: ["surface"], message: `${value.surface} cannot reference a lead, draft, or page revision` });
      break;
    case "public_release_note":
      if (!noLead || !noDraft || noPage) context.addIssue({ code: "custom", path: ["page_revision_id"], message: "Public release notes require only a page revision" });
      break;
    case "focused_outreach_body":
      // The focused lane is owned by a lead; it never belongs to a page.
      if (noLead || noDraft || !noPage) context.addIssue({ code: "custom", path: ["lead_id"], message: "Focused outreach requires a lead and draft, with no page revision" });
      break;
    case "radio_update_body":
      if (!noLead || noDraft || noPage) context.addIssue({ code: "custom", path: ["page_revision_id"], message: "Radio updates require a draft and page revision, with no lead" });
      break;
  }
});

export const campaignEditorAiRunSchema = createCampaignEditorAiRunSchema;

export const decideCampaignEditorAiProposalSchema = z.object({
  storedHash: z.string().regex(/^[a-f0-9]{64}$/, "Stored hash must be canonical lowercase SHA-256"),
  currentHash: z.string().regex(/^[a-f0-9]{64}$/, "Current hash must be canonical lowercase SHA-256"),
  decision: z.enum(["accepted", "rejected"]),
  currentStatus: z.enum(["running", "ready", "accepted", "rejected", "failed", "stale"]),
}).strict();
export const decideProposalSchema = decideCampaignEditorAiProposalSchema;

export const campaignEditorAiProviderResultSchema = z.object({
  replacement_document: campaignDocumentSchema,
  rationale: z.string().trim().min(1).max(2_000),
  citation_ids: z.array(z.string().trim().min(1)).max(32),
}).strict();

function maxCharactersForSurface(surface: CampaignEditorSurface): 10_000 | 20_000 {
  return surface === "focused_outreach_body" || surface === "radio_update_body" ? 10_000 : 20_000;
}

export function hashCampaignEditorDocument(document: CampaignDocument, surface: CampaignEditorSurface): string {
  return deriveCampaignDocument(document, maxCharactersForSurface(surface)).hash;
}

export function buildEditorAiContext(input: CampaignEditorAiAuthorizedContext): CampaignEditorAiProviderInput["context"] {
  const research = input.accepted_research ?? input.research ?? [];
  return {
    campaign: {
      id: input.campaign.id,
      name: input.campaign.name,
      goal: input.campaign.goal,
      notes: input.campaign.notes,
    },
    release: input.release ? {
      id: input.release.id,
      title: input.release.title,
      artist_name: input.release.artist_name,
      track_titles: [...input.release.track_titles],
    } : null,
    lead: input.lead ? {
      id: input.lead.id,
      target_name: input.lead.target_name,
      musical_fit: input.lead.musical_fit,
      pitch_angle: input.lead.pitch_angle,
    } : null,
    prompt: input.prompt ? {
      id: input.prompt.id,
      version: input.prompt.version,
      text: input.prompt.text,
    } : null,
    accepted_research: research.flatMap((suggestion) => {
      if (input.accepted_research ? suggestion.status !== undefined && suggestion.status !== "accepted" : suggestion.status !== "accepted") return [];
      const citationIds = usableCitationIds(suggestion);
      const value = authorizedResearchValue(suggestion);
      const rationale = authorizedResearchRationale(suggestion);
      if (!value || !rationale || citationIds.length === 0) return [];
      return [{ id: suggestion.id, value, rationale, citation_ids: citationIds }];
    }),
  };
}

function authorizedResearchValue(suggestion: CampaignEditorResearchSuggestion): string {
  if (typeof suggestion.value === "string") return suggestion.value.trim();
  if (typeof suggestion.suggested_value === "string") return suggestion.suggested_value.trim();
  if (suggestion.suggested_value && typeof suggestion.suggested_value === "object" && !Array.isArray(suggestion.suggested_value)) {
    const value = (suggestion.suggested_value as { value?: unknown }).value;
    return typeof value === "string" ? value.trim() : "";
  }
  return "";
}

function authorizedResearchRationale(suggestion: CampaignEditorResearchSuggestion): string {
  if (typeof suggestion.rationale === "string") return suggestion.rationale.trim();
  if (suggestion.suggested_value && typeof suggestion.suggested_value === "object" && !Array.isArray(suggestion.suggested_value)) {
    const rationale = (suggestion.suggested_value as { rationale?: unknown }).rationale;
    return typeof rationale === "string" ? rationale.trim() : "";
  }
  return "";
}

function usableCitationIds(suggestion: CampaignEditorResearchSuggestion): string[] {
  const direct = new Set((suggestion.citation_ids ?? []).filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim()));
  return (suggestion.evidence ?? []).flatMap((evidence) => {
    if (typeof evidence.id !== "string" || !evidence.id.trim()) return [];
    if (!evidence.title?.trim() || !evidence.url?.trim() || !evidence.citation_text?.trim()) return [];
    if (!evidence.retrieved_at || Number.isNaN(Date.parse(evidence.retrieved_at))) return [];
    try {
      const url = new URL(evidence.url);
      if (url.protocol !== "http:" && url.protocol !== "https:") return [];
    } catch {
      return [];
    }
    const id = evidence.id.trim();
    return direct.size === 0 || direct.has(id) ? [id] : [];
  });
}

export function buildEditorAiProviderInput(
  rawRequest: CreateCampaignEditorAiRunInput,
  authorizedContext: CampaignEditorAiAuthorizedContext,
): CampaignEditorAiProviderInput {
  const request = createCampaignEditorAiRunSchema.parse(rawRequest);
  const derived = deriveCampaignDocument(request.current_document, maxCharactersForSurface(request.surface));
  if (derived.hash !== request.input_document_hash) throw new Error("Campaign editor document hash does not match current document");
  const selectedDocument = request.selection ? extractSelectedDocument(derived.document, request.selection, request.surface) : null;
  return {
    surface: request.surface,
    operation: request.operation,
    scope: request.scope,
    current_document: derived.document,
    selected_document: selectedDocument,
    instruction: request.instruction,
    context: buildEditorAiContext(authorizedContext),
  };
}

export namespace buildEditorAiProviderInput {
  export const hashFor = hashCampaignEditorDocument;
}

const pmSchema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    heading: { attrs: { level: { default: 2 } }, content: "inline*", group: "block" },
    blockquote: { content: "block+", group: "block" },
    bulletList: { content: "listItem+", group: "block" },
    orderedList: { attrs: { start: { default: 1 } }, content: "listItem+", group: "block" },
    listItem: { content: "paragraph block*" },
    text: { group: "inline" },
    hardBreak: { inline: true, group: "inline", selectable: false },
  },
  marks: {
    bold: {},
    italic: {},
    link: { attrs: { href: {} } },
  },
});

function asPmDocument(document: CampaignDocument): ProseMirrorNode {
  return ProseMirrorNode.fromJSON(pmSchema, document);
}

function isInlineJsonNode(node: unknown): boolean {
  return Boolean(node && typeof node === "object" && (node as { type?: string }).type && ["text", "hardBreak"].includes((node as { type: string }).type));
}

export function extractSelectedDocument(document: CampaignDocument, selection: CampaignEditorSelection, surface: CampaignEditorSurface = "campaign_goal"): CampaignDocument {
  const current = parseCampaignDocument(document, maxCharactersForSurface(surface));
  assertValidSelection(current, selection);
  const pmDocument = asPmDocument(current);
  const $from = pmDocument.resolve(selection.from);
  const slice = pmDocument.slice(selection.from, selection.to);
  const content = slice.content.toJSON() as unknown[];
  if (content.length === 0) throw new RangeError("Campaign editor selection is empty");
  const selected = canonicalizeSelectedSlice(content, nearestListContext($from, current));
  return parseCampaignDocument({ type: "doc", content: selected }, maxCharactersForSurface(surface));
}

type ListContext = { type: "bulletList" | "orderedList"; attrs?: { start: number } };

function canonicalizeSelectedSlice(content: unknown[], listContext: ListContext | null): unknown[] {
  const nodes = content.flatMap((node) => {
    const normalized = normalizePartialSliceNode(node);
    return normalized ? [normalized] : [];
  });
  if (!listContext || nodes.every(isInlineJsonNode)) {
    const blocks = nodes.filter((node) => !isInlineJsonNode(node));
    return blocks.length > 0 ? blocks : [{ type: "paragraph", content: nodes }];
  }

  if (nodes.every((node) => (node as { type?: string }).type === "listItem")) {
    return [{ type: listContext.type, ...(listContext.attrs ? { attrs: listContext.attrs } : {}), content: nodes }];
  }

  const result: unknown[] = [];
  let listItems: unknown[] = [];
  const flushList = () => {
    if (listItems.length > 0) result.push({ type: listContext.type, ...(listContext.attrs ? { attrs: listContext.attrs } : {}), content: listItems });
    listItems = [];
  };
  for (const node of nodes) {
    const type = (node as { type?: string }).type;
    if (type === "listItem") listItems.push(node);
    else {
      flushList();
      result.push(node);
    }
  }
  flushList();
  return result;
}

function normalizePartialSliceNode(input: unknown): unknown | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const node = input as Record<string, unknown>;
  if (node.type === "listItem" && !Array.isArray(node.content)) return null;
  if (Array.isArray(node.content)) {
    return { ...node, content: node.content.flatMap((child) => {
      const normalized = normalizePartialSliceNode(child);
      return normalized ? [normalized] : [];
    }) };
  }
  return { ...node };
}

export function replaceSelectedDocument(
  document: CampaignDocument,
  selection: CampaignEditorSelection,
  replacement: CampaignDocument,
  surface: CampaignEditorSurface = "campaign_goal",
): CampaignDocument {
  const current = parseCampaignDocument(document, maxCharactersForSurface(surface));
  assertValidSelection(current, selection);
  const proposedReplacement = parseCampaignDocument(replacement, maxCharactersForSurface(surface));
  const currentPm = asPmDocument(current);
  const replacementPm = asPmDocument(proposedReplacement);
  const $from = currentPm.resolve(selection.from);
  const $to = currentPm.resolve(selection.to);
  const sourceSlice = currentPm.slice(selection.from, selection.to);
  const sourceListContext = commonListContext($from, $to, current);
  if (sourceSlice.content.childCount > 0 && sourceSlice.content.content.every((node) => node.isInline)) {
    if (replacementPm.content.childCount !== 1 || !replacementPm.firstChild?.isTextblock) {
      throw new TypeError("Provider replacement is incompatible with the selected inline context");
    }
    const replacementSlice = new Slice(replacementPm.firstChild.content, sourceSlice.openStart, sourceSlice.openEnd);
    try {
      const next = currentPm.replace(selection.from, selection.to, replacementSlice);
      return parseCampaignDocument(preserveOrderedListAttrRepresentation(current, next.toJSON()), maxCharactersForSurface(surface));
    } catch (error) {
      throw new TypeError(`Provider replacement is incompatible with the selected context: ${error instanceof Error ? error.message : "invalid slice"}`);
    }
  }
  if (sourceSlice.content.childCount === 0) throw new TypeError("Provider replacement is incompatible with an empty source slice");
  const sourceHasListContext = sourceSlice.content.firstChild?.type.name === "bulletList"
    || sourceSlice.content.firstChild?.type.name === "orderedList"
    || sourceSlice.content.firstChild?.type.name === "listItem"
    || Boolean(sourceListContext && sourceSlice.openStart > 0);
  if ($from.parent.isTextblock && $from.parent === $to.parent) {
    let content: Fragment;
    if (sourceListContext) {
      const replacementList = replacementPm.firstChild;
      if (!replacementList || replacementList.type.name !== sourceListContext.type || (sourceListContext.attrs && replacementList.attrs.start !== sourceListContext.attrs.start) || replacementList.content.childCount !== 1 || replacementList.firstChild?.type.name !== "listItem" || replacementList.firstChild.firstChild?.type.name !== "paragraph") {
        throw new TypeError("Provider replacement is incompatible with the selected list context");
      }
      content = replacementList.firstChild.firstChild.content;
    } else {
      if (replacementPm.content.childCount !== 1 || !replacementPm.firstChild?.isTextblock) throw new TypeError("Provider replacement is incompatible with the selected textblock");
      content = replacementPm.firstChild.content;
    }
    const next = currentPm.replace(selection.from, selection.to, new Slice(content, sourceSlice.openStart, sourceSlice.openEnd));
    return parseCampaignDocument(preserveOrderedListAttrRepresentation(current, next.toJSON()), maxCharactersForSurface(surface));
  }
  try {
    if (sourceHasListContext && sourceListContext && (replacementPm.firstChild?.type.name !== sourceListContext.type || (sourceListContext.attrs && replacementPm.firstChild.attrs.start !== sourceListContext.attrs.start))) throw new TypeError("Provider replacement is incompatible with the selected list context");
    const replacementContent = sourceHasListContext && sourceListContext ? replacementPm.firstChild?.content ?? Fragment.empty : replacementPm.content;
    const replacementSlice = new Slice(replacementContent, sourceSlice.openStart, sourceSlice.openEnd);
    const next = currentPm.replace(selection.from, selection.to, replacementSlice);
    return parseCampaignDocument(preserveOrderedListAttrRepresentation(current, next.toJSON()), maxCharactersForSurface(surface));
  } catch (error) {
    throw new TypeError(`Provider replacement is incompatible with the selected context: ${error instanceof Error ? error.message : "invalid slice"}`);
  }
}

function nearestListContext($position: ResolvedPos, document: CampaignDocument): ListContext | null {
  for (let depth = $position.depth; depth > 0; depth -= 1) {
    const node = $position.node(depth);
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      const sourceNode = originalNodeAtDepth($position, depth, document);
      const attrs = node.type.name === "orderedList" && sourceNode && Object.prototype.hasOwnProperty.call(sourceNode, "attrs")
        ? { start: node.attrs.start }
        : undefined;
      return { type: node.type.name, ...(attrs ? { attrs } : {}) };
    }
  }
  return null;
}

function commonListContext(from: ResolvedPos, to: ResolvedPos, document: CampaignDocument): ListContext | null {
  for (let depth = Math.min(from.depth, to.depth); depth > 0; depth -= 1) {
    const candidate = from.node(depth).type.name;
    if ((candidate === "bulletList" || candidate === "orderedList") && to.node(depth) === from.node(depth)) {
      const sourceNode = originalNodeAtDepth(from, depth, document);
      const attrs = candidate === "orderedList" && sourceNode && Object.prototype.hasOwnProperty.call(sourceNode, "attrs")
        ? { start: from.node(depth).attrs.start }
        : undefined;
      return { type: candidate, ...(attrs ? { attrs } : {}) };
    }
  }
  return null;
}

function originalNodeAtDepth($position: ResolvedPos, depth: number, document: CampaignDocument): Record<string, unknown> | null {
  let node: unknown = document;
  for (let currentDepth = 1; currentDepth <= depth; currentDepth += 1) {
    if (!node || typeof node !== "object" || !Array.isArray((node as { content?: unknown }).content)) return null;
    const index = $position.index(currentDepth - 1);
    node = (node as { content: unknown[] }).content[index];
  }
  return node && typeof node === "object" && !Array.isArray(node) ? node as Record<string, unknown> : null;
}

function preserveOrderedListAttrRepresentation(original: unknown, result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const source = result as Record<string, unknown>;
  const originalRecord = original && typeof original === "object" && !Array.isArray(original)
    ? original as Record<string, unknown>
    : {};
  const output: Record<string, unknown> = { ...source };
  if (source.type === "orderedList" && originalRecord.type === "orderedList" && !Object.prototype.hasOwnProperty.call(originalRecord, "attrs")) {
    delete output.attrs;
  }
  if (Array.isArray(source.content)) {
    const originalContent = Array.isArray(originalRecord.content) ? originalRecord.content : [];
    output.content = source.content.map((child, index) => preserveOrderedListAttrRepresentation(originalContent[index] as CampaignDocument, child));
  }
  return output;
}

function assertValidSelection(document: CampaignDocument, selection: CampaignEditorSelection): void {
  if (!Number.isSafeInteger(selection.from) || !Number.isSafeInteger(selection.to) || selection.from < 1 || selection.from >= selection.to) {
    throw new RangeError("Campaign editor selection must be a non-empty forward range");
  }
  const pm = asPmDocument(document);
  if (selection.to > pm.content.size) throw new RangeError("Campaign editor selection is out of range");
  try {
    pm.resolve(selection.from);
    pm.resolve(selection.to);
  } catch {
    throw new RangeError("Campaign editor selection is out of range");
  }
}

export function validateCompleteProposal(document: unknown, surface: CampaignEditorSurface = "campaign_goal"): CampaignDocument {
  return parseCampaignDocument(document, maxCharactersForSurface(surface));
}

export const extractSelection = extractSelectedDocument;
export const replaceSelection = replaceSelectedDocument;
export const buildProviderInput = buildEditorAiProviderInput;
export const validateProposal = validateCompleteProposal;

export function changedTopLevelBlockIndexes(current: CampaignDocument, proposed: CampaignDocument, surface: CampaignEditorSurface = "campaign_goal"): number[] {
  const left = parseCampaignDocument(current, maxCharactersForSurface(surface));
  const right = parseCampaignDocument(proposed, maxCharactersForSurface(surface));
  const max = Math.max(left.content.length, right.content.length);
  const indexes: number[] = [];
  for (let index = 0; index < max; index += 1) {
    if (JSON.stringify(left.content[index] ?? null) !== JSON.stringify(right.content[index] ?? null)) indexes.push(index);
  }
  return indexes;
}

export function buildEditorAiComparison(current: CampaignDocument, proposed: CampaignDocument, surface: CampaignEditorSurface = "campaign_goal"): CampaignEditorComparison {
  const left = parseCampaignDocument(current, maxCharactersForSurface(surface));
  const right = parseCampaignDocument(proposed, maxCharactersForSurface(surface));
  const changed = changedTopLevelBlockIndexes(left, right, surface);
  const max = Math.max(left.content.length, right.content.length);
  const blocks = Array.from({ length: max }, (_, index) => ({
    index,
    changed: changed.includes(index),
    before: blockPlainText(left.content[index]),
    proposed: blockPlainText(right.content[index]),
  }));
  return { before_label: "Current", proposed_label: "Proposed", changed_top_level_block_indexes: changed, blocks };
}

function blockPlainText(block: CampaignDocument["content"][number] | undefined): string {
  if (!block) return "";
  try {
    return deriveCampaignDocument({ type: "doc", content: [block] }, 20_000).plainText;
  } catch {
    return "";
  }
}

export function buildEditorAiProposal(args: {
  request: CreateCampaignEditorAiRunInput;
  authorizedContext: CampaignEditorAiAuthorizedContext;
  providerResult: { replacement_document: CampaignDocument; rationale: string; citation_ids: string[] };
}): CampaignEditorAiProposal {
  const providerInput = buildEditorAiProviderInput(args.request, args.authorizedContext);
  const providerResult = campaignEditorAiProviderResultSchema.parse(args.providerResult);
  const replacement = validateCompleteProposal(providerResult.replacement_document, providerInput.surface);
  const allowedCitations = new Set(providerInput.context.accepted_research.flatMap((item) => item.citation_ids));
  const citationIds = [...new Set(providerResult.citation_ids)];
  if (citationIds.some((id) => !allowedCitations.has(id))) throw new Error("Provider returned an unknown citation ID");
  const proposed = providerInput.scope === "selection"
    ? replaceSelectedDocument(providerInput.current_document, args.request.selection!, replacement, providerInput.surface)
    : replacement;
  const complete = validateCompleteProposal(proposed, providerInput.surface);
  return {
    input_document_hash: hashCampaignEditorDocument(providerInput.current_document, providerInput.surface),
    proposed_document: complete,
    rationale: providerResult.rationale,
    citation_ids: citationIds,
    status: "ready",
    changed_top_level_block_indexes: changedTopLevelBlockIndexes(providerInput.current_document, complete, providerInput.surface),
    comparison: buildEditorAiComparison(providerInput.current_document, complete, providerInput.surface),
  };
}

export function decideProposal(input: {
  storedHash: string;
  currentHash: string;
  decision: "accepted" | "rejected";
  currentStatus: CampaignEditorAiRunStatus;
}): { status: "accepted" | "rejected" | "stale" | "invalid" } {
  const parsed = decideCampaignEditorAiProposalSchema.parse(input);
  if (parsed.storedHash !== parsed.currentHash) return { status: "stale" };
  if (parsed.currentStatus !== "ready") return { status: "invalid" };
  return { status: parsed.decision };
}
