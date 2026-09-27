import { useState } from "react";
import { CalendarDays, Circle, MapPin, Pencil, UserRound } from "lucide-react";
import { eventTypeLabels } from "../../lib/projects-events-core";
import { EventFormDrawer } from "./EventFormDrawer";
import type { ProjectEventRecord, ProjectRecord } from "./ProjectsEventsWorkspace";
import type { ReleaseOption, SelectOption } from "./ProjectFormDialog";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type EventProjectTaskRecord = { id: string; task_name?: string | null; [key: string]: unknown };
type EventProjectDocumentRecord = { id: string; name?: string | null; [key: string]: unknown };
type EventProjectMediaRecord = { id: string; asset_name?: string | null; [key: string]: unknown };
type EventProjectEventRecord = { id: string; title?: string | null; [key: string]: unknown };

export type EventProjectContext = {
  id?: string;
  name?: string;
  events?: EventProjectEventRecord[];
  tasks?: EventProjectTaskRecord[];
  documents?: EventProjectDocumentRecord[];
  mediaAssets?: EventProjectMediaRecord[];
  shared_campaigns?: {
    id: string;
    campaign_name: string | null;
    campaign_type: string | null;
    status: string | null;
    linked_artist_id: string | null;
    linked_release_id: string | null;
    artist_name?: string | null;
    release_title?: string | null;
  }[];
};

export type EventDetailRecord = ProjectEventRecord & {
  end_date?: string | null; starts_at?: string | Date | null; ends_at?: string | Date | null; all_day?: boolean | null;
  timezone?: string | null; address?: string | null; region?: string | null; country_code?: string | null;
  notes?: string | null; owner_name?: string | null; project_name?: string | null;
  artist_name?: string | null; release_title?: string | null; contact_name?: string | null;
  artist_id?: string | null;
  release_id?: string | null;
  contact_id?: string | null;
  project_context?: EventProjectContext | null;
};

export function buildEventProjectPatch(projectId: string | null) { return { project_id: projectId }; }
export function transitionEventProject<T extends EventDetailRecord>(event: T, projectId: string | null): T { return { ...event, project_id: projectId }; }
export async function patchEventProject(eventId: string, projectId: string | null, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/events/${encodeURIComponent(eventId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildEventProjectPatch(projectId)) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not update the event project.");
  return result;
}

function displayDateTime(event: EventDetailRecord) {
  if (event.all_day !== false || !event.starts_at) return event.end_date && event.end_date !== event.start_date ? `${event.start_date} – ${event.end_date}` : event.start_date;
  const start = new Date(event.starts_at);
  const end = event.ends_at ? new Date(event.ends_at) : null;
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short", timeZone: event.timezone || undefined };
  return `${start.toLocaleString("en", options)}${end ? ` – ${end.toLocaleTimeString("en", { timeStyle: "short", timeZone: event.timezone || undefined })}` : ""}`;
}

export function ProjectEventDetail({ event: initialEvent, projects, artists = [], releases = [], contacts = [], project_context }: { event: EventDetailRecord; projects: ProjectRecord[]; artists?: SelectOption[]; releases?: ReleaseOption[]; contacts?: SelectOption[]; project_context?: EventProjectContext | null }) {
  const [event, setEvent] = useState(initialEvent);
  const [editing, setEditing] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const linkedProject = projects.find((project) => project.id === event.project_id);
  const projectName = project_context?.name || "Project";
  const projectId = project_context?.id;
  const linkedCampaigns = project_context?.shared_campaigns || [];
  const linkedTasks = project_context?.tasks || [];
  const linkedDocuments = project_context?.documents || [];
  const linkedMediaAssets = project_context?.mediaAssets || [];
  const linkedEvents = (project_context?.events || []).filter((eventItem) => eventItem.id !== event.id).slice(0, 4);
  async function changeProject(projectId: string | null) { setSavingProject(true); setError(null); try { await patchEventProject(event.id, projectId); setEvent((current: EventDetailRecord) => transitionEventProject(current, projectId)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the project."); } finally { setSavingProject(false); } }
  const location = [event.venue_name, event.address, event.city, event.region, event.country_code].filter(Boolean).join(", ");
  return <div className="space-y-6">
    <header><a href={event.project_id ? `/projects/${event.project_id}?tab=schedule` : "/events"} className="text-sm text-muted-foreground no-underline hover:text-foreground">{linkedProject?.name || event.project_name || "Events"}</a><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{event.title}</h1><span className="inline-flex items-center gap-1.5 border border-border px-2 py-1 text-xs"><CalendarDays className="size-3" />{eventTypeLabels[event.event_type as keyof typeof eventTypeLabels] || event.event_type.replaceAll("_", " ")}</span><span className="inline-flex items-center gap-1.5 text-xs capitalize text-muted-foreground"><Circle className="size-2 fill-current" />{event.status || "planned"}</span></div></header>
    {error && <p role="alert" className="border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]"><div className="space-y-4 border border-border bg-card p-5"><Detail icon={<CalendarDays className="size-4" />} label="Date and time" value={displayDateTime(event)} />{event.timezone && <p className="pl-7 text-xs text-muted-foreground">Timezone: {event.timezone}</p>}<Detail icon={<MapPin className="size-4" />} label="Location" value={location || "No location"} /><Detail icon={<UserRound className="size-4" />} label="Owner" value={event.owner_name || "Unassigned"} /><Detail icon={<UserRound className="size-4" />} label="Artist" value={event.artist_name || "Unassigned"} /><Detail icon={<UserRound className="size-4" />} label="Release" value={event.release_title || "Unassigned"} /><Detail icon={<UserRound className="size-4" />} label="Contact" value={event.contact_name || "Unassigned"} />{event.notes && <div className="border-t border-border pt-4"><h2 className="text-sm font-medium">Notes</h2><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{event.notes}</p></div>}</div><aside className="space-y-4 border border-border bg-card p-5"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Project</p>{linkedProject ? <a href={`/projects/${linkedProject.id}`} className="mt-2 block text-sm font-medium">{linkedProject.name}</a> : <p className="mt-2 text-sm font-medium">Standalone</p>}</div><label className="block text-xs text-muted-foreground">Attach or move<NativeSelect disabled={savingProject} value={event.project_id || ""} onChange={(change) => void changeProject(change.target.value || null)} className="mt-1 h-10 w-full border border-border bg-background px-3 text-sm"><option value="">No project (Standalone)</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect></label>{event.project_id && <Button type="button" disabled={savingProject} onClick={() => void changeProject(null)} className="h-10 w-full border border-border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50">Detach from project</Button>}<Button type="button" onClick={() => setEditing(true)} className="inline-flex h-10 w-full items-center justify-center gap-2 bg-foreground px-3 text-sm font-medium text-background"><Pencil className="size-4" />Edit event</Button></aside></section>
    {project_context && <section className="grid gap-4 lg:grid-cols-2">
      {projectId && projectName ? <div className="border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Project and seam context</h2>
        <a href={`/projects/${projectId}`} className="mt-3 block text-sm font-medium">{projectName}</a>
        <div className="mt-3 text-sm text-muted-foreground">{project_context.events?.length || 0} linked event(s)</div>
        <div className="mt-2 text-sm text-muted-foreground">{linkedTasks.length} task(s)</div>
        <div className="mt-2 text-sm text-muted-foreground">{linkedDocuments.length} document(s)</div>
        <div className="mt-2 text-sm text-muted-foreground">{linkedMediaAssets.length} media asset(s)</div>
      </div> : null}
      <div className="border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{projectId ? "Linked events" : "Related events"}</h2>
        {linkedEvents.length ? <ul className="mt-2 space-y-2 text-sm">{linkedEvents.map((eventItem) => <li key={eventItem.id}><a href={`/events/${eventItem.id}`} className="text-foreground hover:underline">{eventItem.title}</a></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No other linked events</p>}
      </div>
      <div className="border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Campaign seam links</h2>
        {linkedCampaigns.length ? <ul className="mt-2 space-y-2 text-sm">{linkedCampaigns.map((campaign) => <li key={campaign.id}><a href={`/campaigns/${campaign.id}`} className="text-foreground hover:underline">{campaign.campaign_name || "Campaign"}</a><span className="text-muted-foreground"> · {campaign.campaign_type || "campaign"} · {campaign.status || "active"}</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No linked campaigns</p>}
      </div>
      <div className="border border-border bg-card p-4"><h2 className="text-sm font-semibold">Release/artist/contact shared docs and assets</h2>
        {linkedTasks.length ? <div className="mt-2">
          <p className="text-xs text-muted-foreground">Tasks ({linkedTasks.length})</p>
          <ul className="mt-1 space-y-2 text-sm">{linkedTasks.map((task) => <li key={task.id}>{task.task_name}</li>)}</ul>
        </div> : <p className="mt-2 text-sm text-muted-foreground">No linked tasks</p>}
        {linkedDocuments.length ? <div className="mt-3"><p className="text-xs text-muted-foreground">Documents ({linkedDocuments.length})</p><ul className="mt-1 space-y-2 text-sm">{linkedDocuments.map((document) => <li key={document.id}>{document.name}</li>)}</ul></div> : <p className="mt-2 text-sm text-muted-foreground">No linked documents</p>}
        {linkedMediaAssets.length ? <div className="mt-3"><p className="text-xs text-muted-foreground">Media assets ({linkedMediaAssets.length})</p><ul className="mt-1 space-y-2 text-sm">{linkedMediaAssets.map((asset) => <li key={asset.id}>{asset.asset_name}</li>)}</ul></div> : <p className="mt-2 text-sm text-muted-foreground">No linked media assets</p>}
      </div>
    </section>}
    <EventFormDrawer open={editing} onOpenChange={setEditing} projects={projects} artists={artists} releases={releases} contacts={contacts} initialEvent={event} onCreated={(updated: ProjectEventRecord) => { setEvent((current: EventDetailRecord) => ({ ...current, ...updated })); setEditing(false); }} />
  </div>;
}

function Detail({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="flex gap-3 text-sm"><span className="mt-0.5 text-muted-foreground">{icon}</span><div><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1">{value}</p></div></div>; }

export default ProjectEventDetail;
