import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildEventPayload, EventFormDrawer, initialEventDraft, transitionEventDraft, validateEventDraft } from "./EventFormDrawer";
import { buildProjectPayload, initialProjectDraft, ProjectFormDialog, transitionProjectDraft } from "./ProjectFormDialog";
import ProjectWorkspace from "./ProjectWorkspace";
import { ProjectOverview } from "./ProjectOverview";
import ProjectsEventsWorkspace from "./ProjectsEventsWorkspace";
import { ProjectEventDetail, transitionEventProject, patchEventProject, buildEventProjectPatch } from "./ProjectEventDetail";

vi.mock("../ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("../ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  SheetFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe("Events workspace", () => {
  it("renders canonical workspace tabs and create actions", () => {
    const html = renderToStaticMarkup(
      <ProjectsEventsWorkspace projects={[]} events={[]} initialView="events" />,
    );

    expect(html).toContain("Events");
    expect(html).toContain('href="/events"');
    expect(html).toContain('href="/projects?view=projects"');
    expect(html).toContain("New project");
    expect(html).toContain("New event");
  });

  it("uses canonical project navigation for the projects route", () => {
    const html = renderToStaticMarkup(
      <ProjectsEventsWorkspace projects={[]} events={[]} initialView="projects" workspaceRoute="projects" />,
    );

    expect(html).toContain(">Projects</h1>");
    expect(html).toContain('href="/events?view=events"');
    expect(html).toContain('href="/projects"');
  });

  it("builds project payload for new budget-like projects", () => {
    const payload = buildProjectPayload({
      ...initialProjectDraft,
      name: "Autumn tour",
      projectType: "tour",
      status: "planning",
      startDate: "2026-09-01",
      location: "Europe",
      ownerContactId: "owner-1",
      currency: "EUR",
    });

    expect(payload).toMatchObject({
      name: "Autumn tour",
      project_type: "tour",
      status: "planning",
      start_date: "2026-09-01",
      location_name: "Europe",
      owner_contact_id: "owner-1",
      currency: "EUR",
    });
    expect(payload).not.toHaveProperty("track_count");
    expect(payload).not.toHaveProperty("singles_count");
  });

  it("builds event payload with nullable links and times", () => {
    const payload = buildEventPayload({
      title: "Vega",
      eventType: "concert",
      startDate: "2026-08-20",
      endDate: "2026-08-20",
      projectId: "",
      venueName: "Vega",
      city: "Copenhagen",
      notes: "Load-in at 15:00",
      isConfirmed: true,
      allDay: false,
      startTime: "20:00",
      endTime: "21:30",
      timezone: "Europe/Copenhagen",
      artistId: "artist-1",
      releaseId: "release-1",
      contactId: "contact-1",
      ownerContactId: "owner-1",
      status: "confirmed",
      address: "",
      region: "",
      countryCode: "",
    });

    expect(payload).toMatchObject({
      title: "Vega",
      event_type: "concert",
      project_id: null,
      artist_id: "artist-1",
      release_id: "release-1",
      contact_id: "contact-1",
      owner_contact_id: "owner-1",
      is_confirmed: true,
      venue_name: "Vega",
      city: "Copenhagen",
      notes: "Load-in at 15:00",
      all_day: false,
    });
  });
});

describe("Project workspace", () => {
  const project = {
    id: "project-1", name: "Fountain video", project_type: "tour", status: "active", currency: "EUR",
    events: [{ id: "event-a", title: "Vega", event_type: "concert", start_date: "2026-08-20" }],
    tasks: [{ id: "task-1", task_name: "Finalize master", status: "todo" }],
    people: [{ id: "person-1", name: "Malthe", kind: "contact" }],
    documents: [{ id: "document-1", name: "Press kit" }],
    mediaAssets: [{ id: "asset-1", asset_name: "Cover art" }],
    grantApplications: [{ id: "grant-1", grant_name: "Nordic Arts", status: "submitted", outcome: "pending", amount_requested: 5000, amount_awarded: 2500 }],
  };

  it("renders the project detail model including supported pickers and grant context", () => {
    const html = renderToStaticMarkup(
      <ProjectWorkspace
        workspace={project as any}
        initialTab="tasks"
        options={{
          artists: [{ id: "artist-1", name: "True Blue" }],
          releases: [{ id: "release-1", title: "Album One" }],
          campaigns: [{ id: "campaign-1", name: "Summer launch" }],
          contacts: [{ id: "contact-1", name: "A. Manager" }],
          projects: [{ id: "project-1", name: "Fountain video" }],
        }}
      />,
    );

    expect(html).toContain('href="/projects"');
    expect(html).toContain('aria-selected="true" href="/projects/project-1?tab=tasks"');
    expect(html).toContain("Supported pickers");
    expect(html).toContain("Artists (1)");
    expect(html).toContain("Grant context");
    expect(html).toContain("Nordic Arts");
    expect(html).toContain("€");
  });
});

describe("Project overview", () => {
  it("contains long unbroken project text without widening a narrow viewport", () => {
    const html = renderToStaticMarkup(
      <ProjectOverview
        project={{
          id: "project-overflow",
          name: "Mobile overflow regression",
          project_type: "production",
          description: "https://example.test/" + "a".repeat(800),
          location_name: "L".repeat(400),
        }}
      />,
    );

    expect(html).toContain('class="min-w-0 border border-border bg-card p-5"');
    expect(html).toContain('class="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground"');
    expect(html).toContain('class="min-w-0 break-words mt-1"');
  });
});

describe("Event detail", () => {
  const event = {
    id: "event-1", title: "Vega", event_type: "concert", status: "confirmed",
    start_date: "2026-08-20", venue_name: "Vega", city: "Copenhagen", project_id: "project-1",
    artist_id: "artist-1", release_id: "release-1", contact_id: "contact-1",
    owner_name: "A. Owner", artist_name: "Artist X", release_title: "Album One", contact_name: "Contact Y",
  } as const;

  it("keeps nullable links visible until a project is selected", () => {
    const html = renderToStaticMarkup(
      <ProjectEventDetail
        event={event as any}
        projects={[{ id: "project-1", name: "Autumn tour", project_type: "tour" }] as any}
        project_context={{
          id: "project-1", name: "Autumn tour", events: [
            { id: "event-1", title: "Vega", event_type: "concert", start_date: "2026-08-20" },
          ] as any,
          tasks: [{ id: "task-1", task_name: "Pitch", status: "todo" }, { id: "task-2", task_name: "Coordinate", status: "todo" }] as any,
          documents: [{ id: "document-1", name: "Fact sheet" }] as any,
          mediaAssets: [{ id: "asset-1", asset_name: "Poster" }] as any,
          shared_campaigns: [{ id: "campaign-1", campaign_name: "Summer push", status: "active", campaign_type: "social", linked_artist_id: "artist-1", linked_release_id: "release-1", artist_name: "Artist X", release_title: "Album One" }],
        }}
      />,
    );

    expect(html).toContain("Autumn tour");
    expect(html).toContain("Artist");
    expect(html).toContain("Artist X");
    expect(html).toContain("Contact");
    expect(html).toContain("Release");
    expect(html).toContain("Album One");
    expect(html).toContain("Project and seam context");
    expect(html).toContain("No other linked events");
    expect(html).toContain("Campaign seam links");
    expect(html).toContain("Summer push");
    expect(html).toContain("Documents (1)");
    expect(html).toContain("Media assets (1)");
    expect(html).toContain("Tasks (2)");
    expect(html).toContain("Fact sheet");
    expect(html).toContain("Poster");
    expect(html).toContain("Pitch");
  });

  it("preserves project tasks while adding release/artist/contact seam records", () => {
    const html = renderToStaticMarkup(
      <ProjectEventDetail
        event={event as any}
        projects={[]}
        project_context={{
          id: "project-1",
          name: "Autumn tour",
          events: [{ id: "event-1", title: "Vega", event_type: "concert", start_date: "2026-08-20" }],
          tasks: [
            { id: "task-1", task_name: "Project task", status: "todo", linked_release_id: null, linked_artist_id: null, linked_contact_id: null, linked_campaign_id: null },
            { id: "task-2", task_name: "Seam task", status: "todo", linked_release_id: null, linked_artist_id: "artist-1", linked_contact_id: null, linked_campaign_id: null },
          ] as any,
          documents: [{ id: "document-1", name: "Fact sheet" }],
          mediaAssets: [{ id: "asset-1", asset_name: "Poster" }],
          shared_campaigns: [{ id: "campaign-1", campaign_name: "Summer push", status: "active", campaign_type: "social", linked_artist_id: "artist-1", linked_release_id: "release-1", artist_name: "Artist X", release_title: "Album One" }],
        }}
      />,
    );

    expect(html).toContain("Documents (1)");
    expect(html).toContain("Fact sheet");
    expect(html).toContain("Media assets (1)");
    expect(html).toContain("Poster");
    expect(html).toContain("Tasks (2)");
    expect(html).toContain("Project task");
    expect(html).toContain("Seam task");
  });

  it("shows project-only records and seam records for the same project-backed event", () => {
    const html = renderToStaticMarkup(
      <ProjectEventDetail
        event={event as any}
        projects={[{ id: "project-1", name: "Autumn tour", project_type: "tour" }] as any}
        project_context={{
          id: "project-1",
          name: "Autumn tour",
          events: [
            { id: "event-1", title: "Vega", event_type: "concert", start_date: "2026-08-20" },
            { id: "event-2", title: "Afterparty", event_type: "other", start_date: "2026-08-21" },
          ],
          tasks: [
            { id: "task-project", task_name: "Project task", status: "todo" },
            { id: "task-seam", task_name: "Seam task", linked_release_id: "release-1", linked_artist_id: null, linked_contact_id: null, linked_campaign_id: null },
          ] as any,
          documents: [
            { id: "doc-1", name: "Project fact sheet" },
            { id: "doc-seam", name: "Seam press kit" },
          ],
          mediaAssets: [
            { id: "asset-1", asset_name: "Poster" },
          ],
          shared_campaigns: [{ id: "campaign-1", campaign_name: "Summer push", status: "active", campaign_type: "social", linked_artist_id: "artist-1", linked_release_id: "release-1", artist_name: "Artist X", release_title: "Album One" }],
        }}
      />,
    );

    expect(html).toContain("Project and seam context");
    expect(html).toContain("2 task(s)");
    expect(html).toContain("2 linked event(s)");
    expect(html).toContain("2 document(s)");
    expect(html).toContain("1 media asset(s)");
    expect(html).toContain("Project task");
    expect(html).toContain("Seam task");
    expect(html).toContain("Project fact sheet");
    expect(html).toContain("Seam press kit");
    expect(html).toContain("Campaign seam links");
    expect(html).toContain("Summer push");
    expect(html).toContain("Afterparty");
  });

  it("patches project links through the stable event endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, id: "event-1" }), { status: 200 }));
    const eventPayload = transitionEventProject(event, "project-1");

    expect(buildEventProjectPatch("project-1")).toEqual({ project_id: "project-1" });
    expect(eventPayload).toMatchObject({ id: "event-1", project_id: "project-1" });
    await patchEventProject("event-1", "project-1", fetcher);

    expect(fetcher).toHaveBeenCalledWith("/api/events/event-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: "project-1" }),
    });
  });
});

describe("event creation workflow helpers", () => {
  it("validates required fields and preserves project clears", () => {
    const seeded = {
      ...initialEventDraft,
      title: "Vega",
      projectId: "project-1",
      startDate: "2026-08-20",
      startTime: "20:00",
    };

    const cleared = transitionEventDraft(seeded, { projectId: "", allDay: true });
    expect(validateEventDraft(cleared)).toBeNull();
    expect(cleared).toMatchObject({ projectId: "", allDay: true, startTime: "20:00" });
  });

  it("rehydrates edit-mode times as local clock time", () => {
    const event = {
      id: "event-1",
      title: "Vega",
      event_type: "concert",
      start_date: "2026-07-27",
      all_day: false,
      timezone: "Europe/Copenhagen",
      starts_at: "2026-07-27T18:00:00.000Z",
      ends_at: "2026-07-27T20:00:00.000Z",
      artist_id: "",
      release_id: "",
      contact_id: "",
      owner_contact_id: "",
      status: "planned",
      notes: "",
    } as any;
    const html = renderToStaticMarkup(
      <EventFormDrawer
        open
        onOpenChange={() => undefined}
        projects={[]}
        artists={[]}
        releases={[]}
        contacts={[]}
        initialEvent={event}
        onCreated={() => undefined}
      />,
    );

    expect(html).toContain('value="20:00"');
    expect(html).toContain('value="22:00"');
  });
});

// Keep React components mounted to ensure create/edit surfaces remain server-renderable in this flow.
describe("form surfaces", () => {
  it("renders event dialog with required controls", () => {
    const html = renderToStaticMarkup(
      <EventFormDrawer
        open
        onOpenChange={() => undefined}
        projects={[]}
        artists={[{ id: "artist-1", name: "True Blue" }]}
        releases={[{ id: "release-1", title: "Fountain" }]}
        contacts={[{ id: "contact-1", name: "Malthe" }]}
        onCreated={() => undefined}
      />,
    );

    expect(html).toContain("All day");
    expect(html).toContain("Start time");
    expect(html).toContain("Timezone");
    expect(html).toContain("Contact");
    expect(html).toContain("Owner");
    expect(html).toContain("Venue");
  });

  it("renders project dialog in canonical wording", () => {
    const html = renderToStaticMarkup(
      <ProjectFormDialog
        open
        onOpenChange={() => undefined}
        onCreated={() => undefined}
        artists={[{ id: "artist-1", name: "True Blue" }]}
        releases={[{ id: "release-1", title: "Fountain" }]}
        contacts={[{ id: "owner-1", name: "Malthe" }]}
      />,
    );

    expect(html).toContain("New project");
    expect(html).toContain("Project type");
    expect(html).toContain("Tracks");
  });

  it("switches project draft types while keeping release-linked values", () => {
    const release = { ...initialProjectDraft, name: "Album", releaseId: "release-1", trackCount: "12", singlesCount: "3", projectType: "release" as const };
    const switched = transitionProjectDraft(release, { projectType: "tour" });
    const restored = transitionProjectDraft(switched, { projectType: "release" });

    expect(switched).toMatchObject({ releaseId: "release-1", trackCount: "12", singlesCount: "3" });
    expect(restored).toMatchObject({ releaseId: "release-1", trackCount: "12", singlesCount: "3" });
  });
});
