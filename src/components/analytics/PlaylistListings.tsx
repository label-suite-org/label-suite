import { useMemo } from "react";
import type { AnalyticsWidgetRow } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

interface Props {
  rows: AnalyticsWidgetRow[];
}

export default function PlaylistListings({ rows }: Props) {
  const columns = useMemo(() => {
    const keySet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.dimensions)) {
        if (row.dimensions[key]) keySet.add(key);
      }
      for (const key of Object.keys(row.metrics)) {
        if (row.metrics[key] !== null) keySet.add(key);
      }
    }
    return Array.from(keySet);
  }, [rows]);

  if (!rows.length) {
    return (
      <section>
        <p className="text-sm text-[var(--muted-foreground)]">No playlist data available.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        {rows.length} listings
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)]">
              {columns.map((col) => (
                <th key={col} className="pb-2 pr-3 text-left font-normal">
                  {humanize(col)}
                </th>
              ))}
              <th className="pb-2 pl-3 text-right font-normal">Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((col) => {
                  const dimVal = row.dimensions[col];
                  const metVal = row.metrics[col];
                  const val = dimVal ?? metVal;
                  return (
                    <td
                      key={col}
                      className="py-2 pr-3 max-w-[16rem] truncate"
                      title={String(val ?? "")}
                    >
                      {typeof val === "number" ? (
                        <span className="tabular-nums">{formatAnalyticsNumber(val)}</span>
                      ) : (
                        val ?? "—"
                      )}
                    </td>
                  );
                })}
                <td className="py-2 pl-3 text-right text-xs text-[var(--muted-foreground)] whitespace-nowrap">
                  {row.lastSeenAt?.toLocaleDateString() ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
