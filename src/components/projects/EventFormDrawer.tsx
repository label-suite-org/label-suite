import { useState, type SubmitEvent } from "react";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "../ui/sheet";
import { eventTypeLabels } from "../../lib/projects-events-core";
import type { ProjectEventRecord, ProjectRecord } from "./ProjectsEventsWorkspace";
import type { ReleaseOption, SelectOption } from "./ProjectFormDialog";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export type EventDraft = {
  title: string; eventType: string; status: string; startDate: string; endDate: string;
  allDay: boolean; startTime: string; endTime: string; timezone: string;
  projectId: string; artistId: string; releaseId: string; contactId: string; ownerContactId: string;
  venueName: string; address: string; city: string; region: string; countryCode: string;
  notes: string; isConfirmed: boolean;
};

export const initialEventDraft: EventDraft = {
  title: "", eventType: "concert", status: "planned", startDate: "", endDate: "",
  allDay: true, startTime: "", endTime: "", timezone: "Europe/Copenhagen",
  projectId: "", artistId: "", releaseId: "", contactId: "", ownerContactId: "",
  venueName: "", address: "", city: "", region: "", countryCode: "", notes: "", isConfirmed: false,
};

export function transitionEventDraft(draft: EventDraft, patch: Partial<EventDraft>): EventDraft {
  return { ...draft, ...patch };
}

export function validateEventDraft(draft: EventDraft) {
  if (!draft.title.trim()) return "Title is required.";
  if (!draft.startDate) return "Start date is required.";
  if (!draft.allDay && !draft.startTime) return "Start time is required when all day is off.";
  return null;
}


function localTimeWithOffset(date: string, time: string, timezone: string) {
  if (!date || !time) return null;
  try {
    const offsetName = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      timeZoneName: "longOffset",
    }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const offset = offsetName === "GMT" ? "+00:00" : offsetName.replace("GMT", "");
    return `${date}T${time}:00${offset}`;
  } catch {
    return `${date}T${time}:00Z`;
  }
}

function localClockTime(value: string | Date | null | undefined, timezone: string | null) {
  if (!value) return "";
  try {
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone || "UTC",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).format(when);
  } catch {
    return "";
  }
}

export function buildEventPayload(draft: Partial<EventDraft> & Pick<EventDraft, "title" | "eventType" | "startDate">) {
  const allDay = draft.allDay ?? true;
  const endDate = draft.endDate || draft.startDate;
  return {
    title: draft.title.trim(),
    event_type: draft.eventType,
    status: draft.status || "planned",
    start_date: draft.startDate,
    end_date: draft.endDate || null,
    starts_at: allDay ? null : localTimeWithOffset(draft.startDate, draft.startTime || "", draft.timezone || "UTC"),
    ends_at: allDay ? null : localTimeWithOffset(endDate, draft.endTime || "", draft.timezone || "UTC"),
    all_day: allDay,
    timezone: draft.timezone?.trim() || null,
    project_id: draft.projectId || null,
    artist_id: draft.artistId || null,
    release_id: draft.releaseId || null,
    contact_id: draft.contactId || null,
    owner_contact_id: draft.ownerContactId || null,
    venue_name: draft.venueName?.trim() || null,
    address: draft.address?.trim() || null,
    city: draft.city?.trim() || null,
    region: draft.region?.trim() || null,
    country_code: draft.countryCode?.trim() || null,
    notes: draft.notes?.trim() || null,
    is_confirmed: Boolean(draft.isConfirmed),
  };
}

function draftFromEvent(event: ProjectEventRecord | undefined): EventDraft {
  if (!event) return initialEventDraft;
  const startsAt = typeof event.starts_at === "string" || event.starts_at instanceof Date ? event.starts_at : null;
  const endsAt = typeof event.ends_at === "string" || event.ends_at instanceof Date ? event.ends_at : null;
  return {
    ...initialEventDraft,
    title: event.title,
    eventType: event.event_type,
    status: String(event.status || "planned"),
    startDate: event.start_date,
    endDate: String(event.end_date || ""),
    allDay: event.all_day !== false,
    startTime: localClockTime(startsAt, String(event.timezone || "Europe/Copenhagen")),
    endTime: localClockTime(endsAt, String(event.timezone || "Europe/Copenhagen")),
    timezone: String(event.timezone || "Europe/Copenhagen"),
    projectId: String(event.project_id || ""), artistId: String(event.artist_id || ""), releaseId: String(event.release_id || ""),
    contactId: String(event.contact_id || ""), ownerContactId: String(event.owner_contact_id || ""),
    venueName: String(event.venue_name || ""), address: String(event.address || ""), city: String(event.city || ""),
    region: String(event.region || ""), countryCode: String(event.country_code || ""), notes: String(event.notes || ""),
    isConfirmed: Boolean(event.is_confirmed),
  };
}

const fieldClass = "mt-1 h-10 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-muted";
const textAreaClass = "mt-1 w-full border border-border bg-background px-3 py-2 text-sm outline-none";

export function EventFormDrawer({ open, onOpenChange, projects, artists = [], releases = [], contacts = [], onCreated, onPartialCreated, initialEvent }: {
  open: boolean; onOpenChange: (open: boolean) => void; projects: ProjectRecord[];
  artists?: SelectOption[]; releases?: ReleaseOption[]; contacts?: SelectOption[];
  onCreated: (event: ProjectEventRecord) => void;
  onPartialCreated?: (event: ProjectEventRecord) => void;
  initialEvent?: ProjectEventRecord;
}) {
  const [draft, setDraft] = useState(() => draftFromEvent(initialEvent));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<EventDraft>) => setDraft((current) => transitionEventDraft(current, patch));

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationError = validateEventDraft(draft);
    if (validationError) { setError(validationError); return; }
    setSubmitting(true); setError(null);
    const payload = buildEventPayload(draft);
    try {
      const response = await fetch(initialEvent ? `/api/events/${encodeURIComponent(initialEvent.id)}` : "/api/events", { method: initialEvent ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to create event");
      const createdEvent = { ...initialEvent, id: result.id, ...payload } as ProjectEventRecord;
      if (!initialEvent && onPartialCreated) onPartialCreated(createdEvent);
      onCreated(createdEvent);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create event");
    } finally { setSubmitting(false); }
  }

  const linkedSelect = (label: string, key: "artistId" | "contactId" | "ownerContactId", options: SelectOption[]) => (
    <label className="text-sm font-medium">{label}<NativeSelect value={draft[key]} onChange={(e) => update({ [key]: e.target.value })} className={fieldClass}><option value="">No {label.toLowerCase()}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</NativeSelect></label>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl">
        <SheetHeader><SheetTitle>{initialEvent ? "Edit event" : "New event"}</SheetTitle><SheetDescription>{initialEvent ? "Update the event without changing its project unless you choose to." : "Add a dated event to a project or keep it standalone."}</SheetDescription></SheetHeader>
        <form id="event-form" onSubmit={submit} className="grid flex-1 gap-4 overflow-y-auto px-4 pb-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm font-medium">Title<Input required autoFocus value={draft.title} onChange={(e) => update({ title: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">Event type<NativeSelect value={draft.eventType} onChange={(e) => update({ eventType: e.target.value })} className={fieldClass}>{Object.entries(eventTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
          <label className="text-sm font-medium">Status<NativeSelect value={draft.status} onChange={(e) => update({ status: e.target.value })} className={fieldClass}><option value="planned">Planned</option><option value="tentative">Tentative</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></NativeSelect></label>
          <label className="text-sm font-medium">Start date<Input required type="date" value={draft.startDate} onChange={(e) => update({ startDate: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">End date<Input type="date" value={draft.endDate} onChange={(e) => update({ endDate: e.target.value })} className={fieldClass} /></label>
          <label className="sm:col-span-2 flex min-h-11 items-center gap-2 text-sm font-medium"><Input type="checkbox" checked={draft.allDay} onChange={(e) => update({ allDay: e.target.checked })} />All day</label>
          <label className="text-sm font-medium">Start time<Input type="time" disabled={draft.allDay} value={draft.startTime} onChange={(e) => update({ startTime: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">End time<Input type="time" disabled={draft.allDay} value={draft.endTime} onChange={(e) => update({ endTime: e.target.value })} className={fieldClass} /></label>
          <label className="sm:col-span-2 text-sm font-medium">Timezone<Input value={draft.timezone} onChange={(e) => update({ timezone: e.target.value })} placeholder="Europe/Copenhagen" className={fieldClass} /></label>
          <label className="sm:col-span-2 text-sm font-medium">Project<NativeSelect value={draft.projectId} onChange={(e) => update({ projectId: e.target.value })} className={fieldClass}><option value="">No project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</NativeSelect></label>
          {linkedSelect("Artist", "artistId", artists)}
          <label className="text-sm font-medium">Release<NativeSelect value={draft.releaseId} onChange={(e) => update({ releaseId: e.target.value })} className={fieldClass}><option value="">No release</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</NativeSelect></label>
          {linkedSelect("Contact", "contactId", contacts)}
          {linkedSelect("Owner", "ownerContactId", contacts)}
          <label className="text-sm font-medium">Venue<Input value={draft.venueName} onChange={(e) => update({ venueName: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">City<Input value={draft.city} onChange={(e) => update({ city: e.target.value })} className={fieldClass} /></label>
          <label className="sm:col-span-2 text-sm font-medium">Address<Input value={draft.address} onChange={(e) => update({ address: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">Region<Input value={draft.region} onChange={(e) => update({ region: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">Country code<Input value={draft.countryCode} onChange={(e) => update({ countryCode: e.target.value.toUpperCase() })} maxLength={2} className={fieldClass} /></label>
          <label className="sm:col-span-2 text-sm font-medium">Notes<Textarea value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={4} className={textAreaClass} /></label>
          <label className="sm:col-span-2 flex min-h-11 items-center gap-2 text-sm font-medium"><Input type="checkbox" checked={draft.isConfirmed} onChange={(e) => update({ isConfirmed: e.target.checked })} />Confirmed</label>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-red-600">{error}</p>}
        </form>
        <SheetFooter className="border-t border-border sm:flex-row sm:justify-end"><Button type="button" onClick={() => onOpenChange(false)} className="h-10 border border-border px-4 text-sm font-medium">Cancel</Button><Button form="event-form" disabled={submitting} className="h-10 bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{submitting ? (initialEvent ? "Saving…" : "Creating…") : initialEvent ? "Save event" : "Create event"}</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
