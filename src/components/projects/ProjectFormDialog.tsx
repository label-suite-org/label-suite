import { useState, type SubmitEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { projectTypeLabels } from "../../lib/projects-events-core";
import type { ProjectRecord } from "./ProjectsEventsWorkspace";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export type SelectOption = { id: string; name: string };
export type ReleaseOption = { id: string; title: string };

export type ProjectDraft = {
  name: string;
  projectType: keyof typeof projectTypeLabels;
  status: string;
  artistId: string;
  releaseId: string;
  ownerContactId: string;
  currency: string;
  startDate: string;
  endDate: string;
  location: string;
  description: string;
  trackCount: string;
  singlesCount: string;
};

export const initialProjectDraft: ProjectDraft = {
  name: "", projectType: "release", status: "planning", artistId: "", releaseId: "",
  ownerContactId: "", currency: "USD", startDate: "", endDate: "", location: "",
  description: "", trackCount: "", singlesCount: "",
};

export function transitionProjectDraft(draft: ProjectDraft, patch: Partial<ProjectDraft>): ProjectDraft {
  return { ...draft, ...patch };
}

export function buildProjectPayload(draft: ProjectDraft) {
  return {
    name: draft.name.trim(),
    project_type: draft.projectType,
    status: draft.status,
    artist_id: draft.artistId || null,
    owner_contact_id: draft.ownerContactId || null,
    currency: draft.currency,
    start_date: draft.startDate || null,
    end_date: draft.endDate || null,
    location_name: draft.location.trim() || null,
    description: draft.description.trim() || null,
    ...(draft.projectType === "release" ? {
      release_id: draft.releaseId || null,
      track_count: draft.trackCount === "" ? null : Number(draft.trackCount),
      singles_count: draft.singlesCount === "" ? null : Number(draft.singlesCount),
    } : {}),
  };
}

const fieldClass = "mt-1 h-10 w-full border border-border bg-background px-3 text-sm outline-none focus:border-foreground/40 focus:ring-2 focus:ring-muted";

export function ProjectFormDialog({ open, onOpenChange, onCreated, artists = [], releases = [], contacts = [] }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectRecord) => void;
  artists?: SelectOption[];
  releases?: ReleaseOption[];
  contacts?: SelectOption[];
}) {
  const [draft, setDraft] = useState(initialProjectDraft);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<ProjectDraft>) => setDraft((current) => transitionProjectDraft(current, patch));

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload = buildProjectPayload(draft);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Failed to create project");
      onCreated({ id: result.id, ...payload });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create project");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>New project</DialogTitle><DialogDescription>Create a release, tour, production, or one-off project.</DialogDescription></DialogHeader>
        <form id="project-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2 text-sm font-medium">Name<Input required autoFocus value={draft.name} onChange={(e) => update({ name: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">Project type<NativeSelect value={draft.projectType} onChange={(e) => update({ projectType: e.target.value as ProjectDraft["projectType"] })} className={fieldClass}>{Object.entries(projectTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></label>
          <label className="text-sm font-medium">Status<NativeSelect value={draft.status} onChange={(e) => update({ status: e.target.value })} className={fieldClass}><option value="planning">Planning</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="complete">Complete</option></NativeSelect></label>
          <label className="text-sm font-medium">Artist<NativeSelect value={draft.artistId} onChange={(e) => update({ artistId: e.target.value })} className={fieldClass}><option value="">No artist</option>{artists.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</NativeSelect></label>
          {draft.projectType === "release" && <label className="text-sm font-medium">Release<NativeSelect value={draft.releaseId} onChange={(e) => update({ releaseId: e.target.value })} className={fieldClass}><option value="">No release</option>{releases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}</NativeSelect></label>}
          <label className="text-sm font-medium">Owner<NativeSelect value={draft.ownerContactId} onChange={(e) => update({ ownerContactId: e.target.value })} className={fieldClass}><option value="">No owner</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</NativeSelect></label>
          <label className="text-sm font-medium">Currency<NativeSelect value={draft.currency} onChange={(e) => update({ currency: e.target.value })} className={fieldClass}>{["USD", "DKK", "EUR", "GBP", "SEK", "NOK"].map((currency) => <option key={currency}>{currency}</option>)}</NativeSelect></label>
          <label className="text-sm font-medium">Start date<Input type="date" value={draft.startDate} onChange={(e) => update({ startDate: e.target.value })} className={fieldClass} /></label>
          <label className="text-sm font-medium">End date<Input type="date" value={draft.endDate} onChange={(e) => update({ endDate: e.target.value })} className={fieldClass} /></label>
          <label className="sm:col-span-2 text-sm font-medium">Location<Input value={draft.location} onChange={(e) => update({ location: e.target.value })} className={fieldClass} /></label>
          {draft.projectType === "release" && <><label className="text-sm font-medium">Tracks<Input type="number" min="0" value={draft.trackCount} onChange={(e) => update({ trackCount: e.target.value })} className={fieldClass} /></label><label className="text-sm font-medium">Singles<Input type="number" min="0" value={draft.singlesCount} onChange={(e) => update({ singlesCount: e.target.value })} className={fieldClass} /></label></>}
          <label className="sm:col-span-2 text-sm font-medium">Summary<Textarea value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={3} className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm outline-none" /></label>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-red-600">{error}</p>}
        </form>
        <DialogFooter><Button type="button" onClick={() => onOpenChange(false)} className="h-10 border border-border px-4 text-sm font-medium">Cancel</Button><Button form="project-form" disabled={submitting} className="h-10 bg-foreground px-4 text-sm font-medium text-background disabled:opacity-50">{submitting ? "Creating…" : "Create project"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
