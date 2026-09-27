"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowUpRight,
  BadgeCheck,
  CircleDollarSign,
  Disc3,
  FileQuestion,
  Search,
  ShieldAlert,
} from "lucide-react";
import type { WorkPriorityRow } from "../../server/works";
import { WorkCreateDialog, WorkDeleteButton, WorkEditButton } from "./WorkActionButtons";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type FilterKey = "priority" | "payout" | "released" | "unknown" | "unclear" | "cleared" | "all";
type SortKey = "priority" | "revenue" | "released" | "title";

export function WorksList({ works, canMutate = true }: { works: WorkPriorityRow[]; canMutate?: boolean }) {
  const [filter, setFilter] = useState<FilterKey>("priority");
  const [sort, setSort] = useState<SortKey>("priority");
  const [query, setQuery] = useState("");

  const stats = useMemo(() => buildStats(works), [works]);
  const moneyQueue = useMemo(
    () =>
      works
        .filter((work) => workState(work).payoutBlocked)
        .sort((a, b) => b.payoutNet - a.payoutNet || b.priorityScore - a.priorityScore)
        .slice(0, 4),
    [works],
  );

  const visible = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return works
      .filter((work) => {
        const state = workState(work);
        if (filter === "priority") return state.priorityScore > 0;
        if (filter === "payout") return state.payoutBlocked;
        if (filter === "released") return state.releasedNeedsClearance;
        if (filter === "unknown") return work.isUnknown;
        if (filter === "unclear") return !state.allClear;
        if (filter === "cleared") return state.allClear;
        return true;
      })
      .filter((work) => {
        if (!normalizedQuery) return true;
        return [
          work.title,
          work.artistNames,
          work.releaseTitles,
          work.isrc,
          work.iswc,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      })
      .sort((a, b) => {
        if (sort === "revenue") return b.payoutNet - a.payoutNet || b.priorityScore - a.priorityScore;
        if (sort === "released") return b.releasedTrackCount - a.releasedTrackCount || b.priorityScore - a.priorityScore;
        if (sort === "title") return a.title.localeCompare(b.title);
        return b.priorityScore - a.priorityScore || b.payoutNet - a.payoutNet || a.title.localeCompare(b.title);
      });
  }, [filter, query, sort, works]);

  const filters: Array<{ key: FilterKey; label: string; count: number }> = [
    { key: "priority", label: "Priority", count: stats.priority },
    { key: "payout", label: "Payout blocked", count: stats.payoutBlocked },
    { key: "released", label: "Released not cleared", count: stats.releasedBlocked },
    { key: "unknown", label: "Unknown works", count: stats.unknown },
    { key: "unclear", label: "Needs clearance", count: stats.needsClearance },
    { key: "cleared", label: "Cleared", count: stats.cleared },
    { key: "all", label: "All", count: works.length },
  ];

  return (
    <div className="space-y-5">
      <section className="grid gap-3 md:grid-cols-4">
        <TriageStat
          label="Priority queue"
          value={stats.priority}
          detail="needs action"
          tone="neutral"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <TriageStat
          label="Payout blocked"
          value={stats.payoutBlocked}
          detail={formatMoney(stats.blockedNet)}
          tone="red"
          icon={<CircleDollarSign className="h-4 w-4" />}
        />
        <TriageStat
          label="Released uncleared"
          value={stats.releasedBlocked}
          detail="live catalog"
          tone="amber"
          icon={<Disc3 className="h-4 w-4" />}
        />
        <TriageStat
          label="Unknown works"
          value={stats.unknown}
          detail="needs identity"
          tone="blue"
          icon={<FileQuestion className="h-4 w-4" />}
        />
      </section>

      {moneyQueue.length ? <UnblockMoneyQueue works={moneyQueue} /> : null}

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {filters.map((item) => (
              <Button
                key={item.key}
                type="button"
                data-filter={item.key}
                onClick={() => setFilter(item.key)}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                  filter === item.key
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                }`}
              >
                {item.label}
                <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${filter === item.key ? "bg-background/15" : "bg-muted text-muted-foreground"}`}>
                  {item.count}
                </span>
              </Button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search work, artist, release, ISRC..."
                className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none focus:border-foreground sm:w-72"
              />
            </label>
            <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground">
              <ArrowDownUp className="h-4 w-4" aria-hidden="true" />
              <NativeSelect
                value={sort}
                onChange={(event) => setSort(event.target.value as SortKey)}
                className="bg-transparent text-foreground outline-none"
              >
                <option value="priority">Priority first</option>
                <option value="revenue">Blocked money</option>
                <option value="released">Released tracks</option>
                <option value="title">Title</option>
              </NativeSelect>
            </label>
            {canMutate ? <WorkCreateDialog /> : <span className="text-sm text-muted-foreground">Read-only for fundraiser</span>}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="hidden grid-cols-[minmax(280px,1.45fr)_170px_170px_160px_110px] gap-4 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground xl:grid">
          <span>Work</span>
          <span>Why it matters</span>
          <span>Clearance</span>
          <span>Statements</span>
          <span className="text-right">Actions</span>
        </div>
        {visible.length ? (
          <div className="divide-y divide-border">
            {visible.map((work) => (
              <WorkPriorityLine key={work.id} work={work} canMutate={canMutate} />
            ))}
          </div>
        ) : (
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-foreground">No works match this view.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try another priority queue or search term.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function WorkPriorityLine({ work, canMutate }: { work: WorkPriorityRow; canMutate: boolean }) {
  const state = workState(work);
  const priority = priorityBadge(work, state);

  return (
    <div className="grid gap-4 px-4 py-4 transition-colors hover:bg-muted/25 xl:grid-cols-[minmax(280px,1.45fr)_170px_170px_160px_110px] xl:items-center">
      <a href={`/works/${work.id}`} className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{work.title}</h2>
          {work.isUnknown ? <SmallBadge tone="blue">Unknown</SmallBadge> : null}
          {state.allClear ? <SmallBadge tone="green">Cleared</SmallBadge> : null}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {[work.artistNames || "No artist", work.releaseTitles ? `via ${work.releaseTitles}` : null].filter(Boolean).join(" · ")}
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5">{work.trackCount} track{work.trackCount === 1 ? "" : "s"}</span>
          <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono">{work.isrc || "No ISRC"}</span>
          {work.iswc ? <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono">{work.iswc}</span> : null}
        </div>
      </a>

      <div>
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${priority.className}`}>
          {priority.icon}
          {priority.label}
        </span>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{priority.detail}</p>
      </div>

      <div className="space-y-2">
        <ClearanceMeter label="Pub" value={work.pubProgress} count={work.pubRoleCount} cleared={state.pubCleared} />
        <ClearanceMeter label="Master" value={work.masterProgress} count={work.masterRoleCount} cleared={state.masterCleared} />
      </div>

      <div className="text-sm">
        {work.payoutRows ? (
          <>
            <p className={`font-semibold ${state.payoutBlocked ? "text-red-700" : "text-emerald-700"}`}>
              {formatMoney(work.payoutNet)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {work.payoutRows} unpaid row{work.payoutRows === 1 ? "" : "s"}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">No unpaid statement rows</p>
        )}
      </div>

      <div className="flex items-center justify-start gap-1 xl:justify-end">
        {canMutate && <><WorkEditButton work={work} /><WorkDeleteButton work={work} /></>}
      </div>
    </div>
  );
}

function UnblockMoneyQueue({ works }: { works: WorkPriorityRow[] }) {
  const total = works.reduce((sum, work) => sum + work.payoutNet, 0);

  return (
    <section className="overflow-hidden rounded-lg border border-red-200 bg-red-50/70">
      <div className="flex flex-col gap-2 border-b border-red-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-red-950">Unblock money queue</h2>
          <p className="mt-1 text-sm text-red-700">
            {formatMoney(total)} is waiting on master clearance across the top {works.length} work{works.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            const button = document.querySelector<HTMLButtonElement>("[data-filter='payout']");
            button?.click();
          }}
          className="inline-flex items-center gap-2 self-start rounded-md bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 sm:self-auto"
        >
          Show all blocked
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <div className="grid divide-y divide-red-100 lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {works.map((work) => (
          <a key={work.id} href={`/works/${work.id}`} className="block p-4 transition-colors hover:bg-white/70">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-red-950">{work.title}</p>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-semibold tracking-tight text-red-800">{formatMoney(work.payoutNet)}</p>
            <p className="mt-1 text-xs leading-5 text-red-700">
              {work.masterRoleCount ? `${Math.round(work.masterProgress)}% master confirmed` : "Missing master split"}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}

function ClearanceMeter({ label, value, count, cleared }: { label: string; value: number; count: number; cleared: boolean }) {
  const pct = Math.min(Math.max(Math.round(value), 0), 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${cleared ? "text-emerald-700" : count ? "text-amber-700" : "text-red-700"}`}>
          {count ? `${pct}%` : "Missing"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${cleared ? "bg-emerald-600" : count ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${count ? pct : 8}%` }} />
      </div>
    </div>
  );
}

function TriageStat({
  label,
  value,
  detail,
  tone,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  tone: "neutral" | "red" | "amber" | "blue";
  icon: React.ReactNode;
}) {
  const toneClass = {
    neutral: "text-foreground bg-muted",
    red: "text-red-700 bg-red-50 border-red-100",
    amber: "text-amber-700 bg-amber-50 border-amber-100",
    blue: "text-blue-700 bg-blue-50 border-blue-100",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
        <span className={`flex h-8 w-8 items-center justify-center rounded-md border ${toneClass}`}>{icon}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function SmallBadge({ tone, children }: { tone: "green" | "blue"; children: React.ReactNode }) {
  const className = tone === "green"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-blue-200 bg-blue-50 text-blue-700";
  return <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${className}`}>{children}</span>;
}

function buildStats(works: WorkPriorityRow[]) {
  return works.reduce(
    (stats, work) => {
      const state = workState(work);
      if (state.priorityScore > 0) stats.priority += 1;
      if (state.payoutBlocked) stats.payoutBlocked += 1;
      if (state.releasedNeedsClearance) stats.releasedBlocked += 1;
      if (work.isUnknown) stats.unknown += 1;
      if (!state.allClear) stats.needsClearance += 1;
      if (state.allClear) stats.cleared += 1;
      if (state.payoutBlocked) stats.blockedNet += work.payoutNet;
      return stats;
    },
    { priority: 0, payoutBlocked: 0, releasedBlocked: 0, unknown: 0, needsClearance: 0, cleared: 0, blockedNet: 0 },
  );
}

function workState(work: WorkPriorityRow) {
  const pubCleared = work.pubRoleCount > 0 && work.pubEntered >= 99.5 && work.pubEntered <= 100.5 && work.pubProgress >= 100;
  const masterCleared = work.masterRoleCount > 0 && work.masterEntered >= 99.5 && work.masterEntered <= 100.5 && work.masterProgress >= 100;
  const allClear = pubCleared && masterCleared;
  const payoutBlocked = work.payoutRows > 0 && !masterCleared;
  const releasedNeedsClearance = work.releasedTrackCount > 0 && !allClear;
  return {
    pubCleared,
    masterCleared,
    allClear,
    payoutBlocked,
    releasedNeedsClearance,
    priorityScore: work.priorityScore,
  };
}

function priorityBadge(work: WorkPriorityRow, state = workState(work)) {
  if (state.payoutBlocked) {
    return {
      label: "Payout blocked",
      detail: "Unpaid statement rows need master split clearance.",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <CircleDollarSign className="h-3.5 w-3.5" />,
    };
  }
  if (state.releasedNeedsClearance) {
    return {
      label: "Released not cleared",
      detail: `${work.releasedTrackCount} released track${work.releasedTrackCount === 1 ? "" : "s"} still need rights fixed.`,
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <Disc3 className="h-3.5 w-3.5" />,
    };
  }
  if (work.isUnknown) {
    return {
      label: "Unknown work",
      detail: "Needs identity cleanup before clearance is trustworthy.",
      className: "border-blue-200 bg-blue-50 text-blue-700",
      icon: <FileQuestion className="h-3.5 w-3.5" />,
    };
  }
  if (work.pubRoleCount === 0 || work.masterRoleCount === 0) {
    return {
      label: "Missing splits",
      detail: "Publishing or master ownership has not been entered.",
      className: "border-red-200 bg-red-50 text-red-700",
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    };
  }
  if (work.pendingRoleCount > 0) {
    return {
      label: "Signature chase",
      detail: `${work.pendingRoleCount} split${work.pendingRoleCount === 1 ? "" : "s"} pending or unknown.`,
      className: "border-amber-200 bg-amber-50 text-amber-700",
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
    };
  }
  if (state.allClear) {
    return {
      label: "Cleared",
      detail: "Publishing and master are balanced and confirmed.",
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
      icon: <BadgeCheck className="h-3.5 w-3.5" />,
    };
  }
  return {
    label: "Review",
    detail: "No urgent blocker, but clearance is not complete.",
    className: "border-neutral-200 bg-neutral-50 text-neutral-700",
    icon: <ShieldAlert className="h-3.5 w-3.5" />,
  };
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}
