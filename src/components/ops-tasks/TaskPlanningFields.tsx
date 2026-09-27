import { useState } from "react";

import { Input } from "@/components/ui/input";
export type TaskPlanning = { assignee_ids: string[]; labels: string[]; dependency_ids: string[] };
export type TaskPlanningOptions = {
  members: { id: string; name: string }[];
  tasks: { id: string; title: string; status: string; dueDate: string | null; dependencyIds: string[]; labels: string[] }[];
};
export const emptyPlanningOptions: TaskPlanningOptions = { members: [], tasks: [] };

export function CheckList({ title, choices, selected, onChange }: { title: string; choices: { id: string; name: string }[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [search, setSearch] = useState("");
  return <fieldset className="min-w-0 border border-border p-2"><legend className="px-1 text-xs font-medium">{title} ({selected.length})</legend>
    <Input aria-label={`Search ${title.toLowerCase()}`} placeholder={`Search ${title.toLowerCase()}`} className="min-h-9 w-full border border-input bg-background px-2 text-sm" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="mt-1 max-h-36 overflow-y-auto">{choices.filter((choice) => choice.name.toLowerCase().includes(search.toLowerCase())).map((choice) => <label key={choice.id} className="flex min-h-9 items-center gap-2 text-sm"><Input type="checkbox" checked={selected.includes(choice.id)} onChange={(event) => onChange(event.target.checked ? [...selected, choice.id] : selected.filter((id) => id !== choice.id))} />{choice.name}</label>)}</div>
    {!choices.length && <p className="py-2 text-xs text-muted-foreground">None available.</p>}
    {selected.filter((id) => !choices.some((choice) => choice.id === id)).map((id) => <label key={id} className="flex min-h-9 items-center gap-2 text-xs"><Input type="checkbox" checked onChange={() => onChange(selected.filter((value) => value !== id))} />Unavailable selection — remove to reassign</label>)}
  </fieldset>;
}
export function TaskPlanningFields({ value, onChange, options, taskId }: { value: TaskPlanning; onChange: (value: TaskPlanning) => void; options: TaskPlanningOptions; taskId?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <CheckList title="Assignees" choices={options.members} selected={value.assignee_ids} onChange={(ids) => onChange({ ...value, assignee_ids: ids })} />
    <CheckList title="Dependencies" choices={options.tasks.filter((task) => task.id !== taskId).map((task) => ({ id: task.id, name: `${task.title}${task.dueDate ? ` · ${task.dueDate}` : ""}` }))} selected={value.dependency_ids} onChange={(ids) => onChange({ ...value, dependency_ids: ids })} />
    <label className="text-xs sm:col-span-2">Labels<Input className="mt-1 min-h-9 w-full border border-input bg-background px-2 text-sm" placeholder="Audio, Artwork, Distribution" value={value.labels.join(", ")} onChange={(event) => onChange({ ...value, labels: event.target.value.split(",").map((label) => label.trimStart()) })} /><span className="mt-1 block text-muted-foreground">Separate labels with commas. Dependencies are tasks that must happen first.</span></label>
  </div>;
}
export const cleanLabels = (labels: string[]) => [...new Set(labels.map((label) => label.trim()).filter(Boolean))];
const colors = ["bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200", "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-200", "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"];
export function TaskLabels({ labels }: { labels: string[] }) {
  return <div className="flex flex-wrap gap-1">{labels.map((label) => <span key={label} className={`rounded px-2 py-1 text-xs ${colors[Array.from(label).reduce((sum, char) => sum + char.charCodeAt(0), 0) % colors.length]}`}>{label}</span>)}</div>;
}
