"use client";

import type { TopArtistRow, TopReleaseRow } from "../../server/analytics-extra";

interface ArtistProps {
  rows: TopArtistRow[];
}
interface ReleaseProps {
  rows: TopReleaseRow[];
}

export function TopArtistsByNet({ rows }: ArtistProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Top artists by net revenue</h2>
        <p className="text-sm text-muted-foreground">Sum of net royalties grouped by linked artist.</p>
      </header>
      <RankList
        emptyMessage="No royalty rows linked to artists yet."
        rows={rows.map((row) => ({
          key: row.artistId,
          primary: row.artistName,
          secondary: `${row.count} record${row.count === 1 ? "" : "s"}`,
          valueLabel: formatCurrency(row.net),
          widthPct: pctOfMax(rows.map((r) => Math.max(0, r.net)), Math.max(0, row.net)),
        }))}
      />
    </section>
  );
}

export function TopReleasesByNet({ rows }: ReleaseProps) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3">
      <header>
        <h2 className="text-lg font-semibold tracking-tight">Top releases by net revenue</h2>
        <p className="text-sm text-muted-foreground">Sum of net royalties grouped by linked release.</p>
      </header>
      <RankList
        emptyMessage="No royalty rows linked to releases yet."
        rows={rows.map((row) => ({
          key: row.releaseId,
          primary: row.releaseTitle,
          secondary: row.artistName ? `by ${row.artistName}` : `${row.count} record${row.count === 1 ? "" : "s"}`,
          valueLabel: formatCurrency(row.net),
          widthPct: pctOfMax(rows.map((r) => Math.max(0, r.net)), Math.max(0, row.net)),
        }))}
      />
    </section>
  );
}

function RankList({
  rows,
  emptyMessage,
}: {
  rows: Array<{ key: string; primary: string; secondary: string; valueLabel: string; widthPct: number }>;
  emptyMessage: string;
}) {
  if (!rows.length) {
    return <p className="p-6 text-center text-muted-foreground border border-dashed border-border rounded-xl">{emptyMessage}</p>;
  }
  return (
    <ul className="divide-y divide-border rounded-xl border border-border overflow-hidden">
      {rows.map((row, index) => (
        <li key={row.key} className="flex items-center gap-3 px-3 py-2.5">
          <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-medium truncate">{row.primary}</p>
              <span className="text-sm tabular-nums font-semibold shrink-0">{row.valueLabel}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.max(row.widthPct, 2)}%`, backgroundColor: "var(--chart-1)" }} />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{row.secondary}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function pctOfMax(values: number[], current: number): number {
  const max = Math.max(...values, 1);
  if (max === 0) return 0;
  return (current / max) * 100;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}