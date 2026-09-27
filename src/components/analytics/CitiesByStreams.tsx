import { useState, useMemo } from "react";
import type { AnalyticsCityRow } from "../../server/analytics";
import { formatAnalyticsNumber } from "./utils";

import { Input } from "@/components/ui/input";
interface Props {
  rows: AnalyticsCityRow[];
}

export default function CitiesByStreams({ rows }: Props) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) => r.city.toLowerCase().includes(q));
  }, [rows, filter]);

  const maxStreams = useMemo(() => Math.max(...rows.map((r) => r.streams), 1), [rows]);

  if (!rows.length) {
    return (
      <section>
        <p className="text-sm text-[var(--muted-foreground)]">No city data available.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--muted-foreground)]">
          {filtered.length} of {rows.length} cities
        </p>
        <Input
          type="text"
          placeholder="Filter cities…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 rounded border border-[var(--border)] bg-transparent px-2 text-xs w-44 outline-none focus:border-[var(--foreground)]"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)]">
              <th className="pb-2 pr-2 text-left font-normal">#</th>
              <th className="pb-2 pr-2 text-left font-normal">City</th>
              <th className="pb-2 pr-2 text-right font-normal">Streams</th>
              <th className="pb-2 pr-2 text-right font-normal">Superfans</th>
              <th className="pb-2 pr-2 text-right font-normal">Tracks</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {filtered.map((row, i) => {
              const pct = (row.streams / maxStreams) * 100;
              return (
                <tr key={`${row.city}-${i}`}>
                  <td className="py-2 pr-2 text-xs text-[var(--muted-foreground)] w-8 align-middle">
                    {i + 1}
                  </td>
                  <td className="py-2 pr-2 font-medium align-middle">{row.city}</td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold align-middle">
                    {formatAnalyticsNumber(row.streams)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums align-middle">
                    {row.listeners === null ? "—" : formatAnalyticsNumber(row.listeners)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums align-middle">
                    {row.trackCount}
                  </td>
                  <td className="py-2 pl-2 min-w-[6rem] align-middle">
                    <div className="h-2 bg-[var(--muted)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.max(pct, 1)}%`,
                          backgroundColor: "var(--chart-2)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
