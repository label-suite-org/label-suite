"use client";

import { useEffect, useMemo, useState } from "react";
import type { DatedTrackSnapshotRow, DatedTrackSnapshotWorkspace } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

import { Button } from "@/components/ui/button";
interface Props {
  workspace: DatedTrackSnapshotWorkspace;
  selectedArtistId: string;
  onRefreshCurrentEvidence?: () => void;
}

export default function DatedTrackSnapshotTable({
  workspace,
  selectedArtistId,
  onRefreshCurrentEvidence,
}: Props) {
  useEffect(() => {
    function refreshAfterImport(event: Event) {
      const detail = event instanceof CustomEvent ? event.detail : null;
      const latest = isRecord(detail) && isRecord(detail.latest) ? detail.latest : null;
      if (latest?.artistId !== selectedArtistId) return;
      if (onRefreshCurrentEvidence) onRefreshCurrentEvidence();
      else window.location.reload();
    }

    window.addEventListener("sisense-track-snapshot-imported", refreshAfterImport);
    return () => window.removeEventListener("sisense-track-snapshot-imported", refreshAfterImport);
  }, [onRefreshCurrentEvidence, selectedArtistId]);

  const latest = workspace.latest;
  if (!latest) {
    return (
      <section className="space-y-5" aria-labelledby="latest-dated-track-snapshot-heading">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Sisense · Tracks by Growth Rate
          </p>
          <h2 id="latest-dated-track-snapshot-heading" className="mt-1 text-xl font-semibold tracking-tight">
            Latest dated track snapshot
          </h2>
        </div>
        <div className="border border-[var(--border)] p-4" role="status">
          <p className="text-sm">No dated track snapshot is available for this artist.</p>
          <a
            href="#sisense-track-snapshot-import-heading"
            className="mt-2 inline-flex text-sm font-medium underline underline-offset-4"
          >
            Import a dated Sisense track snapshot
          </a>
        </div>
        <SnapshotHistory workspace={workspace} />
        <LegacyDisclosure legacy={workspace.legacy} />
      </section>
    );
  }

  const currentRows = uniqueIdentityRows(latest.rows);
  const completeRowSet = latest.rowsPage.offset === 0 && !latest.rowsPage.hasMore;

  return (
    <section className="space-y-5" aria-labelledby="latest-dated-track-snapshot-heading">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Sisense · Tracks by Growth Rate
        </p>
        <h2 id="latest-dated-track-snapshot-heading" className="mt-1 text-xl font-semibold tracking-tight">
          Latest dated track snapshot
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {latest.requestedDateRange} · {latest.requestedAggregation}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Reporting through {latest.reportingThrough ?? "unavailable"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <SummaryFact label="Unique tracks" value={`${latest.uniqueTrackCount} unique tracks`} />
        <SummaryFact label="Cumulative streams" value={formatAnalyticsNumber(latest.cumulativeStreams)} />
        <SummaryFact
          label="Cumulative views"
          value={formatOptionalCount(latest.cumulativeViews)}
        />
        <SummaryFact label="Imported" value={formatImportedAt(latest.importedAt)} />
      </div>

      <p className="text-sm text-muted-foreground">
        Growth is the provider-reported comparison between dated snapshots; it is not recalculated by Label Suite.
      </p>

      <CurrentRowsTable
        rows={currentRows}
        reportingThrough={latest.reportingThrough}
        requestedDateRange={latest.requestedDateRange}
        requestedAggregation={latest.requestedAggregation}
      />
      {!completeRowSet && (
        <p className="text-xs text-muted-foreground">
          {latest.rowsPage.offset === 0
            ? `Showing ${currentRows.length} of ${latest.rowsPage.totalCount} unique tracks in this table.`
            : `Showing rows ${latest.rowsPage.offset + 1}–${latest.rowsPage.offset + currentRows.length} of ${latest.rowsPage.totalCount} unique tracks in this table.`}
        </p>
      )}
      <SnapshotHistory workspace={workspace} />
      <LegacyDisclosure legacy={workspace.legacy} />
    </section>
  );
}

function SummaryFact({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold leading-tight tabular-nums">{value}</p>
      {meta && <p className="mt-1 text-xs text-muted-foreground">{meta}</p>}
    </div>
  );
}

type SortKey = "trackTitle" | "combinedStreams" | "streamsGrowth" | "combinedViews";

function CurrentRowsTable({
  rows,
  reportingThrough,
  requestedDateRange,
  requestedAggregation,
}: {
  rows: DatedTrackSnapshotRow[];
  reportingThrough: string | null;
  requestedDateRange: string;
  requestedAggregation: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: "ascending" | "descending" }>({
    key: "combinedStreams",
    direction: "descending",
  });
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = left[sort.key];
    const rightValue = right[sort.key];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue ?? "").localeCompare(String(rightValue ?? ""));
    return sort.direction === "ascending" ? comparison : -comparison;
  }), [rows, sort]);

  function changeSort(key: SortKey) {
    setSort((current) => current.key === key
      ? { key, direction: current.direction === "ascending" ? "descending" : "ascending" }
      : { key, direction: "ascending" });
  }

  const heading = (key: SortKey, label: string, align: "left" | "right" = "left") => (
    <th
      scope="col"
      aria-sort={sort.key === key ? sort.direction : "none"}
      className={`px-3 py-2 text-xs font-medium text-muted-foreground ${align === "right" ? "text-right" : "text-left"}`}
    >
      <Button variant="link"
        type="button"
        className="inline-flex min-h-10 items-center gap-1 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        onClick={() => changeSort(key)}
      >
        {label}
        <span aria-hidden="true">{sort.key === key ? (sort.direction === "ascending" ? "↑" : "↓") : "↕"}</span>
      </Button>
    </th>
  );

  return (
    <div
      className="overflow-x-auto border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      role="region"
      tabIndex={0}
      aria-label="Current dated track snapshot rows"
    >
      <table className="min-w-[1500px] w-full text-sm">
        <caption className="sr-only">Current Sisense track snapshot, one row per imported track identity</caption>
        <thead className="border-b border-[var(--border)]">
          <tr>
            {heading("trackTitle", "Track")}
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Release</th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Match status</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Spotify</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Apple</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Amazon</th>
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Pandora</th>
            {heading("combinedStreams", "Cumulative streams", "right")}
            {heading("streamsGrowth", "Stream growth", "right")}
            {heading("combinedViews", "Combined views", "right")}
            <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">View growth</th>
            <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Reporting context</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {sortedRows.map((row) => (
            <tr key={row.rowKey}>
              <td className="px-3 py-3">
                <p className="font-medium">{row.trackTitle}</p>
                <p className="text-xs text-muted-foreground">{row.primaryArtist ?? "Unknown artist"}</p>
              </td>
              <td className="px-3 py-3">{row.releaseTitle ?? "—"}</td>
              <td className="px-3 py-3">{row.trackId ? "Matched to catalog" : "Unmatched source row"}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatOptionalCount(row.spotifyStreams)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatOptionalCount(row.appleStreams)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatOptionalCount(row.amazonStreams)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatOptionalCount(row.pandoraStreams)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatAnalyticsNumber(row.combinedStreams)}</td>
              <td className="px-3 py-3 text-right tabular-nums">
                {formatPercentagePoints(row.streamsGrowth)}
              </td>
              <td className="px-3 py-3 text-right tabular-nums">{formatOptionalCount(row.combinedViews)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatPercentagePoints(row.viewsGrowth)}</td>
              <td className="px-3 py-3 text-xs">
                <span className="block">Through {reportingThrough ?? "unavailable"}</span>
                <span className="block text-muted-foreground">
                  {requestedDateRange || "Range unavailable"} · {requestedAggregation || "Aggregation unavailable"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function uniqueIdentityRows(rows: DatedTrackSnapshotRow[]): DatedTrackSnapshotRow[] {
  return [...new Map(rows.map((row) => [row.rowKey, row])).values()];
}

function formatPercentagePoints(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatOptionalCount(value: number | null): string {
  return value === null ? "—" : formatAnalyticsNumber(value);
}

function SnapshotHistory({ workspace }: { workspace: DatedTrackSnapshotWorkspace }) {
  const earlier = workspace.history.filter((entry) => entry.runId !== workspace.latest?.runId);
  return (
    <details className="group border-t border-[var(--border)] pt-4">
      <summary className="cursor-pointer font-medium">
        Earlier dated snapshots · {earlier.length} {earlier.length === 1 ? "snapshot" : "snapshots"}
      </summary>
      <div className="mt-4 space-y-3">
        {earlier.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earlier dated snapshots are available.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)] border border-[var(--border)]">
            {earlier.map((entry) => (
              <li key={entry.runId} className="space-y-1 p-3 text-sm">
                <p className="font-medium">{entry.requestedDateRange} · {entry.requestedAggregation}</p>
                <p className="text-muted-foreground">
                  {formatCountPhrase(entry.uniqueTrackCount, "unique tracks", "Unique tracks unavailable")} · {formatCountPhrase(entry.sourceRowCount, "source records", "Source records unavailable")} · Imported {formatImportedAt(entry.importedAt)}
                </p>
                <p className="text-muted-foreground">
                  {identityCounts(entry.matchedCount, entry.unmatchedCount, entry.ambiguousCount, entry.exactDuplicateCount)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Source file: {entry.fileName} · <span title={entry.sha256}>SHA-256 {entry.sha256Prefix || "unavailable"}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
        {workspace.historyPage.hasMore && (
          <p className="text-sm text-muted-foreground">Additional earlier snapshots are not shown on this page.</p>
        )}
      </div>
    </details>
  );
}

function formatCountPhrase(value: number | null, label: string, unavailable: string): string {
  return value === null ? unavailable : `${formatAnalyticsNumber(value)} ${label}`;
}

function identityCounts(
  matched: number | null,
  unmatched: number | null,
  ambiguous: number | null,
  exactDuplicates: number | null,
): string {
  if ([matched, unmatched, ambiguous, exactDuplicates].every((value) => value === null)) {
    return "Identity counts unavailable";
  }
  const count = (value: number | null) => value === null ? "—" : formatAnalyticsNumber(value);
  return `Matched ${count(matched)} · Unmatched ${count(unmatched)} · Ambiguous ${count(ambiguous)} · Exact duplicates ${count(exactDuplicates)}`;
}

function LegacyDisclosure({ legacy }: { legacy: DatedTrackSnapshotWorkspace["legacy"] }) {
  const boundedRows = legacy.status === "available"
    ? legacy.rows.slice(0, Math.min(100, legacy.recordCount))
    : [];
  const summary = legacy.status === "available"
    ? `Undated legacy records · ${legacy.recordCount} ${legacy.recordCount === 1 ? "record" : "records"}`
    : "Undated legacy records · count unavailable";

  return (
    <details className="group border-t border-[var(--border)] pt-4">
      <summary className="cursor-pointer font-medium">{summary}</summary>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          These records predate reporting-period provenance. They are preserved for QA, excluded from current totals, and cannot be used to identify the latest value.
        </p>
        {legacy.status === "unavailable" ? (
          <p className="border border-[var(--border)] p-3 text-sm" role="status">
            Legacy records are unavailable in this environment; this is not a zero-record result.
          </p>
        ) : boundedRows.length === 0 ? (
          <p className="border border-[var(--border)] p-3 text-sm text-muted-foreground" role="status">
            No undated legacy records were found.
          </p>
        ) : (
          <>
            <div
              className="overflow-x-auto border border-[var(--border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              role="region"
              tabIndex={0}
              aria-label="Undated legacy track records"
            >
              <table className="min-w-[640px] w-full text-sm">
                <caption className="sr-only">Bounded undated legacy track records for QA only</caption>
                <thead className="border-b border-[var(--border)]">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Track</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Artist</th>
                    <th scope="col" className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Recorded streams</th>
                    <th scope="col" className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {boundedRows.map((row, index) => (
                    <tr key={`${row.id}:${index}`}>
                      <td className="px-3 py-3 font-medium">{row.trackTitle}</td>
                      <td className="px-3 py-3">{row.primaryArtist ?? "Unknown artist"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatAnalyticsNumber(row.combinedStreams)}</td>
                      <td className="px-3 py-3">{formatImportedAt(row.lastSeenAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Showing {boundedRows.length} of {legacy.recordCount} legacy records.
            </p>
          </>
        )}
      </div>
    </details>
  );
}

function formatImportedAt(value: Date | string | null): string {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
