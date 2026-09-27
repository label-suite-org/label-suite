import { useState, useMemo } from "react";
import type { AnalyticsRunRow } from "../../server/analytics";

import { Button } from "@/components/ui/button";
interface Props {
  runs: AnalyticsRunRow[];
}

export default function SyncRunsLog({ runs }: Props) {
  const [showAll, setShowAll] = useState(false);
  const displayRuns = useMemo(
    () => (showAll ? runs : runs.slice(0, 10)),
    [runs, showAll],
  );

  if (!runs.length) {
    return (
      <section>
        <p className="text-sm text-[var(--muted-foreground)]">No import runs recorded yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted-foreground)]">
          {runs.length} total runs
        </p>
        {runs.length > 10 && (
          <Button
            onClick={() => setShowAll((s) => !s)}
            className="text-xs text-[var(--foreground)] underline underline-offset-2"
          >
            {showAll ? "Show last 10" : `Show all ${runs.length}`}
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)]">
              <th className="pb-2 pr-3 text-left font-normal">Source</th>
              <th className="pb-2 pr-3 text-left font-normal">Status</th>
              <th className="pb-2 pr-3 text-left font-normal">Scope</th>
              <th className="pb-2 pr-3 text-right font-normal">Rows</th>
              <th className="pb-2 pr-3 text-right font-normal">Ins</th>
              <th className="pb-2 pr-3 text-right font-normal">Upd</th>
              <th className="pb-2 pr-3 text-right font-normal">Files</th>
              <th className="pb-2 pl-3 text-left font-normal">Started</th>
              <th className="pb-2 pl-3 text-left font-normal">Completed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {displayRuns.map((run) => (
              <tr key={run.id}>
                <td className="py-2 pr-3 font-medium">{run.source}</td>
                <td className="py-2 pr-3">
                  <StatusIndicator status={run.status} error={run.error} />
                </td>
                <td className="py-2 pr-3 text-[var(--muted-foreground)]">{run.scope ?? "—"}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{run.rowsImported}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{run.rowsInserted}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{run.rowsUpdated}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{run.filesDownloaded}</td>
                <td className="py-2 pl-3 text-[var(--muted-foreground)] whitespace-nowrap text-xs">
                  {formatShortDateTime(run.startedAt)}
                </td>
                <td className="py-2 pl-3 text-[var(--muted-foreground)] whitespace-nowrap text-xs">
                  {formatShortDateTime(run.completedAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusIndicator({ status, error }: { status: string; error: string | null }) {
  const dotColors: Record<string, string> = {
    completed: "var(--chart-1)",
    running: "var(--chart-3)",
    failed: "var(--destructive)",
    pending: "var(--chart-5)",
  };
  const color = dotColors[status] ?? "var(--muted-foreground)";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" title={error ?? undefined}>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {status}
    </span>
  );
}

function formatShortDateTime(value: Date | null): string {
  if (!value) return "—";
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
