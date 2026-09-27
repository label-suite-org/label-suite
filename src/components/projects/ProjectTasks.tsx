export type ProjectTaskRecord = { id: string; task_name: string; status?: string | null; priority?: string | null; due_date?: string | Date | null; owner?: string | null; owner_contact_name?: string | null; next_action?: string | null };

export function ProjectTasks({ tasks = [] }: { tasks?: ProjectTaskRecord[] }) {
  return (
    <section aria-labelledby="project-tasks-heading">
      <div className="flex items-center justify-between"><h2 id="project-tasks-heading" className="font-semibold">Project tasks</h2><a href="/ops-tasks" className="text-sm underline-offset-4 hover:underline">Open task workspace</a></div>
      {!tasks.length ? <p className="mt-3 border border-dashed border-border p-6 text-sm text-muted-foreground">No tasks are linked to this project.</p> : (
        <div className="mt-3 divide-y divide-border border border-border bg-card">{tasks.map((task) => <div key={task.id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto]"><div><p className="text-sm font-medium">{task.task_name}</p>{task.next_action && <p className="mt-1 text-xs text-muted-foreground">Next: {task.next_action}</p>}</div><div className="text-xs capitalize text-muted-foreground">{task.status || "todo"}{task.due_date ? ` · ${String(task.due_date).slice(0, 10)}` : ""}</div></div>)}</div>
      )}
    </section>
  );
}
