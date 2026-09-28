import { ReleaseCalendar } from "./ReleaseCalendar";
import { TaskLabels, emptyPlanningOptions } from "../ops-tasks/TaskPlanningFields";
import { Check, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { openStatus, type ReleaseTimeline as ReleaseTimelineData, type ReleaseTimelineMilestone, type ReleaseTimelineTask } from "../../server/release-timeline-core";
import { daysBetween, reschedulePreview, workBucket } from "../../server/release-workback-core";
import { ReleaseWorkbackBuilder } from "./ReleaseWorkbackBuilder";
import { ReleaseWorkItemForm } from "./ReleaseWorkItemForm";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type Props = { releaseId: string; canManage: boolean; timeline: ReleaseTimelineData | null };
type WorkItem = (ReleaseTimelineMilestone & { kind: "milestone" }) | (ReleaseTimelineTask & { kind: "task" });
const buckets = ["Overdue", "Next 7 days", "Upcoming", "Unscheduled", "Done"] as const;
const money = (amount: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(amount);
const healthLabel = { blocked: "Blocked", attention: "Needs attention", complete: "Complete", on_track: "On track", not_started: "No work planned" };

export function ReleaseTimeline({ releaseId, canManage, timeline: initialTimeline }: Props) {
  const [timeline, setTimeline] = useState(initialTimeline);
  const [view, setView] = useState("Schedule");
  const [label, setLabel] = useState("");
  const [phase, setPhase] = useState("");
  const [owner, setOwner] = useState("");
  const [filter, setFilter] = useState("Open");
  const [editor, setEditor] = useState<{ kind: "task" | "milestone"; item?: WorkItem } | null>(null);
  const [builder, setBuilder] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [refreshing, setRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState("");
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setRefreshing(true); setRefreshError("");
    void (async () => {
      try {
        const response = await fetch(`/api/release-milestones?release_id=${encodeURIComponent(releaseId)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not refresh the release schedule. Try again before making changes.");
        const current = await response.json();
        if (!controller.signal.aborted) setTimeline(current);
      } catch (cause) {
        if (!controller.signal.aborted) setRefreshError(cause instanceof Error ? cause.message : "Could not refresh the release schedule.");
      } finally {
        if (!controller.signal.aborted) setRefreshing(false);
      }
    })();
    return () => controller.abort();
  }, [releaseId, refreshAttempt]);

  if (refreshing || refreshError || !timeline) return <section className="border border-border p-3" aria-label="Release schedule"><h2 className="text-sm font-semibold">Release schedule</h2><p role={refreshError ? "alert" : "status"} className="mt-1 text-sm text-muted-foreground">{refreshing ? "Refreshing release schedule…" : refreshError || "Schedule data is unavailable."}</p>{!refreshing && <Button type="button" onClick={() => setRefreshAttempt((attempt) => attempt + 1)}>Retry</Button>}</section>;

  const tasks = [...timeline.phases.flatMap((entry) => entry.tasks), ...(timeline.unphasedTasks ?? [])];
  const milestones = timeline.phases.flatMap((entry) => entry.milestones);
  const items: WorkItem[] = [...tasks.map((item) => ({ ...item, kind: "task" as const })), ...milestones.map((item) => ({ ...item, kind: "milestone" as const }))];
  const options = timeline.planningOptions ?? emptyPlanningOptions;
  const knownTasks = [...options.tasks.filter((task) => !tasks.some((item) => item.id === task.id)), ...tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, dueDate: task.dueDate, dependencyIds: task.dependencyIds ?? [], labels: task.labels ?? [] }))];
  const waiting = (item: WorkItem) => item.kind === "task" ? knownTasks.filter((task) => item.dependencyIds?.includes(task.id) && openStatus(task.status)) : [];
  const boardStatus = (item: WorkItem) => openStatus(item.status) ? waiting(item).length || item.status.toLowerCase() === "blocked" ? "blocked" : item.status.toLowerCase() === "in_progress" ? "in_progress" : "todo" : "done";
  const assigned = (item: WorkItem) => item.kind === "task" && item.assigneeIds?.length ? item.assigneeIds.map((id) => options.members.find((member) => member.id === id)?.name ?? "Former member").join(", ") : item.owner;
  const open = items.filter((item) => item.kind === "task" && openStatus(item.status));
  const pending = reschedulePreview(tasks, timeline.releaseDate);
  const visible = items.filter((item) => (!phase || (phase === "unphased" ? !item.phase : item.phase === phase))
    && (!owner || (owner === "unassigned" ? !assigned(item)?.trim() : item.kind === "task" && item.assigneeIds?.includes(owner) || item.owner === owner))
    && (!label || item.kind === "task" && item.labels?.includes(label))
    && (filter === "All" || (filter === "Open" ? openStatus(item.status) : filter === "Blocked" ? boardStatus(item) === "blocked" : workBucket(item, timeline.today) === filter)))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.title.localeCompare(b.title));
  const phaseDetail = timeline.phases.find((entry) => entry.key === phase);
  const completedTasks = tasks.filter((task) => !openStatus(task.status)).length;

  const mutate = async (url: string, method: string, payload: unknown) => {
    if (busy) return false;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not save your change.");
      if (body.timeline) setTimeline(body.timeline);
      else {
        const refresh = await fetch(`/api/release-milestones?release_id=${encodeURIComponent(releaseId)}`);
        if (!refresh.ok) throw new Error("Change saved, but the overview could not refresh. Refresh before making more changes.");
        setTimeline(await refresh.json());
      }
      setNotice(body.created == null ? "Saved" : `${body.created} tasks added · ${body.reused} existing tasks kept${body.rescheduled ? ` · ${body.rescheduled} deadlines moved` : ""}`);
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your change."); return false; }
    finally { setBusy(false); }
  };
  const edit = (kind: "task" | "milestone", item?: WorkItem) => { setEditor({ kind, item }); setBuilder(false); setError(""); };
  const closeEditor = () => setEditor(null);
  const renderItem = (item: WorkItem) => {
          const done = !openStatus(item.status);
          const parent = item.kind === "task" ? milestones.find((entry) => entry.id === item.milestoneId) : null;
          const unfinished = item.kind === "milestone" ? tasks.filter((task) => task.milestoneId === item.id && openStatus(task.status)).length : 0;
          return <li key={`${item.kind}-${item.id}`} id={`task-${item.id}`} className="flex items-start gap-3 p-3">
            <Button disabled={!canManage || busy} type="button" aria-label={`${done ? "Reopen" : "Complete"} ${item.title}`} title={unfinished ? `${unfinished} linked tasks still open; signing off remains your decision` : undefined} onClick={() => void mutate(item.kind === "task" ? "/api/ops-tasks" : "/api/release-milestones", "PUT", { id: item.id, status: done ? "todo" : "done" })} className={`grid size-6 shrink-0 place-items-center border disabled:opacity-50 ${done ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground"}`}>{done && <Check className="size-4" />}</Button>
            <div className={`grid min-w-0 flex-1 gap-2 ${view === "Board" ? "" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}>
              <div><p className={`break-words text-sm font-medium ${done ? "text-muted-foreground line-through" : ""}`}>{item.title}{item.kind === "milestone" && <span className="ml-2 text-xs text-muted-foreground">Milestone{item.isBlocking ? " · Blocks release" : ""}</span>}</p>
                <p className="mt-1 text-xs text-muted-foreground">{timeline.phases.find((entry) => entry.key === item.phase)?.label ?? "No phase"}{parent ? ` · ${parent.title}` : ""}{unfinished ? ` · ${unfinished} linked tasks still open` : ""}</p>
                <p className="mt-1 text-xs">{assigned(item) || "Unassigned"} · {boardStatus(item).replaceAll("_", " ")}</p>
                {item.kind === "task" && <div className="mt-2 space-y-1"><TaskLabels labels={item.labels ?? []} />
                  {knownTasks.filter((entry) => item.dependencyIds?.includes(entry.id)).map((entry) => <p key={entry.id} className={`text-xs ${openStatus(entry.status) ? "text-amber-800 dark:text-amber-200" : "text-muted-foreground"}`}>{openStatus(entry.status) ? "Waiting on: " : "Completed prerequisite: "}<a className="underline" href={`/ops-tasks?task=${encodeURIComponent(entry.id)}`}>{entry.title}</a>{entry.dueDate && item.dueDate && entry.dueDate > item.dueDate ? " · Due after this task" : ""}</p>)}
                  {knownTasks.filter((entry) => entry.dependencyIds.includes(item.id)).map((entry) => <p key={entry.id} className="text-xs text-muted-foreground">Blocks: <a className="underline" href={`/ops-tasks?task=${encodeURIComponent(entry.id)}`}>{entry.title}</a></p>)}
                </div>}
              </div>
              <div className="text-xs sm:text-right"><p className={workBucket(item, timeline.today) === "Overdue" ? "font-medium text-red-700 dark:text-red-300" : ""}>{item.dueDate ?? "No deadline"}{item.dueDate && timeline.releaseDate ? ` · ${daysBetween(timeline.releaseDate, item.dueDate) > 0 ? "+" : ""}${daysBetween(timeline.releaseDate, item.dueDate)}d from release` : ""}</p>{item.kind === "task" && item.offsetDays != null && <p className="mt-1 text-muted-foreground">Relative deadline</p>}{canManage && <Button variant="link" disabled={busy} type="button" className="min-h-8 underline" aria-label={`Edit ${item.title}`} onClick={() => edit(item.kind, item)}>Edit</Button>}</div>
            </div>
          </li>;
  };
  return <section className="space-y-4 border border-border bg-background p-3 sm:p-4" aria-label="Release schedule">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-semibold">Release schedule</h2><p className="mt-1 text-sm text-muted-foreground">{timeline.releaseDate ? `${timeline.releaseDate} · ${daysBetween(timeline.today, timeline.releaseDate) >= 0 ? `${daysBetween(timeline.today, timeline.releaseDate)} days to release` : `${-daysBetween(timeline.today, timeline.releaseDate)} days since release`}` : "Set a release date to plan backwards."}</p></div>
      <div className="flex flex-wrap gap-2"><a className="min-h-9 border border-border px-3 py-2 text-xs" href="/ops-tasks">All tasks</a>{canManage && <Button disabled={busy || !timeline.releaseDate} className="min-h-9 bg-primary px-3 text-xs text-primary-foreground disabled:opacity-50" type="button" onClick={() => { setBuilder(!builder); setEditor(null); }}>Add suggested tasks</Button>}</div>
    </header>
    <ReleaseCalendar releaseId={releaseId} canManage={canManage} />
    <section aria-label="Release dates and milestones" className="overflow-x-auto border border-border">
      <h3 className="px-3 py-2 text-sm font-semibold">Release dates & milestones</h3>
      <table className="w-full text-left text-sm"><thead className="bg-muted/30"><tr><th scope="col" className="p-2">Event</th><th scope="col" className="p-2">Date</th><th scope="col" className="p-2">Tasks complete</th></tr></thead><tbody>
        {[{ id: "release", title: "Release day", date: timeline.releaseDate, href: null }, ...timeline.phases.flatMap((entry) => entry.childReleases).map((child) => ({ id: child.id, title: child.title, date: child.releaseDate, href: `/releases/${child.id}` })), ...milestones.map((milestone) => ({ id: milestone.id, title: milestone.title, date: milestone.dueDate, href: null }))].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999")).map((event) => {
          const linked = tasks.filter((task) => task.milestoneId === event.id);
          return <tr key={event.id} className="border-t border-border"><td className="p-2">{event.href ? <a className="underline" href={event.href}>{event.title}</a> : event.title}</td><td className="whitespace-nowrap p-2">{event.date ?? "Not scheduled"}</td><td className="p-2">{event.id === "release" ? `${completedTasks}/${tasks.length}` : linked.length ? `${linked.filter((task) => !openStatus(task.status)).length}/${linked.length}` : "—"}</td></tr>;
        })}
      </tbody></table>
      {milestones.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">Add milestones for deliveries, uploads, videos and announcements, then link their tasks.</p>}
    </section>
    <nav className="flex gap-2" aria-label="Schedule views">{["Schedule", "Board"].map((name) => <Button key={name} variant={view === name ? "default" : "outline"} type="button" aria-pressed={view === name} className={`min-h-9 border border-border px-4 text-sm ${view === name ? "bg-primary text-primary-foreground" : ""}`} onClick={() => { setView(name); setFilter(name === "Board" ? "All" : "Open"); }}>{name}</Button>)}</nav>
    <div className="flex flex-wrap gap-2 text-sm">
      {[{ label: "Overdue", count: open.filter((item) => workBucket(item, timeline.today) === "Overdue").length }, { label: "Next 7 days", count: open.filter((item) => workBucket(item, timeline.today) === "Next 7 days").length }, { label: "Blocked", count: open.filter((item) => boardStatus(item) === "blocked").length }].map((entry) => <Button key={entry.label} variant="outline" type="button" aria-pressed={filter === entry.label} onClick={() => { setFilter(entry.label); setPhase(""); setOwner(""); }} className={`min-h-9 border px-3 ${entry.label === "Overdue" && entry.count ? "border-red-300 text-red-700 dark:text-red-300" : "border-border"}`}><strong>{entry.count}</strong> {entry.label}</Button>)}
      <Button variant="outline" type="button" className="min-h-9 border border-border px-3" onClick={() => { setOwner("unassigned"); setFilter("Open"); setPhase(""); }}><strong>{open.filter((item) => !assigned(item)?.trim()).length}</strong> Unassigned</Button>
      <span className="px-2 py-2 text-xs text-muted-foreground">Tasks complete: {completedTasks}/{tasks.length} · Separate from release readiness</span>
    </div>
    <label className="block text-sm sm:hidden">Phase<NativeSelect className="ml-2 min-h-9 max-w-full border border-input bg-background px-2" value={phase} onChange={(event) => setPhase(event.target.value)}><option value="">All phases</option>{timeline.phases.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}<option value="unphased">No phase</option></NativeSelect></label>
    <nav aria-label="Filter by phase" className="hidden flex-wrap gap-2 sm:flex">
      <Button variant="outline" type="button" aria-pressed={!phase} onClick={() => setPhase("")} className={`min-h-9 border px-3 text-xs ${phase ? "border-border" : "border-foreground bg-muted"}`}>All phases</Button>
      {timeline.phases.map((entry) => <Button key={entry.key} variant="outline" type="button" aria-pressed={phase === entry.key} onClick={() => setPhase(entry.key)} className={`min-h-9 border px-3 py-2 text-left text-xs ${phase === entry.key ? "border-foreground bg-muted" : "border-border"}`}><span className="font-medium">{entry.label}</span><span className={`mt-1 block ${entry.health === "blocked" ? "text-red-700 dark:text-red-300" : entry.health === "attention" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{healthLabel[entry.health]} · {entry.completeCount}/{entry.totalCount}</span></Button>)}
      {(timeline.unphasedTasks?.length ?? 0) > 0 && <Button variant="outline" type="button" aria-pressed={phase === "unphased"} onClick={() => setPhase("unphased")} className="min-h-9 border border-border px-3 text-xs">No phase ({timeline.unphasedTasks!.length})</Button>}
    </nav>
    {pending.length > 0 && <div className="border border-amber-300 bg-amber-50/30 p-3 text-sm"><p>{pending.length} relative deadlines differ from the current release date.</p><Button variant="link" className="min-h-9 underline" type="button" onClick={() => setShowReschedule(!showReschedule)}>Review deadline changes</Button>
      {showReschedule && <div className="space-y-2"><ul>{pending.map((item) => <li key={item.id}>{item.title}: {item.dueDate || "No date"} → {item.newDate}{item.newDate < timeline.today ? " · Already past" : ""}</li>)}</ul><p className="text-xs">Fixed deadlines and completed tasks keep their dates.</p>{canManage && <Button disabled={busy} type="button" className="min-h-9 bg-primary px-3 text-primary-foreground disabled:opacity-50" onClick={async () => { if (await mutate("/api/release-workback", "POST", { action: "reschedule", releaseId, releaseDate: timeline.releaseDate, preview: pending })) setShowReschedule(false); }}>Apply deadline changes</Button>}</div>}
    </div>}
    {error && <p role="alert" className="border border-red-300 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {builder && timeline.releaseDate && <ReleaseWorkbackBuilder releaseDate={timeline.releaseDate} today={timeline.today} tasks={tasks} planningOptions={options} busy={busy} onClose={() => setBuilder(false)} onApply={(entries) => mutate("/api/release-workback", "POST", { action: "apply", releaseId, releaseDate: timeline.releaseDate, items: entries })} />}
    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
      <div className="flex flex-wrap gap-2"><label className="text-xs">Show<NativeSelect className="ml-2 min-h-9 border border-input bg-background px-2" value={filter} onChange={(event) => setFilter(event.target.value)}>{["Open", "All", ...buckets, "Blocked"].map((value) => <option key={value}>{value}</option>)}</NativeSelect></label>
      <label className="text-xs">Assignee<NativeSelect className="ml-2 min-h-9 max-w-48 border border-input bg-background px-2" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">Everyone</option><option value="unassigned">Unassigned</option>{options.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}{Array.from(new Set(items.map((item) => item.owner).filter((value): value is string => !!value?.trim()))).sort().map((value) => <option key={value}>{value}</option>)}</NativeSelect></label><label className="text-xs">Label<NativeSelect className="ml-2 min-h-9 border border-input bg-background px-2" value={label} onChange={(event) => setLabel(event.target.value)}><option value="">All labels</option>{Array.from(new Set(tasks.flatMap((task) => task.labels ?? []))).sort().map((value) => <option key={value}>{value}</option>)}</NativeSelect></label></div>
      {canManage && <div className="flex gap-2"><Button disabled={busy} type="button" onClick={() => edit("milestone")} className="min-h-8 px-2 text-xs font-medium"><Plus className="mr-1 inline size-4" />Milestone</Button><Button disabled={busy} type="button" onClick={() => edit("task")} className="min-h-8 px-2 text-xs font-medium"><Plus className="mr-1 inline size-4" />Task</Button></div>}
    </div>
    {editor && <ReleaseWorkItemForm key={`${editor.kind}-${editor.item?.id ?? "new"}`} kind={editor.kind} item={editor.item} phase={phaseDetail?.key ?? ""} releaseDate={timeline.releaseDate} milestones={milestones} planningOptions={{ ...options, tasks: knownTasks }} busy={busy} onClose={closeEditor} onSave={(payload) => mutate(editor.kind === "task" ? "/api/ops-tasks" : "/api/release-milestones", editor.item ? "PUT" : "POST", { ...payload, ...(editor.item ? { id: editor.item.id } : editor.kind === "task" ? { linked_release_id: releaseId } : { release_id: releaseId }) })} />}
    {!visible.length && <p className="py-5 text-sm text-muted-foreground">{items.length ? "No work matches these filters." : "No work planned yet. Add a task or add suggested tasks to get started."}</p>}
    {view === "Board" ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[{ key: "todo", title: "To do" }, { key: "in_progress", title: "In progress" }, { key: "blocked", title: "Blocked" }, { key: "done", title: "Done" }].map((column) => {
      const rows = visible.filter((item) => item.kind === "task" && boardStatus(item) === column.key);
      return <section key={column.key} aria-label={column.title} className="min-w-0 border border-border bg-muted/20 p-2"><h3 className="p-2 text-sm font-semibold">{column.title} · {rows.length}</h3><ul className="space-y-2 bg-background">{rows.map(renderItem)}</ul>{!rows.length && <p className="p-2 text-xs text-muted-foreground">No tasks</p>}</section>;
    })}</div> : <div className="space-y-4">
      {visible.filter((item) => item.kind === "milestone").map((milestone) => <section key={milestone.id} aria-label={milestone.title} className="border-l-2 border-foreground"><ul className="divide-y divide-border">{renderItem(milestone)}{visible.filter((item) => item.kind === "task" && item.milestoneId === milestone.id).map(renderItem)}</ul></section>)}
      {buckets.map((bucket) => {
        const rows = visible.filter((item) => item.kind === "task" && workBucket(item, timeline.today) === bucket && !visible.some((parent) => parent.kind === "milestone" && parent.id === item.milestoneId));
        return rows.length ? <section key={bucket} aria-label={bucket}><h3 className="mb-2 text-sm font-semibold">{bucket} · {rows.length}</h3><ul className="divide-y divide-border border border-border">{rows.map(renderItem)}</ul></section> : null;
      })}
    </div>}
    {phaseDetail && <details className="border-t border-border pt-3 text-sm"><summary className="cursor-pointer">{phaseDetail.label} · Phase dates and budget</summary><p className="mt-2 text-xs text-muted-foreground">{phaseDetail.startDate} → {phaseDetail.endDate}</p><p className="mt-2">Planned {money(phaseDetail.budget.planned)} · Committed {money(phaseDetail.budget.committed)} · Paid {money(phaseDetail.budget.paid)}</p></details>}
    {timeline.phases.some((entry) => entry.childReleases.length > 0) && <details className="border-t border-border pt-3 text-sm"><summary className="cursor-pointer">Connected release dates</summary>{timeline.phases.flatMap((entry) => entry.childReleases).map((child) => <a key={child.id} className="mt-2 block underline" href={`/releases/${child.id}`}>{child.title} · {child.releaseDate || "No release date"} · {child.ready ? "Delivery ready" : "Needs finishing"}</a>)}</details>}
  </section>;
}
