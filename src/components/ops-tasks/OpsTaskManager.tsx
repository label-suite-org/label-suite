"use client";

import { TaskLabels, emptyPlanningOptions, type TaskPlanningOptions } from "./TaskPlanningFields";
import { openStatus } from "../../server/release-timeline-core";
import { useState } from "react";
import { CalendarDays, UserRound } from "lucide-react";
import { workBucket } from "../../server/release-workback-core";
import { OpsTaskForm, type OpsTask } from "./OpsTaskForm";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const STATUS_COLUMNS = [
  { key: "todo", label: "To Do", color: "bg-neutral-100 text-neutral-600" },
  { key: "in_progress", label: "In Progress", color: "bg-blue-100 text-blue-700" },
  { key: "blocked", label: "Blocked", color: "bg-red-100 text-red-700" },
  { key: "done", label: "Done", color: "bg-green-100 text-green-700" },
];

const PRIORITY_COLORS: Record<string, string> = {
  P0: "bg-red-100 text-red-700",
  P1: "bg-orange-100 text-orange-700",
  P2: "bg-neutral-100 text-neutral-600",
  P3: "bg-neutral-50 text-neutral-400",
};

export function OpsTaskManager({
  initialTasks,
  artists,
  releases,
  campaigns,
  contacts,
  projects,
  events,
  canMutate = true,
  planningOptions = emptyPlanningOptions,
  initialTaskId = null,
}: {
  initialTasks: Array<OpsTask & {
    id: string;
    artist_name?: string | null;
    release_title?: string | null;
    campaign_name?: string | null;
    contact_name?: string | null;
    owner_contact_name?: string | null;
    project_name?: string | null;
    event_title?: string | null;
    event_start_date?: string | null;
  }>;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  campaigns: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string; start_date?: string | null }>;
  canMutate?: boolean;
  planningOptions?: TaskPlanningOptions;
  initialTaskId?: string | null;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [labelFilter, setLabelFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const assignees = (task: OpsTask & { owner_contact_name?: string | null }) => task.assignee_ids?.length ? task.assignee_ids.map((id) => planningOptions.members.find((member) => member.id === id)?.name ?? "Former member").join(", ") : task.owner_contact_name || task.owner;
  const waiting = (task: OpsTask) => tasks.filter((entry) => task.dependency_ids?.includes(entry.id) && openStatus(entry.status));
  const boardStatus = (task: OpsTask) => openStatus(task.status) ? waiting(task).length || task.status === "blocked" ? "blocked" : task.status === "in_progress" ? "in_progress" : "todo" : "done";
  const [releaseFilter, setReleaseFilter] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [deadlineFilter, setDeadlineFilter] = useState("");
  const today = tasks[0]?.today ?? new Date().toISOString().slice(0, 10);
  const filteredTasks = tasks.filter((task) => (!releaseFilter || task.linked_release_id === releaseFilter)
    && (!ownerFilter || (ownerFilter === "unassigned" ? !assignees(task)?.trim() : task.assignee_ids?.includes(ownerFilter) || (task.owner_contact_name || task.owner) === ownerFilter))
    && (!labelFilter || task.labels?.includes(labelFilter))
    && (!deadlineFilter || workBucket({ status: task.status ?? "todo", dueDate: task.due_date ?? null }, today) === deadlineFilter));
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(initialTaskId);

  async function mutateTask(taskId: string, method: "PUT" | "DELETE", status?: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/ops-tasks", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: taskId, ...(status ? { status } : {}) }) });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "Could not save task"); }
      setTasks((previous) => method === "DELETE" ? previous.filter((task) => task.id !== taskId) : previous.map((task) => task.id === taskId ? { ...task, status } : task));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save task"); }
    finally { setBusy(false); }
  }
  async function quickStatus(taskId: string, status: string) { await mutateTask(taskId, "PUT", status); }
  async function deleteTask(taskId: string) { if (confirm("Delete this task?")) await mutateTask(taskId, "DELETE"); }

  const editing = tasks.find((t) => t.id === editingId);

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{filteredTasks.length} tasks</p>
        {canMutate && <Button onClick={() => setCreating(true)}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90">
          + New Task
        </Button>}
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <label>Release<NativeSelect className="ml-2 min-h-9 max-w-64 border border-input bg-background px-2" value={releaseFilter} onChange={(event) => setReleaseFilter(event.target.value)}><option value="">All releases</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</NativeSelect></label>
        <label>Assignee<NativeSelect className="ml-2 min-h-9 border border-input bg-background px-2" value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="">Everyone</option><option value="unassigned">Unassigned</option>{planningOptions.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}{Array.from(new Set(tasks.map((task) => task.owner_contact_name || task.owner).filter((owner): owner is string => !!owner?.trim()))).sort().map((owner) => <option key={owner}>{owner}</option>)}</NativeSelect></label>
        <label>Label<NativeSelect className="ml-2 min-h-9 border border-input bg-background px-2" value={labelFilter} onChange={(event) => setLabelFilter(event.target.value)}><option value="">All labels</option>{[...new Set(tasks.flatMap((task) => task.labels ?? []))].sort().map((label) => <option key={label}>{label}</option>)}</NativeSelect></label>
        <label>Deadline<NativeSelect className="ml-2 min-h-9 border border-input bg-background px-2" value={deadlineFilter} onChange={(event) => setDeadlineFilter(event.target.value)}><option value="">Any deadline</option>{["Overdue", "Next 7 days", "Upcoming", "Unscheduled", "Done"].map((bucket) => <option key={bucket}>{bucket}</option>)}</NativeSelect></label>
      </div>
      {canMutate && creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreating(false)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">New Ops Task</h2>
            <OpsTaskForm artists={artists} releases={releases} campaigns={campaigns} contacts={contacts} projects={projects} events={events} planningOptions={{ ...planningOptions, tasks: tasks.map((task) => ({ id: task.id, title: task.task_name ?? "Task", status: task.status ?? "todo", dueDate: task.due_date ?? null, dependencyIds: task.dependency_ids ?? [], labels: task.labels ?? [] })) }} onClose={() => setCreating(false)} />
          </div>
        </div>
      )}

      {canMutate && editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditingId(null)}>
          <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-xl font-bold mb-4">Edit Task</h2>
            <OpsTaskForm initial={editing} artists={artists} releases={releases} campaigns={campaigns} contacts={contacts} projects={projects} events={events} planningOptions={{ ...planningOptions, tasks: tasks.map((task) => ({ id: task.id, title: task.task_name ?? "Task", status: task.status ?? "todo", dueDate: task.due_date ?? null, dependencyIds: task.dependency_ids ?? [], labels: task.labels ?? [] })) }} onClose={() => setEditingId(null)} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {STATUS_COLUMNS.map((col) => {
          const items = filteredTasks.filter((t) => boardStatus(t) === col.key);
          return (
            <div key={col.key} className="bg-muted/18 p-3 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${col.color}`}>
                  {col.label}
                </span>
                <span className="text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.length ? (
                items
                  .sort((a, b) => {
                    const pa = a.priority || "P2";
                    const pb = b.priority || "P2";
                    if (pa !== pb) return pa.localeCompare(pb);
                    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
                    return 0;
                  })
                  .map((t) => (
                    <div key={t.id} className="space-y-2 bg-background/85 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm flex-1">{t.task_name}</p>
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${PRIORITY_COLORS[t.priority || "P2"]}`}>
                          {t.priority}
                        </span>
                      </div>
                      <TaskLabels labels={t.labels ?? []} />
                      {tasks.filter((entry) => t.dependency_ids?.includes(entry.id)).map((entry) => <p key={entry.id} className="text-xs">{openStatus(entry.status) ? "Waiting on: " : "Completed prerequisite: "}<Button variant="link" className="underline" onClick={() => setEditingId(entry.id)}>{entry.task_name}</Button>{entry.due_date && t.due_date && entry.due_date > t.due_date ? " · Due after this task" : ""}</p>)}
                      {tasks.filter((entry) => entry.dependency_ids?.includes(t.id)).map((entry) => <p key={entry.id} className="text-xs">Blocks: <Button variant="link" className="underline" onClick={() => setEditingId(entry.id)}>{entry.task_name}</Button></p>)}
                      {t.next_action && <p className="text-xs text-foreground italic">→ {t.next_action}</p>}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {t.due_date && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{t.due_date}</span>}
                        {assignees(t) && <span className="inline-flex items-center gap-1"><UserRound className="h-3.5 w-3.5" />{assignees(t)}</span>}
                      </div>
                      {(t.artist_name || t.release_title || t.campaign_name || t.contact_name || t.project_name || t.event_title) && (
                        <div className="flex flex-wrap items-center gap-1 text-xs">
                          {t.artist_name && <RecordLink href={t.linked_artist_id ? `/artists/${t.linked_artist_id}` : "/artists"}>{t.artist_name}</RecordLink>}
                          {t.release_title && <RecordLink href={t.linked_release_id ? `/releases/${t.linked_release_id}` : "/releases"}>{t.release_title}</RecordLink>}
                          {t.campaign_name && <RecordLink href={t.linked_campaign_id ? `/campaigns/${t.linked_campaign_id}` : "/campaigns"}>{t.campaign_name}</RecordLink>}
                          {t.contact_name && <RecordLink href={t.linked_contact_id ? `/contacts?contact=${t.linked_contact_id}` : "/contacts"}>{t.contact_name}</RecordLink>}
                          {t.project_name && <RecordLink href={t.project_id ? `/projects/${t.project_id}` : "/projects"}>{t.project_name}</RecordLink>}
                          {t.event_title && <RecordLink href={t.event_id ? `/events/${t.event_id}` : "/events"}>{t.event_title}</RecordLink>}
                        </div>
                      )}
                      {canMutate && <div className="flex gap-1 pt-1">
                        {STATUS_COLUMNS.filter((s) => s.key !== col.key).map((s) => (
                          <Button disabled={busy} key={s.key} onClick={() => quickStatus(t.id!, s.key)}
                            className="text-xs px-2 py-0.5 rounded bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                            → {s.label}
                          </Button>
                        ))}
                      </div>}
                      {canMutate && <div className="flex gap-1 border-t border-border/40 pt-1">
                        <Button onClick={() => setEditingId(t.id!)}
                          className="text-xs px-2 py-1 rounded bg-neutral-100 hover:bg-neutral-200 text-foreground flex-1">Edit</Button>
                        <Button onClick={() => deleteTask(t.id!)}
                          className="text-xs px-2 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 flex-1">Delete</Button>
                      </div>}
                    </div>
                  ))
              ) : (
                <p className="text-xs text-muted-foreground italic">No tasks</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecordLink({ href, children }: { href: string; children: string }) {
  return <a href={href} className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-700 underline decoration-transparent underline-offset-2 transition hover:bg-neutral-200 hover:decoration-current dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700">{children}</a>;
}
