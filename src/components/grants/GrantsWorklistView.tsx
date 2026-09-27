"use client";

import { Check, ExternalLink, ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { buildGrantsWorklist, type GrantsWorklistItem } from "../../server/grants-worklist-core";
import { formatCoverageMoney } from "../funding/money";
import type { FundingProjectView, GrantApplicationView } from "./grants-workspace-ui";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Props = {
  applications: GrantApplicationView[];
  projects?: FundingProjectView[];
  currentUserName?: string | null;
  today?: string;
  canMutate?: boolean;
  onEdit?: (application: GrantApplicationView) => void;
  onComplete?: (item: GrantsWorklistItem) => Promise<void> | void;
  additionalItems?: GrantsWorklistItem[];
};

const HORIZONS = [7, 30, 90] as const;

export default function GrantsWorklistView({ applications, projects = [], currentUserName = null, today, canMutate = true, onEdit, onComplete, additionalItems = [] }: Props) {
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);
  const [owner, setOwner] = useState("all");
  const [project, setProject] = useState("all");
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [completing, setCompleting] = useState<string | null>(null);
  const owners = [...new Set(applications.map((application) => application.ownerName).filter(Boolean) as string[])].sort();
  const projectOptions = projects.length
    ? projects.map((item) => ({ id: item.id, name: item.name }))
    : [...new Map(applications.filter((item) => item.projectId).map((item) => [item.projectId!, { id: item.projectId!, name: item.projectName ?? item.projectId! }])).values()];
  const worklist = useMemo(() => [...new Map([...buildGrantsWorklist({ applications, today, horizonDays: horizon }), ...additionalItems].map((item) => [item.id, item])).values()]
    .filter((item) => !completed.has(item.id))
    .filter((item) => owner === "all" || item.ownerName === owner || (owner === "mine" && item.ownerName === currentUserName))
    .filter((item) => project === "all" || item.projectId === project), [applications, today, horizon, completed, owner, currentUserName, project, additionalItems]);

  async function complete(item: GrantsWorklistItem) {
    if (!onComplete || !["action", "reporting"].includes(item.kind)) return;
    setCompleting(item.id);
    try {
      await onComplete(item);
      setCompleted((current) => new Set(current).add(item.id));
    } finally {
      setCompleting(null);
    }
  }

  return (
    <section className="space-y-4" aria-labelledby="grants-worklist-heading">
      <div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2"><ListChecks className="size-5" aria-hidden="true" /><h2 id="grants-worklist-heading" className="text-lg font-semibold">What needs doing</h2></div>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Deadlines, owned actions, missing materials, and reporting dues in one queue. Overdue work floats to the top; undated work stays visible at the bottom.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-9 items-center gap-2 border border-border bg-background px-3 text-xs text-muted-foreground">Horizon<NativeSelect value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as (typeof HORIZONS)[number])} className="bg-transparent text-foreground outline-none" aria-label="Worklist horizon">{HORIZONS.map((value) => <option key={value} value={value}>{value} days</option>)}</NativeSelect></label>
          <label className="inline-flex h-9 items-center gap-2 border border-border bg-background px-3 text-xs text-muted-foreground">Owner<NativeSelect value={owner} onChange={(event) => setOwner(event.target.value)} className="bg-transparent text-foreground outline-none" aria-label="Filter worklist by owner"><option value="all">Everyone</option>{currentUserName && <option value="mine">My actions</option>}{owners.map((value) => <option key={value} value={value}>{value}</option>)}</NativeSelect></label>
          <label className="inline-flex h-9 items-center gap-2 border border-border bg-background px-3 text-xs text-muted-foreground">Project<NativeSelect value={project} onChange={(event) => setProject(event.target.value)} className="max-w-40 bg-transparent text-foreground outline-none" aria-label="Filter worklist by project"><option value="all">All projects</option>{projectOptions.map((value) => <option key={value.id} value={value.id}>{value.name}</option>)}</NativeSelect></label>
        </div>
      </div>

      {worklist.length ? (
        <div className="divide-y divide-border border border-border">
          {worklist.map((item) => <WorklistRow key={item.id} item={item} canMutate={canMutate} today={today} completing={completing === item.id} onEdit={onEdit && item.applicationId ? () => { const application = applications.find((candidate) => candidate.id === item.applicationId); if (application) onEdit(application); } : undefined} onComplete={() => complete(item)} />)}
        </div>
      ) : (
        <div className="border border-dashed border-border px-5 py-14 text-center"><Check className="mx-auto size-5 text-emerald-600" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No work in this horizon</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">The queue will surface application deadlines, next actions, material blockers, and reporting obligations as they become actionable.</p></div>
      )}
    </section>
  );
}

function WorklistRow({ item, canMutate, today, completing, onEdit, onComplete }: { item: GrantsWorklistItem; canMutate: boolean; today?: string; completing: boolean; onEdit?: () => void; onComplete: () => void }) {
  const dueLabel = item.dueDate ? new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${item.dueDate}T00:00:00`)) : "No date";
  const overdue = item.dueDate && item.dueDate < (today ?? new Date().toISOString().slice(0, 10));
  return (
    <article className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_150px_150px_auto] md:items-center">
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex border px-2 py-1 text-[11px] font-medium ${overdue ? "border-red-200 bg-red-50 text-red-700" : item.kind === "materials" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-sky-200 bg-sky-50 text-sky-700"}`}>{overdue ? "Overdue" : item.kind}</span><p className="font-medium">{item.title}</p></div><p className="mt-1 text-sm text-muted-foreground">{item.detail} · {item.projectName || "No project linked"}{item.ownerName ? ` · ${item.ownerName}` : " · Unassigned"}</p></div>
      <div><p className="text-xs text-muted-foreground">Due</p><p className={`mt-1 text-sm font-medium ${overdue ? "text-red-700" : ""}`}>{dueLabel}</p></div>
      <div className="md:text-right"><p className="text-xs text-muted-foreground">At stake</p><p className="mt-1 text-sm font-medium tabular-nums">{formatCoverageMoney(item.amountAtStake, item.currency)}</p></div>
      <div className="flex items-center gap-2 md:justify-end">{["action", "reporting"].includes(item.kind) && canMutate && <Button variant="outline" type="button" onClick={onComplete} disabled={completing} className="inline-flex h-9 items-center gap-1.5 border border-foreground px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{completing ? "Saving…" : item.kind === "reporting" ? "Mark report done" : "Mark done"}</Button>}{onEdit ? <Button variant="outline" type="button" onClick={onEdit} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${item.title}`}><ExternalLink className="size-4" /></Button> : <a href={item.href} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Open ${item.title}`}><ExternalLink className="size-4" /></a>}</div>
    </article>
  );
}
