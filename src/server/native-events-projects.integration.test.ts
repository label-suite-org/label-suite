import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.NATIVE_EVENTS_PROJECTS_INTEGRATION === "1";
const suffix = randomUUID();
const orgA = `native-events-projects-a-${suffix}`, orgB = `native-events-projects-b-${suffix}`;
const userA = `native-events-projects-user-${suffix}`;
let sql: Sql | undefined;
let service: typeof import("./native-events-projects");

describe.skipIf(!enabled)("native Event and Project PostgreSQL fixture", () => {
  beforeAll(async () => {
    sql = postgres(assertLocalDatabase(databaseUrl), { max: 1 });
    service = await import("./native-events-projects");
    await sql`insert into label_suite.orgs (id, name, slug) values (${orgA}, 'Native A', ${orgA}), (${orgB}, 'Native B', ${orgB})`;
    await sql`insert into label_suite.user (id, name, email, "emailVerified") values (${userA}, 'Native user', ${`${userA}@example.test`}, true)`;
    await sql`insert into label_suite.budget_projects (id, org_id, name, description, status, updated_at) values ('native-project', ${orgA}, 'Goal workstream', 'Deliver the record', 'active', '2026-09-17 10:00:00.123456'), ('native-project-next', ${orgA}, 'Next workstream', 'Next', 'active', '2026-09-16 10:00:00.123456')`;
    await sql`insert into label_suite.project_events (id, org_id, project_id, title, event_type, status, start_date, updated_at) values ('native-event', ${orgA}, 'native-project', 'Release party', 'release_party', 'planned', '2026-10-01', '2026-09-17 10:00:00.123456'), ('native-event-next', ${orgA}, 'native-project', 'Later event', 'release_party', 'planned', '2026-11-01', '2026-09-17 10:00:00.123456')`;
    await sql`insert into label_suite.media_assets (id, org_id, asset_name, project_id) values ('native-asset-own', ${orgA}, 'Project asset', 'native-project'), ('native-asset-other', ${orgA}, 'Other project asset', 'native-project-next'), ('native-asset-event', ${orgA}, 'Event attachment', null)`;
    await sql`insert into label_suite.media_asset_files (id, org_id, media_asset_id, source_postgres_table, source_postgres_record_id, file_name, storage_bucket, storage_key) values ('native-event-file', ${orgA}, 'native-asset-event', 'project_events', 'native-event', 'event.pdf', 'native', 'event.pdf')`;
    await sql`insert into label_suite.artists (id, org_id, name) values ('native-project-artist', ${orgA}, 'Project artist')`;
    await sql`update label_suite.budget_projects set artist_id='native-project-artist' where org_id=${orgA} and id='native-project'`;
    await sql`insert into label_suite.campaigns (id, org_id, campaign_name, linked_artist_id) values ('native-artist-campaign', ${orgA}, 'Artist campaign', 'native-project-artist'), ('native-unrelated-campaign', ${orgA}, 'Unrelated campaign', null), ('native-other-org-campaign', ${orgB}, 'Other workspace campaign', 'native-project-artist')`;
    await sql`insert into label_suite.contacts (id, org_id, name) values ('native-owner', ${orgA}, 'Project owner'), ('native-event-contact', ${orgA}, 'Event contact')`;
    await sql`update label_suite.budget_projects set owner_contact_id='native-owner' where org_id=${orgA} and id='native-project'`;
    await sql`update label_suite.project_events set owner_contact_id='native-owner', contact_id='native-event-contact' where org_id=${orgA} and id='native-event'`;
    await sql`insert into label_suite.documents (id, org_id, name, project_id) values ('native-document', ${orgA}, 'Project brief', 'native-project'), ('native-other-document', ${orgA}, 'Other brief', 'native-project-next')`;
    await sql`insert into label_suite.media_asset_files (id, org_id, media_asset_id, file_name, storage_bucket, storage_key) values ('native-project-file', ${orgA}, 'native-asset-own', 'project.pdf', 'native', 'project.pdf'), ('native-other-file', ${orgA}, 'native-asset-other', 'other.pdf', 'native', 'other.pdf')`;
    await sql`insert into label_suite.budget_line_items (id, org_id, project_id, name, amount) values ('native-budget', ${orgA}, 'native-project', 'Venue cost', 1200.50)`;
    await sql`insert into label_suite.funding_sources (id, org_id, project_id, name, type) values ('native-funding', ${orgA}, 'native-project', 'Self funding', 'self')`;
    await sql`insert into label_suite.grants (id, org_id, name) values ('native-grant', ${orgA}, 'Arts grant')`;
    await sql`insert into label_suite.grant_applications (id, org_id, project_id, grant_id, next_action) values ('native-application', ${orgA}, 'native-project', 'native-grant', 'Submit budget'), ('native-other-application', ${orgA}, 'native-project-next', 'native-grant', 'Other project')`;
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, project_id, event_id, status, next_action) values ('native-task', ${orgA}, 'Book venue', 'native-project', 'native-event', 'todo', 'Confirm venue')`;
  });
  afterAll(async () => { if (!sql) return; await sql`delete from label_suite.audit_events where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.media_asset_files where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.media_assets where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.ops_tasks where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.project_events where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.budget_line_items where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.grant_applications where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.grants where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.funding_sources where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.documents where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.budget_projects where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.campaigns where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.artists where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.contacts where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.user where id=${userA}`; await sql`delete from label_suite.audit_logs where org_id in (${orgA}, ${orgB})`; await sql`delete from label_suite.orgs where id in (${orgA}, ${orgB})`; await sql.end(); });
  it("returns decodable canonical detail after native create and update", async () => {
    const project = await service.createNativeProject(orgA, { name: "Native created project", description: "Original goal" }, userA);
    expect(project).toMatchObject({ record_type: "project", goal: "Original goal", revision: expect.any(String), relationships: { events: [], tasks: [] } });
    const event = await service.createNativeEvent(orgA, service.nativeCreateEventSchema.parse({ title: "Native created event", event_type: "meeting", start_date: "2027-01-01", project_id: project.id, starts_at: "2027-01-01T10:00:00+01:00" }), userA);
    expect(event).toMatchObject({ record_type: "event", revision: expect.any(String), relationships: { project_id: project.id, tasks: [] } });
    const updatedProject = await service.updateNativeProject(orgA, { id: project.id, description: "Updated goal", notes: "Production notes", location_name: "Studio", expected_revision: project.revision }, userA);
    expect(updatedProject).toMatchObject({ record_type: "project", goal: "Updated goal", relationships: { events: [{ id: event.id }] } });
    const updatedEvent = await service.updateNativeEvent(orgA, { id: event.id, ...service.nativeUpdateEventSchema.parse({ notes: "Updated agenda", venue_name: "Main room", starts_at: "2027-01-01T11:00:00+01:00", expected_revision: event.revision }) }, userA);
    expect(updatedEvent).toMatchObject({ record_type: "event", agenda: "Updated agenda", relationships: { project_id: project.id } });
    const [projectAudit] = await sql!`select "before", "after" from label_suite.audit_events where org_id=${orgA} and object_id=${project.id} and event_type='project.updated'`;
    expect(projectAudit.before).toMatchObject({ notes: null, location_name: null });
    expect(projectAudit.after).toMatchObject({ notes: "Production notes", location_name: "Studio" });
    const [eventAudit] = await sql!`select "before", "after" from label_suite.audit_events where org_id=${orgA} and object_id=${event.id} and event_type='event.updated'`;
    expect(eventAudit.before).toMatchObject({ notes: null, venue_name: null, starts_at: "2027-01-01T09:00:00.000Z" });
    expect(eventAudit.after).toMatchObject({ notes: "Updated agenda", venue_name: "Main room", starts_at: "2027-01-01T10:00:00.000Z" });
    const datedProject = await service.updateNativeProject(orgA, { id: project.id, description: null, start_date: "2027-01-01", end_date: "2027-01-02", expected_revision: updatedProject.revision }, userA);
    expect(datedProject).toMatchObject({ goal: null, start_date: "2027-01-01", end_date: "2027-01-02" });
    await expect(service.updateNativeProject(orgA, { id: project.id, start_date: "2027-01-03", expected_revision: datedProject.revision }, userA)).rejects.toThrow("End date must be on or after start date");
    const { updateProject } = await import("./projects");
    await expect(updateProject(orgA, { id: project.id, end_date: "2026-12-31" })).rejects.toThrow("End date must be on or after start date");
    const clearedProject = await service.updateNativeProject(orgA, { id: project.id, start_date: null, end_date: null, expected_revision: datedProject.revision }, userA);
    expect(clearedProject).toMatchObject({ start_date: null, end_date: null });
    const datedEvent = await service.updateNativeEvent(orgA, { id: event.id, end_date: "2027-01-02", expected_revision: updatedEvent.revision }, userA);
    await expect(service.updateNativeEvent(orgA, { id: event.id, start_date: "2027-01-03", expected_revision: datedEvent.revision }, userA)).rejects.toThrow("End date must be on or after start date");
    const { updateProjectEvent } = await import("./project-events");
    await expect(updateProjectEvent(orgA, { id: event.id, end_date: "2026-12-31" })).rejects.toThrow("End date must be on or after start date");
    const clearedEvent = await service.updateNativeEvent(orgA, { id: event.id, notes: null, end_date: null, expected_revision: datedEvent.revision }, userA);
    expect(clearedEvent).toMatchObject({ agenda: null, end_date: null });
    // Keep the existing list-order fixture stable.
    await sql!`delete from label_suite.project_events where id=${event.id}`;
    await sql!`delete from label_suite.budget_projects where id=${project.id}`;
  });
  it("keeps same-looking Event and Project identities distinct, bounded, and tenant scoped", async () => {
    const [events, projects, event, project] = await Promise.all([service.listNativeEvents(orgA, { limit: '1', cursor: null }), service.listNativeProjects(orgA, { limit: '1', cursor: null }), service.getNativeEventDetail(orgA, 'native-event'), service.getNativeProjectDetail(orgA, 'native-project')]);
    expect(events.items[0]).toMatchObject({ record_type: 'event', id: 'native-event', next_action: 'Confirm venue' });
    expect(projects.items[0]).toMatchObject({ record_type: 'project', id: 'native-project', goal: 'Deliver the record', next_action: 'Confirm venue' });
    expect(event).toMatchObject({ record_type: 'event', relationships: { project_id: 'native-project' } });
    expect(project).toMatchObject({ record_type: 'project', relationships: { events: expect.arrayContaining([expect.objectContaining({ id: 'native-event' })]), assets: [{ id: 'native-asset-own' }] }, relationship_availability: { assets: { status: 'available', association: 'project_id' } } });
    expect(project!.relationships.assets.map((asset) => asset.id)).not.toContain('native-asset-other');
    expect(project!.relationships.grants).toEqual([{ id: 'native-application', name: 'Arts grant', status: 'draft', next_action: 'Submit budget' }]);
    expect(project!.relationships.budget).toEqual([{ id: 'native-budget', name: 'Venue cost', status: 'pending', amount: 1200.5, currency: 'USD' }]);
    expect(event!.relationships.project).toMatchObject({ id: 'native-project', name: 'Goal workstream' });
    expect(event!.relationships.budget).toEqual(project!.relationships.budget);
    expect(project!.relationships.people).toEqual([{ id: 'native-owner', name: 'Project owner', status: 'Owner' }]);
    expect(project!.relationships.campaigns.map((campaign) => campaign.id)).toEqual(['native-artist-campaign']);

    expect(event!.relationships.people.map((person) => person.id)).toEqual(['native-event-contact', 'native-owner']);
    expect(project!.relationships.files.map((file) => file.id)).toEqual(['native-project-file']);
    expect(event!.relationships.files.map((file) => file.id)).toEqual(['native-event-file']);
    expect(project!.relationships.documents.map((document) => document.id)).toEqual(['native-document']);
    expect(event!.relationships.documents.map((document) => document.id)).toEqual(['native-document']);
    expect(JSON.stringify(project!.relationships.files)).not.toMatch(/storage_key|storage_bucket/);


    expect(event).toMatchObject({ relationships: { assets: [{ id: 'native-asset-event' }] }, relationship_availability: { assets: { status: 'available', association: 'media_asset_files.source_postgres_record_id' } } });
    expect(await service.getNativeEventDetail(orgA, 'native-event-next')).toMatchObject({ relationships: { assets: [] }, relationship_availability: { assets: { status: 'available' } } });
    expect(await service.getNativeEventDetail(orgB, 'native-event')).toBeNull();
    const before = await service.getNativeEventDetail(orgA, 'native-event');
    await service.updateNativeEvent(orgA, { id: 'native-event', title: 'Renamed happening', expected_revision: before!.revision }, userA);
    const [saved] = await sql!`select title, project_id from label_suite.project_events where id='native-event' and org_id=${orgA}`;
    expect(saved).toEqual({ title: 'Renamed happening', project_id: 'native-project' });
  });
  it("detects a canonical web edit before native save", async () => {
    const { updateProjectEvent } = await import('./project-events');
    const before = await service.getNativeEventDetail(orgA, 'native-event');
    await updateProjectEvent(orgA, { id: 'native-event', notes: 'Canonical web edit' });
    await expect(service.updateNativeEvent(orgA, { id: 'native-event', title: 'Stale native', expected_revision: before!.revision }, userA)).rejects.toMatchObject({ status: 409 });
    const [row] = await sql!`select title, notes from label_suite.project_events where id='native-event'`;
    expect(row).toMatchObject({ title: 'Renamed happening', notes: 'Canonical web edit' });
  });
  it("rolls back an event edit if audit persistence fails", async () => {
    const before = await service.getNativeEventDetail(orgA, 'native-event');
    await sql!.unsafe(`CREATE FUNCTION label_suite.fixture_event_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$`);
    await sql!.unsafe(`CREATE TRIGGER fixture_event_audit_failure BEFORE INSERT ON label_suite.audit_events FOR EACH ROW EXECUTE FUNCTION label_suite.fixture_event_audit_failure()`);
    try {
      await expect(service.updateNativeEvent(orgA, { id: 'native-event', title: 'Must roll back', expected_revision: before!.revision }, userA)).rejects.toThrow();
      const after = await service.getNativeEventDetail(orgA, 'native-event');
      expect(after!.title).toBe(before!.title);
      expect(after!.revision).toBe(before!.revision);
    } finally {
      await sql!.unsafe(`DROP TRIGGER fixture_event_audit_failure ON label_suite.audit_events`);
      await sql!.unsafe(`DROP FUNCTION label_suite.fixture_event_audit_failure()`);
    }
  });

  it("uses opaque keysets so intervening inserts do not duplicate or skip the next record", async () => {
    const firstEvents = await service.listNativeEvents(orgA, { limit: '1', cursor: null });
    await sql!`insert into label_suite.project_events (id, org_id, title, event_type, status, start_date) values ('native-event-earlier', ${orgA}, 'Earlier event', 'release_party', 'planned', '2026-09-01')`;
    const secondEvents = await service.listNativeEvents(orgA, { limit: '1', cursor: firstEvents.next_cursor });
    expect(firstEvents.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secondEvents.items.map((item) => item.id)).toEqual(['native-event-next']);

    const firstProjects = await service.listNativeProjects(orgA, { limit: '1', cursor: null });
    await sql!`insert into label_suite.budget_projects (id, org_id, name, status, updated_at) values ('native-project-newer', ${orgA}, 'Newer workstream', 'active', '2026-09-18 10:00:00.123456')`;
    const secondProjects = await service.listNativeProjects(orgA, { limit: '1', cursor: firstProjects.next_cursor });
    expect(firstProjects.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secondProjects.items.map((item) => item.id)).toEqual(['native-project-next']);
  });

  it("keeps native CAS and audit atomic when a canonical web writer changes the same Event", async () => {
    const before = await service.getNativeEventDetail(orgA, 'native-event-next');
    await service.updateNativeEvent(orgA, { id: 'native-event-next', title: 'Native update', expected_revision: before!.revision }, userA);
    const canonical = await import('./project-events');
    await canonical.updateProjectEvent(orgA, { id: 'native-event-next', title: 'Canonical web update' });
    await expect(service.updateNativeEvent(orgA, { id: 'native-event-next', title: 'Stale native update', expected_revision: before!.revision }, userA)).rejects.toMatchObject({ status: 409 });
    const [saved] = await sql!`select title from label_suite.project_events where id='native-event-next' and org_id=${orgA}`;
    const [audit] = await sql!`select count(*)::int as count from label_suite.audit_events where org_id=${orgA} and object_id='native-event-next' and event_type='event.updated'`;
    expect(saved.title).toBe('Canonical web update');
    expect(audit.count).toBe(1);
  });
  it("declares capped relationship windows and preserves precise timestamp ties", async () => {
    for (let n = 0; n < 10; n++) {
      await sql!`insert into label_suite.ops_tasks (id,org_id,task_name,event_id,project_id) values (${`window-task-${n}`},${orgA},${`Task ${n}`},'native-event','native-project')`;
    }
    const event = await service.getNativeEventDetail(orgA, 'native-event');
    const project = await service.getNativeProjectDetail(orgA, 'native-project');
    expect(event!.relationships.tasks).toHaveLength(8);
    expect(event!.relationship_windows.tasks.partial).toBe(true);
    expect(project!.relationships.tasks).toHaveLength(8);
    expect(project!.relationship_windows.tasks.partial).toBe(true);
    await sql!`insert into label_suite.budget_projects (id,org_id,name,updated_at) values ('micro-new',${orgB},'New','2026-09-17 10:00:00.123457'),('micro-old',${orgB},'Old','2026-09-17 10:00:00.123456')`;
    const first = await service.listNativeProjects(orgB, { limit: '1', cursor: null });
    const second = await service.listNativeProjects(orgB, { limit: '1', cursor: first.next_cursor });
    expect(first.items[0].id).toBe('micro-new');
    expect(second.items[0].id).toBe('micro-old');
    if (process.env.NATIVE_EVENTS_PROJECTS_CONTRACT_OUTPUT) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(process.env.NATIVE_EVENTS_PROJECTS_CONTRACT_OUTPUT, JSON.stringify({ event, project }, null, 2));
    }
  });
});
function assertLocalDatabase(value: string) { const url = new URL(value); const name = decodeURIComponent(url.pathname).replace(/^\/+/, ''); if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1'].includes(url.hostname) || name !== 'native_events_projects_fixture' || url.search || url.hash) throw new Error('Require exact local label_suite DB'); return url.toString(); }
