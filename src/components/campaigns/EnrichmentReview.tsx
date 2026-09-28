import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";

import { Button } from "@/components/ui/button";
type Suggestion = CampaignOutreachWorkspaceData["leads"][number]["latest_suggestions"][number];

type Props = {
  leadId: string;
  suggestions: Suggestion[];
  canMutate: boolean;
  busy: boolean;
  onDecision: (suggestionId: string, decision: "accepted" | "rejected") => void;
};

export default function EnrichmentReview({ leadId, suggestions, canMutate, busy, onDecision }: Props) {
  return (
    <section aria-labelledby="research-title" className="border-t border-border pt-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4f6f9f]">Work this lead in Codex MCP</p>
        <h3 id="research-title" className="mt-1 font-semibold">Research and fact review</h3>
        <p className="mt-1 text-xs text-muted-foreground">Pending and rejected facts are excluded from drafts.</p>
      </div>
      <div className="mt-3 grid gap-2 border-y border-border py-3 text-xs sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Selected lead ID</span>
          <code className="ml-2 font-medium text-foreground">{leadId}</code>
        </div>
        <div>
          <span className="text-muted-foreground">MCP tool</span>
          <code className="ml-2 font-medium text-foreground">get_enrichment_item</code>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Pending proposals return here for Accept or Reject. Label Suite does not run a provider or apply proposals automatically.</p>

      {!canMutate && <p className="mt-3 text-xs text-muted-foreground" role="status">Suggestion decisions are disabled in read-only mode.</p>}
      <div className="mt-3 divide-y divide-border border-y border-border">
        {suggestions.map((suggestion) => (
          <article key={suggestion.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold capitalize">{suggestion.suggestion_type.replaceAll("_", " ")}</p>
              <span className="text-[11px] capitalize text-muted-foreground">{suggestion.status}</span>
            </div>
            {suggestion.source_kind === "codex_mcp" && (
              <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                <p className="font-medium text-[#4f6f9f]">Submitted through Codex MCP</p>
                <p>{suggestion.provenance?.submitting_operator
                  ? `Submitted by ${boundedText(suggestion.provenance.submitting_operator.name, 120)}`
                  : "Submitting operator unavailable"}</p>
                {validTimestamp(suggestion.provenance?.created_at) ? (
                  <p><time dateTime={toIso(suggestion.provenance!.created_at!)}>Created {formatDate(suggestion.provenance!.created_at!)}</time></p>
                ) : <p>Creation time unavailable</p>}
                <p className="break-all">{validLeadRevision(suggestion.provenance?.lead_revision)
                  ? <>Lead revision <code>{suggestion.provenance!.lead_revision}</code></>
                  : "Lead revision unavailable"}</p>
              </div>
            )}
            <dl className="mt-2 space-y-1">
              <div>
                <dt className="text-[11px] text-muted-foreground">Proposed value</dt>
                <dd className="text-sm">{boundedText(suggestion.suggested_value.value, 2_000)}</dd>
              </div>
              {boundedText(suggestion.suggested_value.rationale, 2_000) && <div>
                <dt className="text-[11px] text-muted-foreground">Rationale</dt>
                <dd className="text-xs text-muted-foreground">{boundedText(suggestion.suggested_value.rationale, 2_000)}</dd>
              </div>}
            </dl>
            <ul className="mt-2 space-y-1">
              {suggestion.evidence.slice(0, 8).map((citation, index) => (
                <li key={`${citation.url}-${index}`} className="text-xs">
                  <a href={citation.url} target="_blank" rel="noreferrer" className="font-medium text-[#4f6f9f] underline underline-offset-2">
                    Source: {boundedText(citation.title, 300)}
                  </a>
                  <span className="ml-2 text-muted-foreground">{validTimestamp(citation.retrieved_at)
                    ? <>retrieved <time dateTime={toIso(citation.retrieved_at)}>{formatDate(citation.retrieved_at)}</time></>
                    : "retrieval time unavailable"}</span>
                  {citation.citation_text && <p className="mt-0.5 text-muted-foreground">{boundedText(citation.citation_text, 1_000)}</p>}
                </li>
              ))}
            </ul>
            {suggestion.status === "pending" && canMutate && (
              <div className="mt-3 flex gap-2">
                <Button type="button" disabled={busy} onClick={() => onDecision(suggestion.id, "accepted")} className="h-7 bg-[#4f6f9f] px-2.5 text-xs font-medium text-white disabled:opacity-50">Accept fact</Button>
                <Button type="button" disabled={busy} onClick={() => onDecision(suggestion.id, "rejected")} className="h-7 border border-border px-2.5 text-xs disabled:opacity-50">Reject fact</Button>
              </div>
            )}
          </article>
        ))}
        {suggestions.length === 0 && <p className="py-5 text-sm text-muted-foreground">No research suggestions yet.</p>}
      </div>
    </section>
  );
}

function boundedText(value: unknown, limit: number) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

function validLeadRevision(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value: unknown): value is string | Date {
  return (typeof value === "string" || value instanceof Date) && !Number.isNaN(new Date(value).getTime());
}

function toIso(value: string | Date) {
  return new Date(value).toISOString();
}

function formatDate(value: string | Date) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Copenhagen" }).format(new Date(value));
}
