import { useMemo } from "react";
import type { AnalyticsWidgetRow } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

interface Props {
  rows: AnalyticsWidgetRow[];
}

export default function DemographicsTable({ rows }: Props) {
  const headers = useMemo(() => {
    const keySet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.dimensions)) {
        keySet.add(key);
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
        <p className="text-sm text-[var(--muted-foreground)]">No demographic data available.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <p className="text-xs text-[var(--muted-foreground)]">
        {rows.length} data points
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)]">
              <th className="pb-2 pr-3 text-left font-normal">Label</th>
              {headers.map((h) => (
                <th key={h} className="pb-2 px-3 text-right font-normal">
                  {humanize(h)}
                </th>
              ))}
              <th className="pb-2 pl-3 text-right font-normal">Seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((row) => (
              <tr key={row.id}>
                <td
                  className="py-2 pr-3 font-medium max-w-[12rem] truncate"
                  title={row.label}
                >
                  {row.label}
                </td>
                {headers.map((h) => {
                  const dimVal = row.dimensions[h];
                  const metVal = row.metrics[h];
                  const val = dimVal ?? metVal;
                  return (
                    <td key={h} className="py-2 px-3 text-right tabular-nums text-[var(--muted-foreground)]">
                      {typeof val === "number" ? formatAnalyticsNumber(val) : val ?? "—"}
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
