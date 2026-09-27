import { useEffect, useRef, useState } from "react";
import { deriveCampaignDocument, type CampaignCharacterLimit, type CampaignDocument } from "../../lib/campaign-rich-text";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export type CampaignAiSurface = "campaign_goal" | "campaign_notes" | "public_release_note" | "focused_outreach_body" | "radio_update_body";
type Operation = "draft" | "enrich" | "improve" | "shorten" | "tone" | "custom";
type Scope = "selection" | "document";
type Selection = { from: number; to: number } | null;
type Display = { provider: string; model: string; context_manifest: Record<string, unknown>; citations: Array<{ id: string; title: string; url: string }> };
type Proposal = {
  run_id: string; input_document_hash: string; proposed_document: CampaignDocument; rationale: string; citation_ids: string[]; status: "ready";
  comparison: { before_label: string; proposed_label: string; blocks: Array<{ index: number; changed: boolean; before: string; proposed: string }> };
  display: Display;
};
type Review = { proposal: Proposal; operation: Operation; scope: Scope; ownerIdentity: string };

export function CampaignAiAssist({ campaignId, surface, references, document, hash, selection, disabled, onApply, onReturnFocus, getCurrentHash = () => hash, onDecisionPending }: {
  campaignId: string;
  surface: CampaignAiSurface;
  references: { lead_id: string | null; draft_id: string | null; page_revision_id: string | null };
  document: CampaignDocument;
  hash: string;
  selection: Selection;
  disabled: boolean;
  onApply: (document: CampaignDocument) => void;
  onReturnFocus: () => void;
  getCurrentHash?: () => string;
  onDecisionPending?: (pending: boolean) => void;
}) {
  const ownerIdentity = editorOwnerIdentity(campaignId, surface, references);
  const [operation, setOperation] = useState<Operation>("draft");
  const [instruction, setInstruction] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const suggesting = useRef(false);
  const deciding = useRef(false);
  const currentOwnerIdentity = useRef(ownerIdentity);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const needsInstruction = operation === "tone" || operation === "custom";
  currentOwnerIdentity.current = ownerIdentity;

  useEffect(() => {
    if (review) reviewHeading.current?.focus();
  }, [review]);

  async function suggest() {
    if (busy || review || suggesting.current) return;
    suggesting.current = true;
    const scope: Scope = selection ? "selection" : "document";
    setBusy(true); setNotice(null); setStale(false);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/editor-ai-runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface, operation, scope, selection, current_document: document, input_document_hash: hash, instruction: needsInstruction ? instruction.trim() || null : null, ...references }),
      });
      const value = await response.json().catch(() => null);
      const proposal = response.ok ? parseProposal(value, surface, hash) : null;
      if (!proposal) throw new Error("unavailable");
      setReview({ proposal, operation, scope, ownerIdentity });
      if (getCurrentHash() !== proposal.input_document_hash) markStale();
    } catch {
      setNotice("AI suggestion is unavailable. Manual editing remains available.");
    } finally { suggesting.current = false; setBusy(false); }
  }

  async function decide(decision: "accepted" | "rejected") {
    if (!review || busy || deciding.current) return;
    if (currentOwnerIdentity.current !== review.ownerIdentity) {
      markStale();
      return;
    }
    deciding.current = true;
    setBusy(true); setNotice(null); onDecisionPending?.(true);
    const requestHash = getCurrentHash();
    try {
      const response = await fetch(`/api/campaign-editor-ai-runs/${review.proposal.run_id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, current_document_hash: requestHash }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) markStale();
        else setNotice("Could not record the AI decision. Manual editing remains available.");
        return;
      }
      if (!isDecisionResult(result, review.proposal.run_id, decision)) throw new Error("invalid decision");
      if (currentOwnerIdentity.current !== review.ownerIdentity || getCurrentHash() !== review.proposal.input_document_hash) {
        markStale();
        return;
      }
      if (decision === "accepted") onApply(review.proposal.proposed_document);
      setReview(null); onReturnFocus();
    } catch {
      setNotice("Could not record the AI decision. Manual editing remains available.");
    } finally {
      deciding.current = false; setBusy(false); onDecisionPending?.(false);
    }
  }

  function markStale(): void {
    setStale(true);
    setNotice("Suggestion is stale. Review the comparison, then discard it before requesting fresh copy.");
  }

  function discardStaleSuggestion(): void {
    if (!review || !stale) return;
    setReview(null);
    setStale(false);
    setNotice(null);
    onReturnFocus();
  }

  const proposal = review?.proposal;
  return <section className="min-w-0 space-y-2 rounded border border-border p-3" aria-label="AI assist">
    <div className="flex flex-wrap gap-2">
      <label className="text-xs font-medium">AI operation
        <NativeSelect aria-label="AI operation" disabled={disabled || busy || Boolean(review)} value={operation} onChange={(event) => setOperation(event.target.value as Operation)} className="ml-2 border border-border bg-background p-1">
          <option value="draft">Draft</option><option value="enrich">Enrich</option><option value="improve">Improve</option><option value="shorten">Shorten</option><option value="tone">Tone</option><option value="custom">Custom</option>
        </NativeSelect>
      </label>
      <Button type="button" disabled={disabled || busy || Boolean(review) || (needsInstruction && !instruction.trim())} onClick={suggest}>Suggest changes</Button>
    </div>
    {needsInstruction ? <label className="block text-xs font-medium">AI instruction<Input aria-label="AI instruction" maxLength={500} disabled={Boolean(review)} value={instruction} onChange={(event) => setInstruction(event.target.value)} className="mt-1 w-full border border-border p-1" /></label> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {review && proposal ? <div className="space-y-2" aria-live="polite">
      <h3 ref={reviewHeading} tabIndex={-1}>Review AI suggestion</h3>
      <p>Operation: {review.operation} · Scope: {review.scope}</p>
      <p>Provider: {proposal.display.provider} · Model: {proposal.display.model}</p>
      <p>Context manifest: {summarizeManifest(proposal.display.context_manifest) || "no compact references"}</p>
      <ChangedBlocks proposal={proposal} />
      <p>{proposal.rationale}</p>
      {proposal.display.citations.map((citation) => safeHref(citation.url) ? <a key={citation.id} href={citation.url} target="_blank" rel="noopener noreferrer" className="underline">{citation.title}</a> : null)}
      <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || stale} onClick={() => decide("accepted")}>Accept suggestion</Button><Button type="button" disabled={busy || stale} onClick={() => decide("rejected")}>Reject suggestion</Button>{stale ? <Button type="button" onClick={discardStaleSuggestion}>Discard stale suggestion and retry</Button> : null}</div>
    </div> : null}
  </section>;
}

function ChangedBlocks({ proposal }: { proposal: Proposal }) {
  const blocks = proposal.comparison.blocks.filter((block) => block.changed);
  if (blocks.length) return <div className="grid gap-2 sm:grid-cols-2">{blocks.map((block) => <div key={block.index} className="border border-border p-2"><h4>Before · {proposal.comparison.before_label}</h4><p>Changed block {block.index + 1}: {block.before}</p><h4 className="mt-2">Proposed · {proposal.comparison.proposed_label}</h4><p>Changed block {block.index + 1}: {block.proposed}</p></div>)}</div>;
  return <p>Before and Proposed are unchanged.</p>;
}

function parseProposal(value: unknown, surface: CampaignAiSurface, expectedHash: string): Proposal | null {
  if (!isRecord(value) || value.status !== "ready" || !isBoundedString(value.run_id, 200) || !isSha256(value.input_document_hash) || value.input_document_hash !== expectedHash || !isBoundedString(value.rationale, 4_000)) return null;
  const citationIds = parseStringArray(value.citation_ids, 100, 200);
  const display = parseDisplay(value.display);
  const comparison = parseComparison(value.comparison);
  if (!citationIds || !display || !comparison) return null;
  try {
    const proposedDocument = deriveCampaignDocument(value.proposed_document, characterLimitFor(surface)).document;
    return { run_id: value.run_id, input_document_hash: value.input_document_hash, proposed_document: proposedDocument, rationale: value.rationale, citation_ids: citationIds, status: "ready", comparison, display };
  } catch {
    return null;
  }
}

function characterLimitFor(surface: CampaignAiSurface): CampaignCharacterLimit {
  return surface === "focused_outreach_body" || surface === "radio_update_body" ? 10_000 : 20_000;
}

function parseDisplay(value: unknown): Display | null {
  if (!isRecord(value) || !isBoundedString(value.provider, 200) || !isBoundedString(value.model, 200) || !isRecord(value.context_manifest) || !Array.isArray(value.citations) || value.citations.length > 100) return null;
  const citations = value.citations.map((citation) => {
    if (!isRecord(citation) || !isBoundedString(citation.id, 200) || !isBoundedString(citation.title, 500) || !isBoundedString(citation.url, 2_000)) return null;
    return { id: citation.id, title: citation.title, url: citation.url };
  });
  return citations.every((citation): citation is NonNullable<typeof citation> => citation !== null) ? { provider: value.provider, model: value.model, context_manifest: value.context_manifest, citations } : null;
}

function parseComparison(value: unknown): Proposal["comparison"] | null {
  if (!isRecord(value) || value.before_label !== "Current" || value.proposed_label !== "Proposed" || !Array.isArray(value.blocks) || value.blocks.length === 0 || value.blocks.length > 2_000) return null;
  const blocks = value.blocks.map((block) => {
    if (!isRecord(block) || typeof block.index !== "number" || !Number.isSafeInteger(block.index) || block.index < 0 || typeof block.changed !== "boolean" || !isBoundedString(block.before, 20_000, true) || !isBoundedString(block.proposed, 20_000, true)) return null;
    return { index: block.index, changed: block.changed, before: block.before, proposed: block.proposed };
  });
  if (!blocks.every((block): block is NonNullable<typeof block> => block !== null)) return null;
  return new Set(blocks.map((block) => block.index)).size === blocks.length ? { before_label: "Current", proposed_label: "Proposed", blocks } : null;
}

function isDecisionResult(value: unknown, runId: string, status: "accepted" | "rejected"): boolean {
  return isRecord(value) && value.run_id === runId && value.status === status;
}

function editorOwnerIdentity(campaignId: string, surface: CampaignAiSurface, references: { lead_id: string | null; draft_id: string | null; page_revision_id: string | null }): string {
  return JSON.stringify([campaignId, surface, references.lead_id, references.draft_id, references.page_revision_id]);
}

function isSha256(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function isBoundedString(value: unknown, maxLength: number, allowEmpty = false): value is string { return typeof value === "string" && (allowEmpty || value.trim().length > 0) && value.length <= maxLength; }
function parseStringArray(value: unknown, maxItems: number, maxLength: number): string[] | null { return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item, maxLength)) ? value : null; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function summarizeManifest(manifest: Record<string, unknown>): string { return ["campaign", "release", "lead", "draft", "page_revision", "prompt"].flatMap((key) => { const item = manifest[key]; return isRecord(item) && typeof item.id === "string" ? [item.id] : []; }).join(", "); }
function safeHref(value: string): boolean { try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:"; } catch { return false; } }
