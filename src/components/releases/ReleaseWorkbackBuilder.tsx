import { CheckList, emptyPlanningOptions, type TaskPlanningOptions } from "../ops-tasks/TaskPlanningFields";
import { useState } from "react";
import { dateAtOffset, normalizedTitle, WORKBACK_CHECKLIST } from "../../server/release-workback-core";
import type { ReleaseTimelineTask } from "../../server/release-timeline-core";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
const field = "min-h-9 w-full border border-input bg-background px-2 py-1 text-sm";
export function ReleaseWorkbackBuilder({ releaseDate, today, tasks, planningOptions = emptyPlanningOptions, busy, onApply, onClose }: {
  planningOptions?: TaskPlanningOptions;
  releaseDate: string; today: string; tasks: ReleaseTimelineTask[]; busy: boolean;
  onApply: (items: { key: string; title: string; phase: string; owner: string | null; assigneeIds: string[]; dueDate: string; offsetDays: number | null }[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [items, setItems] = useState(() => WORKBACK_CHECKLIST.map((item) => ({ ...item, selected: true, owner: "", assigneeIds: [] as string[], relative: true, dueDate: dateAtOffset(releaseDate, item.offsetDays) })));
  const existing = (item: typeof items[number]) => tasks.some((task) => task.workbackKey === item.key || normalizedTitle(task.title) === normalizedTitle(item.title) || normalizedTitle(task.title) === normalizedTitle(WORKBACK_CHECKLIST.find((entry) => entry.key === item.key)!.title));
  const selected = items.filter((item) => item.selected && !existing(item));
  return <form className="space-y-3 border border-border bg-muted/15 p-3" onSubmit={async (event) => {
    event.preventDefault();
    if (await onApply(selected.map((item) => ({ key: item.key, title: item.title, phase: item.phase, owner: item.owner || null, assigneeIds: item.assigneeIds, dueDate: item.relative ? dateAtOffset(releaseDate, item.offsetDays) : item.dueDate, offsetDays: item.relative ? item.offsetDays : null })))) onClose();
  }}>
    <h3 className="font-semibold">Add suggested tasks</h3>
    <p className="text-sm text-muted-foreground">Suggested starting points. Adjust these to your release and distributor requirements. Existing matching tasks will be kept.</p>
    <fieldset disabled={busy} className="space-y-3">
      {items.map((item, index) => {
        const reuse = existing(item);
        const due = item.relative ? dateAtOffset(releaseDate, item.offsetDays) : item.dueDate;
        const change = (patch: Partial<typeof item>) => setItems((rows) => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
        return <div key={item.key} className="grid gap-2 border-t border-border pt-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div><label className="flex min-h-9 items-center gap-2 text-sm"><Input type="checkbox" checked={item.selected && !reuse} disabled={reuse} onChange={(event) => change({ selected: event.target.checked })} />{WORKBACK_CHECKLIST[index].title}{reuse && <span className="text-muted-foreground"> · Already planned</span>}</label>
          {!reuse && <Input aria-label={`Task title: ${WORKBACK_CHECKLIST[index].title}`} className={field} required={item.selected} value={item.title} onChange={(event) => change({ title: event.target.value })} />}</div>
          {!reuse && <><CheckList title="Assignees" choices={planningOptions.members} selected={item.assigneeIds} onChange={(ids) => change({ assigneeIds: ids })} />
          <div><label className="flex min-h-9 items-center gap-2 text-xs"><Input type="checkbox" checked={item.relative} onChange={(event) => change({ relative: event.target.checked, dueDate: due })} />Relative to release</label>
            {item.relative ? <label className="text-xs">Days from release (negative = before)<Input className={field} type="number" min={-3650} max={3650} required value={item.offsetDays} onChange={(event) => change({ offsetDays: Number(event.target.value) })} /></label> : <label className="text-xs">Fixed deadline<Input className={field} type="date" required={item.selected} value={item.dueDate} onChange={(event) => change({ dueDate: event.target.value })} /></label>}
            <p className={`mt-1 text-xs ${due < today ? "text-red-700 dark:text-red-300" : "text-muted-foreground"}`}>{due}{due < today ? " · Already past — review deadline" : ""}</p>
          </div></>}
        </div>;
      })}
      <div className="flex gap-2"><Button type="submit" className="min-h-9 bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50" disabled={!selected.length}>Add {selected.length} tasks</Button><Button variant="outline" type="button" className="min-h-9 border border-border px-3 text-sm" onClick={onClose}>Cancel</Button></div>
    </fieldset>
  </form>;
}
