"use client";

import { TaskPlanningFields, cleanLabels, emptyPlanningOptions, type TaskPlanningOptions } from "./TaskPlanningFields";
import { useId, useState, type SubmitEvent } from "react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export interface OpsTask {
  id?: string;
  assignee_ids?: string[];
  labels?: string[];
  dependency_ids?: string[];
  today?: string;
  release_offset_days?: number | null;
  task_name?: string;
  status?: string;
  priority?: string;
  owner?: string | null;
  due_date?: string | null;
  linked_artist_id?: string | null;
  linked_release_id?: string | null;
  linked_campaign_id?: string | null;
  linked_contact_id?: string | null;
  owner_contact_id?: string | null;
  project_id?: string | null;
  event_id?: string | null;
  notes?: string | null;
  next_action?: string | null;
}

export function OpsTaskForm({
  initial,
  artists,
  releases,
  campaigns,
  contacts,
  projects,
  events,
  planningOptions = emptyPlanningOptions,
  onClose,
}: {
  initial?: OpsTask | null;
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  campaigns: Array<{ id: string; name: string }>;
  contacts: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  events: Array<{ id: string; title: string; start_date?: string | null }>;
  planningOptions?: TaskPlanningOptions;
  onClose: () => void;
}) {
  const [planning, setPlanning] = useState({ assignee_ids: initial?.assignee_ids ?? [], labels: initial?.labels ?? [], dependency_ids: initial?.dependency_ids ?? [] });
  const formId = useId();
  const isEdit = !!initial;
  const [taskName, setTaskName] = useState(initial?.task_name || "");
  const [status, setStatus] = useState(initial?.status || "todo");
  const [priority, setPriority] = useState(initial?.priority || "P2");
  const [owner, setOwner] = useState(initial?.owner || "");
  const [dueDate, setDueDate] = useState(initial?.due_date || "");
  const [artistId, setArtistId] = useState(initial?.linked_artist_id || "");
  const [releaseId, setReleaseId] = useState(initial?.linked_release_id || "");
  const [campaignId, setCampaignId] = useState(initial?.linked_campaign_id || "");
  const [contactId, setContactId] = useState(initial?.linked_contact_id || "");
  const [ownerContactId, setOwnerContactId] = useState(initial?.owner_contact_id || "");
  const [projectId, setProjectId] = useState(initial?.project_id || "");
  const [eventId, setEventId] = useState(initial?.event_id || "");
  const [notes, setNotes] = useState(initial?.notes || "");
  const [nextAction, setNextAction] = useState(initial?.next_action || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        ...planning,
        labels: cleanLabels(planning.labels),
        task_name: taskName,
        status,
        priority,
        owner: owner || null,
        due_date: dueDate || null,
        linked_artist_id: artistId || null,
        linked_release_id: releaseId || null,
        linked_campaign_id: campaignId || null,
        linked_contact_id: contactId || null,
        owner_contact_id: ownerContactId || null,
        project_id: projectId || null,
        event_id: eventId || null,
        notes: notes || null,
        next_action: nextAction || null,
      };
      const res = await fetch("/api/ops-tasks", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...payload, id: initial!.id } : payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} task`);
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <TaskPlanningFields value={planning} onChange={setPlanning} options={planningOptions} taskId={initial?.id} />
      <div>
        <label htmlFor={`${formId}-task-name`} className="block text-sm font-medium text-foreground mb-1">Task Name *</label>
        <Input
          id={`${formId}-task-name`}
          value={taskName}
          onChange={(e) => setTaskName(e.target.value)}
          required
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-status`} className="block text-sm font-medium text-foreground mb-1">Status</label>
          <NativeSelect id={`${formId}-status`} value={status} onChange={(e) => setStatus(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-priority`} className="block text-sm font-medium text-foreground mb-1">Priority</label>
          <NativeSelect id={`${formId}-priority`} value={priority} onChange={(e) => setPriority(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="P0">P0 — Critical</option>
            <option value="P1">P1 — High</option>
            <option value="P2">P2 — Normal</option>
            <option value="P3">P3 — Low</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-owner-contact`} className="block text-sm font-medium text-foreground mb-1">Owner Contact</label>
          <NativeSelect id={`${formId}-owner-contact`} value={ownerContactId} onChange={(e) => setOwnerContactId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-due-date`} className="block text-sm font-medium text-foreground mb-1">Due Date</label>
          <Input id={`${formId}-due-date`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" />
        </div>
      </div>
      {initial?.release_offset_days != null && <p className="text-xs text-muted-foreground">This task has a relative release deadline. Changing its due date here makes it a fixed deadline. Manage relative timing in the release schedule.</p>}
      <div>
        <label htmlFor={`${formId}-owner-label`} className="block text-sm font-medium text-foreground mb-1">Owner Label</label>
        <Input id={`${formId}-owner-label`} value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Legacy/free-text owner when no contact is selected"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-linked-artist`} className="block text-sm font-medium text-foreground mb-1">Linked Artist</label>
          <NativeSelect id={`${formId}-linked-artist`} value={artistId} onChange={(e) => setArtistId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-linked-release`} className="block text-sm font-medium text-foreground mb-1">Linked Release</label>
          <NativeSelect id={`${formId}-linked-release`} value={releaseId} onChange={(e) => setReleaseId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {releases.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-linked-campaign`} className="block text-sm font-medium text-foreground mb-1">Linked Campaign</label>
          <NativeSelect id={`${formId}-linked-campaign`} value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-linked-contact`} className="block text-sm font-medium text-foreground mb-1">Linked Contact</label>
          <NativeSelect id={`${formId}-linked-contact`} value={contactId} onChange={(e) => setContactId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-budget-project`} className="block text-sm font-medium text-foreground mb-1">Budget Project</label>
          <NativeSelect id={`${formId}-budget-project`} value={projectId} onChange={(e) => setProjectId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </NativeSelect>
        </div>
        <div>
          <label htmlFor={`${formId}-event`} className="block text-sm font-medium text-foreground mb-1">Event</label>
          <NativeSelect id={`${formId}-event`} value={eventId} onChange={(e) => setEventId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background">
            <option value="">— None —</option>
            {events.map((event) => <option key={event.id} value={event.id}>{event.start_date ? `${event.title} (${event.start_date})` : event.title}</option>)}
          </NativeSelect>
        </div>
      </div>
      <div>
        <label htmlFor={`${formId}-next-action`} className="block text-sm font-medium text-foreground mb-1">Next Action</label>
        <Input id={`${formId}-next-action`} value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="What's the immediate next step?"
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" />
      </div>
      <div>
        <label htmlFor={`${formId}-notes`} className="block text-sm font-medium text-foreground mb-1">Notes</label>
        <Textarea id={`${formId}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
        <Button type="submit" disabled={loading}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 disabled:opacity-50">
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Task"}
        </Button>
      </div>
    </form>
  );
}
