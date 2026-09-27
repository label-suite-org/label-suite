import { CalendarDays, CircleAlert, FolderKanban, MapPin, UserRound } from "lucide-react";
import { projectTypeLabels } from "../../lib/projects-events-core";
import type { ProjectEventRecord, ProjectRecord } from "./ProjectsEventsWorkspace";

function formatDateRange(start?: string | null, end?: string | null) {
  if (!start && !end) return "Dates not set";
  const format = (value: string) => new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
  if (!start) return `Until ${format(end!)}`;
  if (!end || start === end) return format(start);
  return `${format(start)} – ${format(end)}`;
}

export function ProjectPortfolioView({ projects, events = [] }: { projects: ProjectRecord[]; events?: ProjectEventRecord[] }) {
  if (!projects.length) {
    return (
      <div className="border border-dashed border-border px-5 py-16 text-center">
        <FolderKanban className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">No projects yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Create a release, tour, video, shoot, concert, or production project to start the portfolio.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Project portfolio" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => {
        const type = project.project_type in projectTypeLabels
          ? projectTypeLabels[project.project_type as keyof typeof projectTypeLabels]
          : "Project";
        const nextEvent = events.find((event) => event.project_id === project.id && event.start_date >= new Date().toISOString().slice(0, 10));
        const budgetGap = Math.max(0, (project.total_planned ?? 0) - (project.baseline_funding ?? 0));
        return (
          <a
            key={project.id}
            href={`/projects/${project.id}`}
            className="group border border-border bg-card p-5 text-foreground no-underline transition hover:border-foreground/30 hover:bg-muted/20"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{type}</p>
                <h2 className="mt-1 truncate text-base font-semibold">{project.name}</h2>
              </div>
              <span className="border border-border bg-muted/40 px-2 py-1 text-[11px] capitalize text-muted-foreground">
                {(project.status || "planning").replaceAll("_", " ")}
              </span>
            </div>
            {project.description && <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{project.description}</p>}
            <div className="mt-5 space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <p className="flex items-center gap-2"><UserRound className="size-3.5" />{project.artist_name || "No artist linked"}</p>
              <p className="flex items-center gap-2"><CalendarDays className="size-3.5" />{formatDateRange(project.start_date, project.end_date)}</p>
              <p className="flex items-center gap-2"><MapPin className="size-3.5" />{project.location_name || "Location not set"}</p>
              <p>Health: <span className="capitalize text-foreground">{(project.health || "on_track").replaceAll("_", " ")}</span></p>
              <p>Budget position: <span className="text-foreground">{budgetGap ? `${budgetGap.toLocaleString()} ${String(project.currency || "USD")} gap` : "Covered / not set"}</span></p>
              <p>Next event: <span className="text-foreground">{nextEvent ? `${nextEvent.title} · ${formatDateRange(nextEvent.start_date, null)}` : "None scheduled"}</span></p>
              <p>Next owned action: <span className="text-foreground">{project.next_owned_action || "None assigned"}</span></p>
              <p className="flex items-start gap-2"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span>Blockers: <span className="text-foreground">{project.blockers?.length ? project.blockers.join(" · ") : "None"}</span></span></p>
            </div>
          </a>
        );
      })}
    </section>
  );
}
