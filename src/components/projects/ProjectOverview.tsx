import type { ProjectRecord } from "./ProjectsEventsWorkspace";

function label(value: unknown) {
  return typeof value === "string" && value ? value.replaceAll("_", " ") : "—";
}

export function ProjectOverview({ project }: { project: ProjectRecord }) {
  const summary = typeof project.description === "string" && project.description
    ? project.description
    : typeof project.notes === "string" && project.notes ? project.notes : "No project summary yet.";
  return (
    <section aria-labelledby="project-overview-heading" className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <div className="min-w-0 border border-border bg-card p-5">
        <h2 id="project-overview-heading" className="font-semibold">Project overview</h2>
        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{summary}</p>
      </div>
      <dl className="min-w-0 grid grid-cols-2 gap-x-4 gap-y-5 border border-border bg-card p-5 text-sm">
        <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Type</dt><dd className="mt-1 capitalize">{label(project.project_type)}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Status</dt><dd className="mt-1 capitalize">{label(project.status)}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">Start</dt><dd className="min-w-0 break-words mt-1">{label(project.start_date)}</dd></div>
        <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">End</dt><dd className="min-w-0 break-words mt-1">{label(project.end_date)}</dd></div>
        <div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-muted-foreground">Location</dt><dd className="min-w-0 break-words mt-1">{label(project.location_name)}</dd></div>
      </dl>
    </section>
  );
}
