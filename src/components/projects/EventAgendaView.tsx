import { useMemo, useState } from "react";
import { Bed, BusFront, CalendarClock, CalendarDays, CircleCheck, CircleDashed, CircleX, Clapperboard, Filter, MapPin, MicVocal, Plane, UsersRound, type LucideIcon } from "lucide-react";
import { eventTypeLabels } from "../../lib/projects-events-core";
import type { ProjectEventRecord, ProjectRecord } from "./ProjectsEventsWorkspace";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
function formatDay(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" })
    .format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

const eventIcons: Record<string, LucideIcon> = {
  concert: MicVocal, travel_day: BusFront, off_day: Bed, rehearsal: UsersRound,
  shoot: Clapperboard, production_day: Clapperboard, deadline: CalendarClock,
  premiere: Plane, meeting: UsersRound, other: CalendarDays,
};

function statusIcon(status?: string | null) {
  if (status === "confirmed" || status === "completed") return CircleCheck;
  if (status === "cancelled") return CircleX;
  return CircleDashed;
}

export function EventAgendaView({ events, projects }: { events: ProjectEventRecord[]; projects: ProjectRecord[] }) {
  const [fromDate, setFromDate] = useState("");
  const [eventType, setEventType] = useState("all");
  const [projectId, setProjectId] = useState("all");
  const [artistId, setArtistId] = useState("all");
  const [status, setStatus] = useState("all");
  const [ownerId, setOwnerId] = useState("all");
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const options = useMemo(() => ({
    artists: [...new Map(events.filter((event) => event.artist_id && event.artist_name).map((event) => [event.artist_id!, event.artist_name!])).entries()],
    owners: [...new Map(events.filter((event) => event.owner_contact_id && event.owner_name).map((event) => [event.owner_contact_id!, event.owner_name!])).entries()],
    statuses: [...new Set(events.map((event) => event.status).filter((value): value is string => typeof value === "string"))],
  }), [events]);
  const visible = events.filter((event) =>
    (!fromDate || event.start_date >= fromDate)
    && (eventType === "all" || event.event_type === eventType)
    && (projectId === "all" || (projectId === "standalone" ? !event.project_id : event.project_id === projectId))
    && (artistId === "all" || event.artist_id === artistId)
    && (status === "all" || event.status === status)
    && (ownerId === "all" || event.owner_contact_id === ownerId));

  if (!events.length) {
    return (
      <div className="border border-dashed border-border px-5 py-16 text-center">
        <CalendarDays className="mx-auto size-6 text-muted-foreground" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium">No events scheduled</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Add concerts, travel days, off days, shoots, deadlines, and meetings to build the agenda.
        </p>
      </div>
    );
  }

  const groups = visible.reduce<Record<string, ProjectEventRecord[]>>((result, event) => {
    (result[event.start_date] ??= []).push(event);
    return result;
  }, {});

  return (
    <section aria-label="Event agenda" className="space-y-4">
      <div className="grid gap-2 border-y border-border py-3 sm:grid-cols-2 xl:grid-cols-6">
        <label className="text-xs font-medium text-muted-foreground"><span className="flex items-center gap-1"><Filter className="size-3.5" />From date</span><Input aria-label="Filter events from date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground" /></label>
        <label className="text-xs font-medium text-muted-foreground">Type<NativeSelect aria-label="Filter events by type" value={eventType} onChange={(event) => setEventType(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground"><option value="all">All types</option>{Object.entries(eventTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
        <label className="text-xs font-medium text-muted-foreground">Project<NativeSelect aria-label="Filter events by project" value={projectId} onChange={(event) => setProjectId(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground"><option value="all">All projects</option><option value="standalone">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect></label>
        <label className="text-xs font-medium text-muted-foreground">Artist<NativeSelect aria-label="Filter events by artist" value={artistId} onChange={(event) => setArtistId(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground"><option value="all">All artists</option>{options.artists.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</NativeSelect></label>
        <label className="text-xs font-medium text-muted-foreground">Status<NativeSelect aria-label="Filter events by status" value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground"><option value="all">All statuses</option>{options.statuses.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</NativeSelect></label>
        <label className="text-xs font-medium text-muted-foreground">Owner<NativeSelect aria-label="Filter events by owner" value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="mt-1 h-10 w-full border border-border bg-background px-2 text-sm text-foreground"><option value="all">All owners</option>{options.owners.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</NativeSelect></label>
      </div>
      {visible.length ? <div className="border-y border-border">
      {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayEvents]) => (
        <div key={date} className="grid border-b border-border last:border-b-0 md:grid-cols-[180px_1fr]">
          <div className="border-b border-border bg-muted/25 px-4 py-4 md:border-b-0 md:border-r">
            <p className="text-sm font-semibold">{formatDay(date)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{dayEvents.length} event{dayEvents.length === 1 ? "" : "s"}</p>
          </div>
          <div className="divide-y divide-border">
            {dayEvents.map((event) => {
              const label = event.event_type in eventTypeLabels
                ? eventTypeLabels[event.event_type as keyof typeof eventTypeLabels]
                : "Event";
              const location = [event.venue_name, event.city].filter(Boolean).join(" · ");
              const TypeIcon = eventIcons[event.event_type] ?? CalendarDays;
              const StatusIcon = statusIcon(event.status);
              return (
                <a key={event.id} href={`/events/${event.id}`} className="grid gap-3 px-4 py-4 text-foreground no-underline transition hover:bg-muted/25 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-center">
                  <div>
                    <span className="inline-flex items-center gap-1 border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium"><TypeIcon className="size-3.5" aria-hidden="true" />{label}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{event.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{event.project_id ? projectNames.get(event.project_id) || "Linked project" : "No project"}{event.artist_name ? ` · ${event.artist_name}` : ""}{event.owner_name ? ` · Owner: ${event.owner_name}` : ""}</p>
                  </div>
                  <div className="text-xs text-muted-foreground sm:text-right">
                    {location && <p className="flex items-center gap-1 sm:justify-end"><MapPin className="size-3.5" />{location}</p>}
                    <p className="mt-1 inline-flex items-center gap-1 capitalize"><StatusIcon className="size-3.5" aria-hidden="true" />{(event.status || "planned").replaceAll("_", " ")}</p>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      ))}
      </div> : <div className="border border-dashed border-border px-5 py-12 text-center text-sm text-muted-foreground">No events match these filters.</div>}
    </section>
  );
}
