import { useMemo } from "react";
import type { AnalyticsWidgetRow } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

interface Props {
  rows: AnalyticsWidgetRow[];
}

export default function GenreBenchmarks({ rows }: Props) {
  const maxValue = useMemo(
    () => Math.max(...rows.flatMap((r) => Object.values(r.metrics).filter((v): v is number => v !== null)), 1),
    [rows],
  );

  if (!rows.length) {
    return (
      <section>
        <p className="text-sm text-[var(--muted-foreground)]">No genre benchmark data available.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const genre = row.dimensions["genre"] ?? row.label;
          const metrics = Object.entries(row.metrics).filter(
            ([, v]) => v !== null,
          );
          return (
            <div key={row.id}>
              <p className="text-sm font-medium mb-3 truncate" title={genre}>{genre}</p>
              {metrics.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)]">No metrics for this genre.</p>
              ) : (
                <div className="space-y-3">
                  {metrics.map(([key, val]) => {
                    const pct = val !== null ? (val / maxValue) * 100 : 0;
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="w-28 truncate text-xs text-[var(--muted-foreground)]">
                          {humanize(key)}
                        </span>
                        <div className="flex-1 h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(pct, 2)}%`,
                              backgroundColor: "var(--chart-1)",
                            }}
                          />
                        </div>
                        <span className="w-16 text-right text-sm tabular-nums font-medium">
                          {val !== null ? formatAnalyticsNumber(val) : "—"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function humanize(value: string): string {
  return value
    .replace(/^_+/, "")
    .replace(/__+/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
