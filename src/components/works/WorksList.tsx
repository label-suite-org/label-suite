"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
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
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Item, ItemContent, ItemTitle, ItemDescription } from "@/components/ui/item";
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
      <Accordion>
        <AccordionItem value="summary">
          <AccordionTrigger>{visible.length} of {works.length} works · clearance summary</AccordionTrigger>
          <AccordionContent>
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <TriageStat label="Priority queue" value={stats.priority} detail="needs action" />
              <TriageStat label="Payout blocked" value={stats.payoutBlocked} detail={formatMoney(stats.blockedNet)} />
              <TriageStat label="Released uncleared" value={stats.releasedBlocked} detail="live catalog" />
              <TriageStat label="Unknown works" value={stats.unknown} detail="identity to confirm" />
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      {moneyQueue.length ? <UnblockMoneyQueue works={moneyQueue} onShowBlocked={() => setFilter("payout")} /> : null}

      <section className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search works" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search work, artist, release, ISRC…" className="w-full pl-9" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Filter works" value={filter} onValueChange={value => setFilter((value ?? "priority") as FilterKey)} className="max-sm:w-full" options={filters.map(item => ({ value: item.key, label: `${item.label} (${item.count})` }))} />
          <Select aria-label="Sort works" value={sort} onValueChange={value => setSort((value ?? "priority") as SortKey)} className="max-sm:w-full" options={[
            { value: "priority", label: "Priority first" }, { value: "revenue", label: "Blocked money" }, { value: "released", label: "Released tracks" }, { value: "title", label: "Title" },
          ]} />
          {canMutate ? <WorkCreateDialog /> : <span className="self-center text-xs text-muted-foreground">Read-only for your role</span>}
        </div>
      </section>

      <section>
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
    <article className="py-3">
      <Item className="px-0 py-0">
        <ItemContent className="min-w-0">
          <ItemTitle><a href={`/works/${work.id}`} className="hover:underline">{work.title}</a></ItemTitle>
          <ItemDescription>{[work.artistNames || "No artist", work.releaseTitles].filter(Boolean).join(" · ")}</ItemDescription>
        </ItemContent>
        <Badge variant={priority.variant}>{priority.icon}{priority.label}</Badge>
      </Item>
      <Accordion>
        <AccordionItem value="clearance">
          <AccordionTrigger className="py-1.5">Clearance & details <span className="sr-only">for {work.title}</span></AccordionTrigger>
          <AccordionContent className="space-y-4">
            <p className="text-xs text-muted-foreground">{priority.detail}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <ClearanceMeter label="Publishing" value={work.pubProgress} count={work.pubRoleCount} cleared={state.pubCleared} />
                <ClearanceMeter label="Master" value={work.masterProgress} count={work.masterRoleCount} cleared={state.masterCleared} />
              </div>
              <div className="text-sm">
                {work.payoutRows ? <>
                  <p className={state.payoutBlocked ? "text-destructive" : "text-success-foreground"}>{formatMoney(work.payoutNet)}</p>
                  <p className="text-xs text-muted-foreground">{work.payoutRows} unpaid statement rows</p>
                </> : <p className="text-xs text-muted-foreground">No unpaid statement rows</p>}
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p>{work.trackCount} track{work.trackCount === 1 ? "" : "s"}</p>
                <p>ISRC · {work.isrc || "Not entered"}</p>
                {work.iswc ? <p>ISWC · {work.iswc}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`/works/${work.id}`} className="text-sm font-medium">Open rights editor</a>
              {canMutate && <><WorkEditButton work={work} /><WorkDeleteButton work={work} /></>}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </article>
  );
}

function UnblockMoneyQueue({ works, onShowBlocked }: { works: WorkPriorityRow[]; onShowBlocked: () => void }) {
  const total = works.reduce((sum, work) => sum + work.payoutNet, 0);

  return (
    <section className="border-y border-border">
      <div className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Payouts awaiting clearance</h2>
          <p className="mt-1 text-sm text-destructive">
            {formatMoney(total)} is waiting on master clearance across the top {works.length} work{works.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button
          type="button"
          onClick={onShowBlocked}
          variant="outline" className="self-start sm:self-auto"
        >
          Show all blocked
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      <Accordion><AccordionItem value="blocked"><AccordionTrigger>Top blocked works</AccordionTrigger><AccordionContent><div className="grid divide-y divide-border lg:grid-cols-4 lg:divide-x lg:divide-y-0">
        {works.map((work) => (
          <a key={work.id} href={`/works/${work.id}`} className="block p-4 transition-colors hover:bg-muted/50">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-foreground">{work.title}</p>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            </div>
            <p className="mt-2 text-base font-medium text-destructive">{formatMoney(work.payoutNet)}</p>
            <p className="mt-1 text-xs leading-5 text-destructive">
              {work.masterRoleCount ? `${Math.round(work.masterProgress)}% master confirmed` : "Missing master split"}
            </p>
          </a>
        ))}
      </div></AccordionContent></AccordionItem></Accordion>
    </section>
  );
}

function ClearanceMeter({ label, value, count, cleared }: { label: string; value: number; count: number; cleared: boolean }) {
  const pct = Math.min(Math.max(Math.round(value), 0), 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-medium ${cleared ? "text-success-foreground" : count ? "text-warning-foreground" : "text-destructive"}`}>
          {count ? `${pct}%` : "Missing"}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${cleared ? "bg-success-foreground" : count ? "bg-warning-foreground" : "bg-destructive"}`} style={{ width: `${count ? pct : 8}%` }} />
      </div>
    </div>
  );
}

function TriageStat({ label, value, detail }: { label: string; value: number; detail: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-medium">{value}</dd><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>;
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
      variant: "destructive" as const,
      icon: <CircleDollarSign className="h-3.5 w-3.5" />,
    };
  }
  if (state.releasedNeedsClearance) {
    return {
      label: "Released not cleared",
      detail: `${work.releasedTrackCount} released track${work.releasedTrackCount === 1 ? "" : "s"} still need rights fixed.`,
      variant: "warning" as const,
      icon: <Disc3 className="h-3.5 w-3.5" />,
    };
  }
  if (work.isUnknown) {
    return {
      label: "Unknown work",
      detail: "Needs identity cleanup before clearance is trustworthy.",
      variant: "secondary" as const,
      icon: <FileQuestion className="h-3.5 w-3.5" />,
    };
  }
  if (work.pubRoleCount === 0 || work.masterRoleCount === 0) {
    return {
      label: "Missing splits",
      detail: "Publishing or master ownership has not been entered.",
      variant: "destructive" as const,
      icon: <AlertTriangle className="h-3.5 w-3.5" />,
    };
  }
  if (work.pendingRoleCount > 0) {
    return {
      label: "Signature chase",
      detail: `${work.pendingRoleCount} split${work.pendingRoleCount === 1 ? "" : "s"} pending or unknown.`,
      variant: "warning" as const,
      icon: <ShieldAlert className="h-3.5 w-3.5" />,
    };
  }
  if (state.allClear) {
    return {
      label: "Cleared",
      detail: "Publishing and master are balanced and confirmed.",
      variant: "success" as const,
      icon: <BadgeCheck className="h-3.5 w-3.5" />,
    };
  }
  return {
    label: "Review",
    detail: "No urgent blocker, but clearance is not complete.",
    variant: "secondary" as const,
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
