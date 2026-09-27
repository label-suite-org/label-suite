"use client";

import { Fragment, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
interface RecordRow {
  id: string;
  record_name: string;
  statement_period: string | null;
  source: string | null;
  gross_revenue: number | null;
  net_revenue: number | null;
  revenue_type: string | null;
  notes: string | null;
  work_title: string | null;
  artist_name: string | null;
  release_title: string | null;
}

type GroupBy = "track" | "period" | "platform";
type PeriodGranularity = "month" | "quarter" | "year";
type SortBy = "revenue" | "name";

interface GroupedRow {
  key: string;
  label: string;
  total: number;
  count: number;
  children: { period: string; total: number; label: string; pctOfMax: number }[];
}

function formatPeriod(period: string, granularity: PeriodGranularity): string {
  if (!period || period.length < 7) return period || "—";
  const [y, m] = period.split("-").map(Number);
  if (granularity === "year") return String(y);
  if (granularity === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${y}`;
}

function extractPlatforms(notes: string | null): string[] {
  if (!notes) return [];
  const match = notes.match(/Platforms:\s*(.+?)(?:\s*\|.*)?$/);
  if (!match) return [];
  return match[1].split(",").map(s => s.trim()).filter(Boolean);
}

export function StatementGroupedView({ records }: { records: RecordRow[] }) {
  const [groupBy, setGroupBy] = useState<GroupBy>("track");
  const [granularity, setGranularity] = useState<PeriodGranularity>("month");
  const [sortBy, setSortBy] = useState<SortBy>("revenue");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const totalNet = useMemo(() => records.reduce((s, r) => s + (r.net_revenue || 0), 0), [records]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; total: number; children: Map<string, number> }>();

    for (const r of records) {
      const period = formatPeriod(r.statement_period || "", granularity);

      let keys: string[];
      let labels: string[];

      if (groupBy === "track") {
        const name = r.work_title || r.record_name;
        keys = [name]; 
        labels = [name];
      } else if (groupBy === "period") {
        keys = [period];
        labels = [period];
      } else {
        // platform
        const platforms = extractPlatforms(r.notes);
        if (platforms.length) {
          keys = platforms;
          labels = platforms;
          // Split revenue equally across platforms
          const revenue = (r.net_revenue || 0) / platforms.length;
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            if (!map.has(k)) map.set(k, { label: labels[i], total: 0, children: new Map() });
            const g = map.get(k)!;
            g.total += revenue;
            const childPeriod = formatPeriod(r.statement_period || "", "month");
            g.children.set(childPeriod, (g.children.get(childPeriod) || 0) + revenue);
          }
          continue;
        } else {
          keys = ["Unknown"];
          labels = ["Unknown"];
        }
      }

      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (!map.has(k)) map.set(k, { label: labels[i], total: 0, children: new Map() });
        const g = map.get(k)!;
        const revenue = (r.net_revenue || 0) / keys.length;
        g.total += revenue;
        g.children.set(period, (g.children.get(period) || 0) + revenue);
      }
    }

    // Convert to sorted array
    const result: GroupedRow[] = [];
    for (const [key, g] of map) {
      const children = Array.from(g.children.entries())
        .map(([period, total]) => ({ period, total, label: period, pctOfMax: 0 }))
        .sort((a, b) => b.period.localeCompare(a.period));

      // Compute pctOfMax for bars
      const maxChild = Math.max(...children.map(c => c.total), 0.01);
      for (const c of children) c.pctOfMax = (c.total / maxChild) * 100;

      result.push({
        key: key + "",
        label: g.label,
        total: g.total,
        count: g.children.size,
        children,
      });
    }

    if (sortBy === "revenue") {
      result.sort((a, b) => b.total - a.total);
    } else {
      result.sort((a, b) => a.label.localeCompare(b.label));
    }
    return result;
  }, [records, groupBy, granularity, sortBy]);

  const filtered = useMemo(() => {
    if (!search.trim()) return grouped;
    const q = search.toLowerCase();
    return grouped.filter(g => g.label.toLowerCase().includes(q));
  }, [grouped, search]);

  const maxTotal = Math.max(...filtered.map(g => g.total), 0.01);

  function toggle(key: string) {
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpanded(next);
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <span>Group by</span>
          {(["track", "period", "platform"] as GroupBy[]).map(g => (
            <Button
              key={g}
              onClick={() => { setGroupBy(g); setExpanded(new Set()); }}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                groupBy === g
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "hover:bg-[var(--muted)]"
              }`}
            >
              {g === "track" ? "Track" : g === "period" ? "Period" : "Platform"}
            </Button>
          ))}
        </div>

        <div className="w-px h-5 bg-[var(--border)]" />

        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <span>Period</span>
          {(["month", "quarter", "year"] as PeriodGranularity[]).map(g => (
            <Button
              key={g}
              onClick={() => setGranularity(g)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                granularity === g
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "hover:bg-[var(--muted)]"
              }`}
            >
              {g === "month" ? "Month" : g === "quarter" ? "Quarter" : "Year"}
            </Button>
          ))}
        </div>

        <div className="w-px h-5 bg-[var(--border)]" />

        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
          <span>Sort</span>
          <Button
            onClick={() => setSortBy("revenue")}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              sortBy === "revenue"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "hover:bg-[var(--muted)]"
            }`}
          >
            Revenue
          </Button>
          <Button
            onClick={() => setSortBy("name")}
            className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
              sortBy === "name"
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "hover:bg-[var(--muted)]"
            }`}
          >
            {groupBy === "period" ? "Date" : "Name"}
          </Button>
        </div>

        <div className="flex-1" />

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter…"
          className="w-40 px-3 py-1.5 text-xs border border-[var(--border)] rounded-md bg-transparent focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
        />
      </div>

      {/* KPI strip */}
      <div className="flex gap-8 mb-6">
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Total Revenue</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            ${totalNet.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Groups</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{filtered.length}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Records</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">{records.length}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--muted-foreground)]">Avg per Group</div>
          <div className="text-2xl font-semibold tabular-nums mt-1">
            ${filtered.length ? (totalNet / filtered.length).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "0"}
          </div>
        </div>
      </div>

      {/* Group rows */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-xs text-[var(--muted-foreground)] font-normal">
              <th className="text-left px-4 py-2.5">{groupBy === "track" ? "Track" : groupBy === "period" ? "Period" : "Platform"}</th>
              <th className="text-right px-4 py-2.5 w-24">Revenue</th>
              <th className="text-right px-4 py-2.5 w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] [&_tbody_tr:nth-child(even)]:bg-[var(--muted)]/20">
            {filtered.map(g => {
              const isOpen = expanded.has(g.key);
              const barPct = (g.total / maxTotal) * 100;
              return (
                <Fragment key={g.key}>
                  <tr
                    key={g.key}
                    onClick={() => g.children.length > 1 && toggle(g.key)}
                    className={`${g.children.length > 1 ? "cursor-pointer hover:bg-[var(--muted)]/40" : ""} transition-colors`}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        {g.children.length > 1 && (
                          <span className="text-[10px] text-[var(--muted-foreground)] transition-transform" style={{ transform: isOpen ? "rotate(90deg)" : "" }}>
                            ▶
                          </span>
                        )}
                        <span className="font-medium">{g.label}</span>
                        {g.count > 1 && (
                          <span className="text-xs text-[var(--muted-foreground)]">{g.count} periods</span>
                        )}
                      </div>
                      {/* Revenue bar */}
                      <div className="mt-1 h-1 bg-[var(--muted)] rounded-full overflow-hidden w-full max-w-md">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${barPct}%`, backgroundColor: "var(--chart-3)" }}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      ${g.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-[var(--muted-foreground)]">
                      {((g.total / totalNet) * 100).toFixed(1)}%
                    </td>
                  </tr>
                  {/* Expanded children */}
                  {isOpen && g.children.map(child => (
                    <tr key={child.period} className="bg-[var(--muted)]/10">
                      <td className="px-4 py-1.5 pl-10">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--muted-foreground)]">{child.label}</span>
                        </div>
                        <div className="mt-0.5 h-0.5 bg-[var(--muted)] rounded-full overflow-hidden w-full max-w-md">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${child.pctOfMax}%`, backgroundColor: "var(--chart-4)" }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right tabular-nums text-xs">
                        ${child.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-1.5 text-right text-xs text-[var(--muted-foreground)]">
                        {((child.total / totalNet) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        {!filtered.length && (
          <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">
            No records match your filter.
          </div>
        )}
      </div>
    </div>
  );
}
