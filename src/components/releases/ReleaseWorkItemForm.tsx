import { TaskPlanningFields, cleanLabels, emptyPlanningOptions, type TaskPlanningOptions } from "../ops-tasks/TaskPlanningFields";
import { useState } from "react";
import { RELEASE_TIMELINE_PHASES, type ReleaseTimelineMilestone, type ReleaseTimelineTask } from "../../server/release-timeline-core";
import { dateAtOffset } from "../../server/release-workback-core";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const field = "mt-1 min-h-9 w-full border border-input bg-background px-2 py-1 text-sm";
export function ReleaseWorkItemForm({ kind, item, phase, releaseDate, milestones, planningOptions = emptyPlanningOptions, busy, onSave, onClose }: {
  planningOptions?: TaskPlanningOptions;
  kind: "task" | "milestone"; item?: ReleaseTimelineTask | ReleaseTimelineMilestone; phase: string;
  releaseDate: string | null; milestones: ReleaseTimelineMilestone[]; busy: boolean;
  onSave: (payload: Record<string, unknown>) => Promise<boolean>; onClose: () => void;
}) {
  const task = item && "milestoneId" in item ? item : null;
  const [planning, setPlanning] = useState({ assignee_ids: task?.assigneeIds ?? [], labels: task?.labels ?? [], dependency_ids: task?.dependencyIds ?? [] });
  const [title, setTitle] = useState(item?.title ?? "");
  const [owner, setOwner] = useState(item?.owner ?? "");
  const [status, setStatus] = useState(item?.status ?? "todo");
  const [due, setDue] = useState(item?.dueDate ?? "");
  const [relative, setRelative] = useState(task?.offsetDays != null);
  const [offset, setOffset] = useState(task?.offsetDays ?? -28);
  const [selectedPhase, setPhase] = useState(item?.phase ?? phase);
  const [milestoneId, setMilestoneId] = useState(task?.milestoneId ?? "");
  const [blocking, setBlocking] = useState(item && "isBlocking" in item ? item.isBlocking : false);
  const statuses = kind === "task" ? ["todo", "in_progress", "blocked", "done"] : ["todo", "in_progress", "done"];
  return <form className="border border-border bg-muted/15 p-3" onSubmit={async (event) => {
    event.preventDefault();
    const timingChanged = !task || relative !== (task.offsetDays != null) || (relative ? offset !== task.offsetDays : due !== (task.dueDate ?? ""));
    const common = { owner: owner.trim() || null, status, due_date: relative && releaseDate ? (timingChanged ? dateAtOffset(releaseDate, offset) : item?.dueDate ?? null) : due || null };
    const payload = kind === "task"
      ? { ...common, ...planning, labels: cleanLabels(planning.labels), task_name: title, timeline_phase: selectedPhase || null, release_milestone_id: milestoneId || null, ...(timingChanged ? { release_offset_days: relative ? offset : null } : {}), ...(owner === (item?.owner ?? "") ? {} : { owner_contact_id: null }) }
      : { ...common, title, phase: selectedPhase, is_blocking: blocking };
    if (await onSave(payload)) onClose();
  }}>
    <h3 className="font-semibold">{item ? "Edit" : "Add"} {kind}</h3>
    <fieldset disabled={busy} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-xs sm:col-span-2 lg:col-span-3">Title<Input autoFocus required maxLength={160} className={field} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      {kind === "milestone" ? <label className="text-xs">Owner<Input className={field} value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="Assign later" /></label> : <div className="sm:col-span-2 lg:col-span-3">{owner && <p className="mb-2 text-xs text-muted-foreground">Previous owner: {owner}</p>}<TaskPlanningFields value={planning} onChange={setPlanning} options={planningOptions} taskId={task?.id} /></div>}
      <label className="text-xs">Status<NativeSelect className={field} value={status} onChange={(event) => setStatus(event.target.value)}>{!statuses.includes(status) && <option value={status}>{status}</option>}{statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</NativeSelect></label>
      <label className="text-xs">Phase<NativeSelect required={kind === "milestone"} disabled={!!milestoneId} className={field} value={selectedPhase} onChange={(event) => setPhase(event.target.value)}><option value="">No phase</option>{RELEASE_TIMELINE_PHASES.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</NativeSelect></label>
      {kind === "task" && <label className="text-xs">Milestone<NativeSelect className={field} value={milestoneId} onChange={(event) => { setMilestoneId(event.target.value); const parent = milestones.find((entry) => entry.id === event.target.value); if (parent) setPhase(parent.phase); }}><option value="">No milestone</option>{milestones.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</NativeSelect></label>}
      <div>{kind === "task" && <label className="flex min-h-8 items-center gap-2 text-xs"><Input type="checkbox" disabled={!releaseDate && !relative} checked={relative} onChange={(event) => setRelative(event.target.checked)} />Relative to release</label>}
        {relative ? <label className="text-xs">Days from release (negative = before)<Input required type="number" min={-3650} max={3650} className={field} value={offset} onChange={(event) => setOffset(Number(event.target.value))} /><span>{releaseDate ? dateAtOffset(releaseDate, offset) : "Set a release date or use a fixed deadline"}</span></label> : <label className="text-xs">Deadline<Input type="date" className={field} value={due} onChange={(event) => setDue(event.target.value)} /></label>}
      </div>
      {kind === "milestone" && <label className="flex items-center gap-2 text-xs"><Input type="checkbox" checked={blocking} onChange={(event) => setBlocking(event.target.checked)} />Blocks the release</label>}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><Button type="submit" disabled={relative && !releaseDate} className="min-h-9 bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save"}</Button><Button variant="outline" className="min-h-9 border border-border px-3 text-sm" type="button" onClick={onClose}>Cancel</Button></div>
    </fieldset>
  </form>;
}
