import { useState } from "react";
import { CalendarPlus, FolderPlus } from "lucide-react";
import { EventAgendaView } from "./EventAgendaView";
import { EventFormDrawer } from "./EventFormDrawer";
import { ProjectFormDialog } from "./ProjectFormDialog";
import { ProjectPortfolioView } from "./ProjectPortfolioView";
import type { ReleaseOption, SelectOption } from "./ProjectFormDialog";

import { Button } from "@/components/ui/button";
export type ProjectRecord = {
  id: string;
  name: string;
  project_type: string;
  status?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  location_name?: string | null;
  description?: string | null;
  artist_name?: string | null;
  next_owned_action?: string | null;
  blockers?: string[];
  health?: string | null;
  total_planned?: number | null;
  baseline_funding?: number | null;
  track_count?: number | null;
  singles_count?: number | null;
  [key: string]: unknown;
};

export type ProjectEventRecord = {
  id: string;
  title: string;
  event_type: string;
  start_date: string;
  status?: string | null;
  project_id?: string | null;
  artist_id?: string | null;
  owner_contact_id?: string | null;
  artist_name?: string | null;
  owner_name?: string | null;
  venue_name?: string | null;
  city?: string | null;
  [key: string]: unknown;
};

export default function ProjectsEventsWorkspace({ projects: initialProjects, events: initialEvents, initialView, workspaceRoute = "events", artists = [], releases = [], contacts = [] }: {
  projects: ProjectRecord[];
  events: ProjectEventRecord[];
  initialView: "projects" | "events";
  workspaceRoute?: "projects" | "events";
  artists?: SelectOption[];
  releases?: ReleaseOption[];
  contacts?: SelectOption[];
}) {
  const [projects, setProjects] = useState(initialProjects);
  const [events, setEvents] = useState(initialEvents);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [eventDrawerOpen, setEventDrawerOpen] = useState(false);
  const projectsHref = "/projects";
  const eventsHref = "/events";
  const title = initialView === "projects" ? "Projects" : "Events";
  const description = initialView === "projects"
    ? "Keep release, tour, production, shoot, and other project work connected to the dates that move it forward."
    : "Plan releases, tours, productions, shoots, and the real-world dates that move them forward.";

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" type="button" onClick={() => setEventDrawerOpen(true)} className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm font-medium hover:bg-muted"><CalendarPlus className="size-4" />New event</Button>
          <Button type="button" onClick={() => setProjectDialogOpen(true)} className="inline-flex h-10 items-center gap-2 bg-foreground px-3 text-sm font-medium text-background"><FolderPlus className="size-4" />New project</Button>
        </div>
      </header>

      <nav role="tablist" aria-label="Events and projects workspace views" className="flex border-b border-border">
        <a role="tab" aria-selected={initialView === "events"} href={workspaceRoute === "events" ? eventsHref : `${eventsHref}?view=events`} className={`relative inline-flex h-11 items-center px-4 text-sm font-medium no-underline ${initialView === "events" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Events{initialView === "events" && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}</a>
        <a role="tab" aria-selected={initialView === "projects"} href={workspaceRoute === "projects" ? projectsHref : `${projectsHref}?view=projects`} className={`relative inline-flex h-11 items-center px-4 text-sm font-medium no-underline ${initialView === "projects" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Projects{initialView === "projects" && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}</a>
      </nav>

      {initialView === "projects" ? <ProjectPortfolioView projects={projects} events={events} /> : <EventAgendaView events={events} projects={projects} />}

      <ProjectFormDialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen} artists={artists} releases={releases} contacts={contacts} onCreated={(project) => { setProjects((current) => [...current, project]); setProjectDialogOpen(false); window.location.assign(`/projects/${project.id}`); }} />
      <EventFormDrawer
        open={eventDrawerOpen}
        onOpenChange={setEventDrawerOpen}
        projects={projects}
        artists={artists}
        releases={releases}
        contacts={contacts}
        onPartialCreated={(event) => setEvents((current) => current.some((item) => item.id === event.id) ? current.map((item) => item.id === event.id ? event : item) : [...current, event])}
        onCreated={(event) => {
          setEvents((current) => current.some((item) => item.id === event.id) ? current.map((item) => item.id === event.id ? event : item) : [...current, event]);
          setEventDrawerOpen(false);
          window.location.assign(`/events/${event.id}`);
        }}
      />
    </div>
  );
}
