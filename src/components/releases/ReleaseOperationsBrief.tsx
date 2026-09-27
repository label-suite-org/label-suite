"use client";

import { AlertTriangle, ArrowUpRight, CheckCircle2, Eye, ShieldCheck } from "lucide-react";
import type { ReleaseBriefActionKey, ReleaseBriefItem, ReleaseOperationsBrief as ReleaseOperationsBriefData } from "../../server/release-operations-brief-core";

import { Button } from "@/components/ui/button";
export function ReleaseOperationsBrief({
  brief,
  onAction,
}: {
  brief: ReleaseOperationsBriefData;
  onAction: (action: ReleaseBriefActionKey, evidenceHref: string) => void;
}) {
  const visibleItems = brief.items.slice(0, 6);
  const remaining = brief.items.length - visibleItems.length;

  return (
    <section className="overflow-hidden rounded-[1.5rem] border border-border bg-card shadow-[0_18px_60px_rgba(0,0,0,0.035)]" aria-labelledby="release-operations-brief-heading">
      <div className="flex flex-col gap-3 border-b border-border bg-muted/50 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <ShieldCheck className="h-3 w-3" /> Grounded
            </span>
          </div>
          <h2 id="release-operations-brief-heading" className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Operations brief</h2>
          <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{brief.headline}</p>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{brief.summary}</p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="text-xs font-medium text-foreground">Derived from live workspace records</p>
          <p className="mt-1 text-xs text-muted-foreground">{brief.sourcesChecked.length} source{brief.sourcesChecked.length === 1 ? "" : "s"} checked</p>
        </div>
      </div>

      {brief.status === "clear" ? (
        <div className="flex items-start gap-3 p-4 text-emerald-700 dark:text-emerald-300 sm:p-5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-50 dark:bg-emerald-950/40">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div>
            <p className="font-medium">Nothing needs intervention from the records checked.</p>
            <p className="mt-1 text-sm text-muted-foreground">Creative review and monitoring can continue without the brief inventing additional work.</p>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {visibleItems.map((entry) => (
            <BriefRow key={entry.id} item={entry} onAction={onAction} />
          ))}
          {remaining > 0 && <p className="px-4 py-3 text-xs text-muted-foreground sm:px-5">{remaining} lower-priority item{remaining === 1 ? "" : "s"} remain in the linked records.</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border bg-muted/20 px-4 py-3 text-[11px] text-muted-foreground sm:px-5">
        <Eye className="h-3.5 w-3.5" />
        <span>Checked: {brief.sourcesChecked.join(" · ")}</span>
        <span className="ml-auto">Proposal only · no automatic changes</span>
      </div>
    </section>
  );
}

function BriefRow({ item, onAction }: { item: ReleaseBriefItem; onAction: (action: ReleaseBriefActionKey, evidenceHref: string) => void }) {
  const tone = item.severity === "blocker"
    ? "border-destructive/35 bg-destructive/10 text-destructive"
    : item.severity === "attention"
      ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : "border-secondary/35 bg-secondary/10 text-secondary-foreground";

  return (
    <article className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${tone}`}>
          {item.severity === "blocker" ? <AlertTriangle className="h-4 w-4" /> : item.severity === "attention" ? <Eye className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{item.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${tone}`}>{item.severity}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
          <a
            href={item.evidence.href}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline decoration-border underline-offset-4 transition hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Evidence: {item.evidence.label} <ArrowUpRight className="h-3 w-3" />
          </a>
        </div>
      </div>
      <Button
        type="button"
        onClick={() => onAction(item.actionKey, item.evidence.href)}
        className="inline-flex h-9 items-center justify-center rounded-full border border-primary bg-primary px-4 text-xs font-medium text-primary-foreground transition hover:bg-primary/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:justify-self-end"
      >
        {item.actionLabel}
      </Button>
    </article>
  );
}
