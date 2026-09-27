import { CalendarDays } from "lucide-react";
import { eventTypeLabels } from "../../lib/projects-events-core";
import type { ProjectEventRecord } from "./ProjectsEventsWorkspace";

export function ProjectSchedule({ events = [] }: { events?: ProjectEventRecord[] }) {
  return (
    <section aria-labelledby="project-schedule-heading">
      <h2 id="project-schedule-heading" className="font-semibold">Project schedule</h2>
      {!events.length ? <p className="mt-3 border border-dashed border-border p-6 text-sm text-muted-foreground">No events are linked to this project.</p> : (
        <div className="mt-3 divide-y divide-border border border-border bg-card">
          {events.map((event) => <a key={event.id} href={`/events/${event.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 no-underline hover:bg-muted/50">
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{event.title}</p><p className="text-xs capitalize text-muted-foreground">{eventTypeLabels[event.event_type as keyof typeof eventTypeLabels] || event.event_type.replaceAll("_", " ")}</p></div>
            <time className="text-sm text-muted-foreground">{event.start_date}</time>
          </a>)}
        </div>
      )}
    </section>
  );
}
