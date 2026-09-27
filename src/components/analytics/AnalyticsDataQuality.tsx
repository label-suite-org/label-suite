import { useState } from "react";
import type { AnalyticsDataQualityReport, AnalyticsDuplicateDisposition, AnalyticsDuplicateReason } from "../../server/analytics-data-quality";

import { Button } from "@/components/ui/button";
const duplicateReasonLabels: Record<AnalyticsDuplicateReason, string> = {
  same_source_identity: "Same source identity",
  same_isrc: "Same ISRC",
  same_artist_title: "Same artist and title",
};

export default function AnalyticsDataQuality({ report }: { report: AnalyticsDataQualityReport }) {
  const [candidates, setCandidates] = useState(report.candidates);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unreviewedCount = candidates.filter((candidate) => candidate.disposition === "unreviewed").length;
  const candidateGroups = (Object.keys(duplicateReasonLabels) as AnalyticsDuplicateReason[])
    .map((reason) => ({ reason, candidates: candidates.filter((candidate) => candidate.reason === reason) }))
    .filter((group) => group.candidates.length > 0);

  async function setDisposition(key: string, disposition: Exclude<AnalyticsDuplicateDisposition, "unreviewed">) {
    setSaving(key);
    setError(null);
    try {
      const response = await fetch("/api/analytics/data-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateKey: key, evidenceVersion: report.evidence.version, disposition }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? "Could not save review");
      setCandidates((current) => current.map((candidate) => candidate.key === key ? { ...candidate, disposition } : candidate));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save review");
    } finally {
      setSaving(null);
    }
  }

  if (!report.currentRun && !report.compatibility && report.health.coverage === "empty"
    && !report.health.lastSuccessfulRunAt && report.health.failedRuns === 0
    && report.sources.length === 0 && candidates.length === 0) {
    return <section id="analytics-data-health" className="space-y-2 border-t border-border pt-6">
      <h2 className="text-xl font-semibold">Analytics data health</h2>
      <p className="text-sm text-muted-foreground">No automated Sisense import evidence yet. Source health and duplicate checks will appear after an import. Manual imports are tracked separately above.</p>
    </section>;
  }

  return <section id="analytics-data-health" className="space-y-5 border-t border-[var(--border)] pt-6">
    <div>
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Evidence</p>
      <h2 className="mt-1 text-xl font-semibold">Analytics data health</h2>
      <p className="mt-1 text-sm text-muted-foreground">Missing or unmatched data remains visible until reviewed. Duplicate signals require an explicit, attributable disposition.</p>
    </div>

    {!report.evidence.complete && <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">Complete duplicate evidence is unavailable for this schema state. Review actions remain disabled until the evidence contract is available.</p>}
    <div className="grid gap-3 sm:grid-cols-4">
      <Health label="Last success" value={formatDateTime(report.health.lastSuccessfulRunAt)} />
      <Health label="Source observed" value={formatDateTime(report.health.sourceObservedAt)} />
      <Health label="Reporting through" value={report.health.reportingThrough ? new Date(report.health.reportingThrough).toLocaleDateString() : "Unknown"} />
      <Health label="Freshness basis" value={report.health.freshnessBasis.replaceAll("_", " ")} />
      <Health label="Coverage" value={report.health.coverage} />
      <Health label="Failed runs" value={String(report.health.failedRuns)} />
      <Health label="Unreviewed candidates" value={String(unreviewedCount)} />
    </div>
    {report.health.stale && <p className="border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="status">{degradedHealthMessage(report.health.degradedReasons)}</p>}
    {error && <p className="border border-red-500/40 bg-red-500/10 p-3 text-sm" role="alert">{error}</p>}

    {report.currentRun && <div className="border border-[var(--border)] p-4">
      <h3 className="font-medium">Current import run</h3>
      <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
        <Fact label="Run ID" value={report.currentRun.id} />
        <Fact label="Completed" value={formatDateTime(report.currentRun.completedAt)} />
        <Fact label="Requested grain" value={report.currentRun.requestedAggregation ?? "Unknown"} />
        <Fact label="Requested range" value={report.currentRun.requestedDateRange ?? "Unknown"} />
        <Fact label="Expected widgets" value={report.currentRun.expectedWidgetKeys.join(", ") || "Unknown"} />
        <Fact label="Downloaded widgets" value={report.currentRun.downloadedWidgetKeys.join(", ") || "None"} />
      </dl>
      {report.currentRun.observedEmptyWidgets.length > 0 && <p className="mt-3 text-sm" role="status">Observed empty widgets: {report.currentRun.observedEmptyWidgets.map((widget) => `${widget.key} (${widget.reason})`).join(", ")}</p>}
      {report.currentRun.skippedWidgets.length > 0 && <p className="mt-3 text-sm" role="status">Missing/skipped widgets: {report.currentRun.skippedWidgets.map((widget) => `${widget.key} (${widget.reason})`).join(", ")}</p>}
      <div className="mt-4 overflow-x-auto border border-[var(--border)]" role="region" tabIndex={0} aria-label="Current import raw-file provenance">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--border)] text-muted-foreground"><th className="p-3">Raw file / hash</th><th>Rows</th><th>Requested grain / range</th><th>Storage</th></tr></thead>
          <tbody>{report.currentRun.rawFiles.map((file) => <tr key={file.id} className="border-b border-[var(--border)] align-top">
            <td className="p-3"><p>{file.fileName}</p><p className="mt-1 break-all text-xs text-muted-foreground">SHA-256: {file.sha256}</p></td>
            <td>{file.rowCount.toLocaleString()} · {formatBytes(file.byteSize)}</td>
            <td>{file.requestedAggregation ?? "Unknown"} · {file.requestedDateRange ?? "Unknown"}</td>
            <td><p>{file.storageStatus}</p><p className="mt-1 break-all text-xs text-muted-foreground">{file.storageBucket && file.storageKey ? `${file.storageBucket}/${file.storageKey}` : "Local only"}</p></td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>}
    {!report.currentRun && <p className="border border-[var(--border)] p-4 text-sm text-muted-foreground" role="status">No current import evidence.</p>}

    <div className="space-y-3"><h3 className="font-medium">Source coverage</h3>{report.sources.length === 0 ? <p className="border border-[var(--border)] p-4 text-sm text-muted-foreground" role="status">No source coverage rows.</p> : <div className="overflow-x-auto border border-[var(--border)]" role="region" tabIndex={0} aria-label="Analytics source coverage"><table className="w-full text-left text-sm"><thead><tr className="border-b border-[var(--border)] text-muted-foreground"><th className="p-3">Source / widget</th><th>Requested grain / range</th><th>Imported</th><th>Raw</th><th>Linked</th><th>Unmatched</th><th>Last seen</th></tr></thead><tbody>{report.sources.map((source) => <tr key={`${source.source}:${source.widgetKey}:${source.requestedAggregation ?? ""}:${source.requestedDateRange ?? ""}`} className="border-b border-[var(--border)]"><td className="p-3">{source.source} · {source.widgetKey}</td><td>{source.requestedAggregation ?? "Unknown"} · {source.requestedDateRange ?? "Unknown"}</td><td>{source.imported}</td><td>{source.raw}</td><td>{source.linked}</td><td>{source.unmatched}</td><td>{source.lastSeenAt ? new Date(source.lastSeenAt).toLocaleString() : "—"}</td></tr>)}</tbody></table></div>}</div>

    <div className="space-y-4"><h3 className="font-medium">Duplicate candidates</h3><p className="text-sm text-muted-foreground" role="status">{report.evidence.complete ? `Complete batched evidence: ${report.evidence.returnedRows.toLocaleString()} rows reviewed.` : "Complete batched evidence unavailable."}</p>{candidateGroups.length === 0 ? <p className="text-sm text-muted-foreground">No duplicate candidates in the current evidence.</p> : candidateGroups.map((group) => <div key={group.reason} className="space-y-3"><h4 className="text-sm font-medium text-muted-foreground">{duplicateReasonLabels[group.reason]}</h4>{group.candidates.map((candidate) => <article key={candidate.key} className="border border-[var(--border)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">{candidate.artist ?? "Unknown artist"} · {candidate.title ?? candidate.isrc ?? "Unknown title"} · {candidate.rowIds.length} rows</p><p className="mt-1 break-all text-xs text-muted-foreground">Source keys: {candidate.sourceKeys.join(", ")}</p>{candidate.review && <p className="mt-1 text-xs text-muted-foreground">Reviewed by {candidate.review.reviewedBy} on {new Date(candidate.review.reviewedAt).toLocaleString()}{candidate.review.reason ? ` — ${candidate.review.reason}` : ""}</p>}</div><div className="flex flex-wrap gap-2"><span className="rounded-full border px-2 py-1 text-xs">{candidate.disposition.replaceAll("_", " ")}</span>{candidate.disposition === "unreviewed" && (["keep_separate", "link_same_record", "source_error"] as const).map((disposition) => <Button key={disposition} type="button" disabled={saving === candidate.key || !report.evidence.complete} onClick={() => setDisposition(candidate.key, disposition)} className="rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">{disposition.replaceAll("_", " ")}</Button>)}</div></div></article>)}</div>)}</div>
  </section>;
}

function Health({ label, value }: { label: string; value: string }) { return <div className="border border-[var(--border)] p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all">{value}</dd></div>; }
function formatDateTime(value: Date | string | null) { return value ? new Date(value).toLocaleString() : "None"; }
function formatBytes(value: number) { return `${(value / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KB`; }

function degradedHealthMessage(reasons: string[]): string {
  const details: string[] = [];
  if (reasons.includes("missing_widgets")) details.push("Some analytics sources are missing.");
  if (reasons.includes("empty_feed")) details.push("The latest import did not contain usable rows.");
  if (reasons.includes("invalid_evidence")) details.push("The latest import could not be validated.");
  if (reasons.includes("unknown_source_time")) details.push("The reporting date could not be confirmed.");
  if (reasons.includes("stale_reporting_date") || reasons.includes("stale_capture")) details.push("The latest source data is stale.");
  if (reasons.includes("repeated_failures")) details.push("Recent import attempts have repeatedly failed.");
  if (!details.length) details.push("The current analytics evidence is not reliable enough for reporting.");
  return `${details.join(" ")} Affected headline metrics are marked unavailable until a complete, current import succeeds. Review the latest run below for source details.`;
}
