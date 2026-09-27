import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("./integrations", async original => {
  const actual = await original<typeof import("./integrations")>();
  return { ...actual, recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
    if (audit.fail) throw new Error("Fixture audit failure");
    return actual.recordAuditEvent(...args);
  } };
});
const org = `radio-${randomUUID()}`, foreign = `radio-${randomUUID()}`, actor = `radio-user-${randomUUID()}`;
const foreignActor = `radio-foreign-user-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let radio: typeof import("./native-radio");
let scoped: typeof import("../lib/db").runWithDatabaseContext;
const input = (revision: string) => ({ expected_revision: revision, priority: "high", pitch_angle: "Local session", feedback: "Preparation only" });
const detail = () => scoped({ orgId: org, userId: actor }, () => radio.getNativeRadioStation(org, "radio-campaign", "radio-link"));
const update = (raw: unknown, id = "radio-link") => scoped({ orgId: org, userId: actor }, () => radio.updateNativeRadioPreparation(org, "radio-campaign", id, actor, raw));

describe.skipIf(process.env.NATIVE_RADIO_INTEGRATION !== "1")("native radio preparation", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_radio_fixture" || url.search || url.hash) throw new Error("Disposable native_radio_fixture only");
    sql = postgres(url.toString(), { max: 1 });
    radio = await import("./native-radio");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Radio',${org}),(${foreign},'Foreign',${foreign})`;
    await sql`insert into label_suite."user" (id,name,email,"emailVerified") values (${actor},'Radio fixture',${actor + '@example.test'},true)`;
    await sql`insert into label_suite."user" (id,name,email,"emailVerified") values (${foreignActor},'Foreign private actor',${foreignActor + '@example.test'},true)`;
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${randomUUID()},${foreign},${foreignActor},'operator')`;
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${randomUUID()},${org},${actor},'operator')`;
    await sql`insert into label_suite.campaigns (id,org_id,campaign_name,status) values ('radio-campaign',${org},'Campaign','active'),('radio-foreign-campaign',${foreign},'Foreign campaign','active')`;
    await sql`insert into label_suite.radio_stations (id,org_id,name,email) values ('radio-station',${org},'Station','raw-unverified@example.test'),('radio-foreign-station',${foreign},'Foreign station','secret@example.test')`;
    await sql`insert into label_suite.campaign_stations (id,org_id,campaign_id,station_id,status) values ('radio-link',${org},'radio-campaign','radio-station','selected'),('radio-foreign-link',${foreign},'radio-foreign-campaign','radio-foreign-station','selected')`;
    await sql`insert into label_suite.contacts (id,org_id,name) values ('radio-contact',${org},'Contact'),('radio-foreign-contact',${foreign},'Private Contact')`;
    for (const [id, contact, route] of [['radio-lead','radio-contact','route@example.test'],['radio-second',null,null]]) {
      await sql`insert into label_suite.campaign_leads (id,org_id,campaign_id,station_id,contact_id,dedupe_key,target_name,target_type,contact_route,discovery_source)
        values (${id},${org},'radio-campaign','radio-station',${contact},${id},${id},'radio_station',${route},'Manual research')`;
    }
    await sql`insert into label_suite.campaign_outreach_drafts (id,org_id,campaign_id,lead_id,scope,version,subject,body,context_snapshot)
      values ('radio-draft',${org},'radio-campaign','radio-lead','focused',1,'Subject','Exact body','{}')`;
  });
  afterAll(async () => {
    if (!sql) return;
    for (const table of ['audit_events','campaign_outreach_events','campaign_outreach_drafts','campaign_communicator_prompts','campaign_public_page_revisions','campaign_public_pages','campaign_leads','campaign_stations','radio_stations','campaigns','tracks','media_assets','releases','contacts','org_memberships','audit_logs']) await sql.unsafe(`delete from label_suite.${table} where org_id in ($1,$2)`, [org, foreign]);
    await sql`delete from label_suite.orgs where id in (${org},${foreign})`;
    await sql`delete from label_suite."user" where id in (${actor},${foreignActor})`;
    await sql.end();
  });
  it("preserves multiple leads, Contact provenance and exact draft identity without borrowing raw station email", async () => {
    await expect(sql`update label_suite.campaign_leads set contact_id='radio-foreign-contact' where id='radio-second'`).rejects.toThrow("Cross-organization reference");
    const result = await detail();
    expect(result.leads).toHaveLength(2);
    expect(result.leads.find(row => row.id === 'radio-lead')).toMatchObject({ contact_id: 'radio-contact', contact_name: 'Contact', route: 'route@example.test', route_verified_at: null });
    expect(result.leads.find(row => row.id === 'radio-second')).toMatchObject({ contact_id: null, contact_name: null, route: null });
    expect(result.drafts[0]).toMatchObject({ id: 'radio-draft', lead_id: 'radio-lead', version: 1, body: 'Exact body', status: 'draft' });
    expect(result.drafts[0].content_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.drafts[0].blockers).toContain('contact route verified at requires review.');
    expect(JSON.stringify(result)).not.toMatch(/raw-unverified|Private Contact|secret@example/);
    await expect(radio.getNativeRadioStation(foreign, 'radio-campaign', 'radio-link')).rejects.toMatchObject({ status: 404 });
    expect((await radio.listNativeRadioStations(org, 'radio-campaign', null, 'absent')).items).toEqual([]);
  });
  it("creates immutable manual versions and rejects stale, unauthorized and foreign recipient writes", async () => {
    const { createNativeRadioDraft } = await import("./campaign-communicator");
    const before = await detail();
    const lead = before.leads.find(row => row.id === 'radio-second')!;
    const payload = { expected_station_revision: before.station.revision,
      target: { scope: 'focused', lead_id: lead.id, expected_lead_revision: lead.revision },
      source: null, subject: 'Manual subject', body: 'Manual preparation' };
    const write = (raw: unknown) => scoped({ orgId: org, userId: actor }, () => createNativeRadioDraft(org, 'radio-campaign', 'radio-link', actor, raw));
    await expect(write({ ...payload, target: { ...payload.target, lead_id: 'foreign-lead' } })).rejects.toMatchObject({ status: 404 });
    await sql`update label_suite.org_memberships set role='member' where org_id=${org}`;
    await expect(write(payload)).rejects.toMatchObject({ status: 403 });
    await sql`update label_suite.org_memberships set role='operator' where org_id=${org}`;
    await expect(write({ ...payload, target: { ...payload.target, expected_lead_revision: 'stale' } })).rejects.toMatchObject({ status: 409 });
    await expect(write({ ...payload, target: { scope: 'radio_update', page_revision_id: 'foreign-page', expected_page_hash: '0'.repeat(64) } })).rejects.toMatchObject({ status: 404 });
    for (const extra of [{ send: true }, { provider: 'email' }, { follow_up_at: '2026-10-01' }]) await expect(write({ ...payload, ...extra })).rejects.toThrow();
    const first = await write(payload);
    expect(first).toMatchObject({ version: 1, status: 'draft', body: 'Manual preparation', body_document: null, approved_at: null });
    await expect(write(payload)).rejects.toMatchObject({ status: 409 });
    const loaded = (await detail()).drafts.find(row => row.id === first.id)!;
    const edit = { ...payload, source: { id: loaded.id, revision: loaded.revision, content_sha256: loaded.content_sha256 }, body: 'Revised preparation' };
    await expect(write({ ...edit, source: { ...edit.source, content_sha256: '0'.repeat(64) } })).rejects.toMatchObject({ status: 409 });
    const second = await write(edit);
    expect(second).toMatchObject({ version: 2, status: 'draft', body: 'Revised preparation', body_document: null });
    await expect(write(edit)).rejects.toMatchObject({ status: 409 });
    const [original] = await sql`select body,status from label_suite.campaign_outreach_drafts where id=${first.id}`;
    expect(original).toEqual({ body: 'Manual preparation', status: 'superseded' });
    const events = await sql`select event_type from label_suite.campaign_outreach_events where draft_id in (${first.id},${second.id}) order by occurred_at`;
    expect(events.map(row => row.event_type)).toEqual(['draft_manual','draft_version_created']);
  });
  it("preserves rich document structure across versions and refuses destructive plain fallback", async () => {
    const { createNativeRadioDraft } = await import("./campaign-communicator");
    const before = await detail(), lead = before.leads.find(row => row.id === 'radio-second')!;
    const source = before.drafts.filter(row => row.lead_id === lead.id).sort((a,b) => b.version-a.version)[0];
    const document = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Radio', marks: [{ type: 'bold' }] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Listen', marks: [{ type: 'italic' }, { type: 'link', attrs: { href: 'https://example.test/listen' } }] }, { type: 'hardBreak' }, { type: 'text', text: 'Now' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quoted context' }] }] },
    ] };
    const payload = { expected_station_revision: before.station.revision, target: { scope: 'focused', lead_id: lead.id, expected_lead_revision: lead.revision },
      source: { id: source.id, revision: source.revision, content_sha256: source.content_sha256 }, subject: 'Rich draft', body_document: document };
    const write = (raw: unknown) => scoped({ orgId: org, userId: actor }, () => createNativeRadioDraft(org, 'radio-campaign', 'radio-link', actor, raw));
    await expect(write({ ...payload, body: 'Ambiguous fallback' })).rejects.toThrow();
    await expect(write({ ...payload, body_document: { type: 'doc', content: [{ type: 'script' }] } })).rejects.toThrow();
    const first = await write(payload);
    expect(first.body_document).toEqual(document);
    const loaded = (await detail()).drafts.find(row => row.id === first.id)!;
    expect(loaded.body_document).toEqual(document);
    expect(loaded.editable).toBe(true);
    const next = { ...payload, source: { id: loaded.id, revision: loaded.revision, content_sha256: loaded.content_sha256 } };
    await expect(write({ ...next, body_document: undefined, body: loaded.body })).rejects.toMatchObject({ status: 409 });
    const second = await write(next);
    expect(second.body_document).toEqual(document);
    expect(second.version).toBe(first.version + 1);
    const [stored] = await sql`select body_document from label_suite.campaign_outreach_drafts where id=${first.id}`;
    expect(stored.body_document).toEqual(document);
  });
  it("versions campaign-wide drafts only against fresh reviewed page content and prompt context", async () => {
    const { createNativeRadioDraft } = await import("./campaign-communicator");
    const pages = await import("./campaign-public-page");
    await sql`insert into label_suite.releases (id,org_id,title,release_date) values ('radio-release',${org},'Release','2026-12-04')`;
    await sql`insert into label_suite.tracks (id,org_id,title,release_id) values ('radio-track',${org},'Track','radio-release')`;
    await sql`insert into label_suite.media_assets (id,org_id,asset_name,linked_release_id,approval_status,file_link) values ('radio-artwork',${org},'Artwork','radio-release','approved','https://example.test/art.jpg')`;
    await sql`update label_suite.campaigns set linked_release_id='radio-release' where id='radio-campaign'`;
    const content = { label_line: 'Label', title: 'Radio release', release_note: 'Release details', artwork_asset_id: 'radio-artwork',
      focus_track_ids: ['radio-track'], listen_url: 'https://example.test/listen', download_url: null, metadata_url: null,
      contact_name: 'Label contact', contact_email: 'radio@example.test', network_statement: 'Shared with our independent radio network.' as const };
    const inScope = <T>(work: () => Promise<T>) => scoped({ orgId: org, userId: actor }, work);
    const saved = await inScope(() => pages.saveCampaignPublicPageDraft(org, 'radio-campaign', { slug: org, content }, actor));
    const before = await detail();
    const payload = { expected_station_revision: before.station.revision, target: { scope: 'radio_update', page_revision_id: saved.revision.id, expected_page_hash: saved.revision.content_hash },
      source: null, subject: 'Network update', body: 'Manual campaign update' };
    const write = (raw: unknown) => inScope(() => createNativeRadioDraft(org, 'radio-campaign', 'radio-link', actor, raw));
    await expect(write(payload)).rejects.toThrow();
    await inScope(() => pages.reviewCampaignPublicPageRevision(org, 'radio-campaign', saved.revision.id, actor));
    const editor = await detail();
    expect(editor.reviewed_pages).toEqual([expect.objectContaining({ id: saved.revision.id, fresh: true, content_hash: saved.revision.content_hash })]);
    const first = await write(payload);
    expect((await detail()).activity.some(row => row.event_type === 'radio_update_draft_manual')).toBe(true);
    expect(first).toMatchObject({ scope: 'radio_update', lead_id: null, version: 1, status: 'draft', context_snapshot: { page_revision_id: saved.revision.id } });
    const loaded = (await detail()).drafts.find(row => row.id === first.id)!;
    const edit = { ...payload, source: { id: loaded.id, revision: loaded.revision, content_sha256: loaded.content_sha256 }, body: 'Updated network draft' };
    await expect(write({ ...edit, target: { ...edit.target, expected_page_hash: '0'.repeat(64) } })).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.releases set release_date='2026-12-05' where id='radio-release'`;
    await expect(write(edit)).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.releases set release_date='2026-12-04' where id='radio-release'`;
    const second = await write(edit);
    expect(second).toMatchObject({ version: 2, body: 'Updated network draft', status: 'draft' });
    const latest = (await detail()).drafts.find(row => row.id === second.id)!;
    await sql`insert into label_suite.campaign_communicator_prompts (id,org_id,campaign_id,version,prompt) values (${randomUUID()},${org},'radio-campaign',1,'New voice')`;
    await expect(write({ ...edit, source: { id: latest.id, revision: latest.revision, content_sha256: latest.content_sha256 } })).rejects.toMatchObject({ status: 409 });
    const [page] = await sql`select status from label_suite.campaign_public_pages where id=${saved.page!.id}`;
    expect(page.status).toBe('draft');
    const events = await sql`select event_type from label_suite.campaign_outreach_events where draft_id in (${first.id},${second.id}) order by occurred_at`;
    expect(events.map(row => row.event_type)).toEqual(['radio_update_draft_manual','draft_version_created']);
  });
  it("serializes stale edits, records audit and preserves delivery fields", async () => {
    const [eventCount] = await sql`select count(*)::int n from label_suite.campaign_outreach_events where org_id=${org}`;
    const before = await detail();
    const outcomes = await Promise.allSettled([update({ ...input(before.station.revision), status: 'drafted' }), update(input(before.station.revision))]);
    expect(outcomes.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(row => row.status === 'rejected')).toHaveLength(1);
    const current = await detail();
    expect(current.station.revision).not.toBe(before.station.revision);
    const [row] = await sql`select last_contacted_at, follow_up_at from label_suite.campaign_stations where id='radio-link'`;
    expect(row).toEqual({ last_contacted_at: null, follow_up_at: null });
    const activity = current.activity.find(row => row.event_type === 'radio.preparation.updated');
    expect(activity).toMatchObject({ actor_name: 'Radio fixture', campaign_id: 'radio-campaign', station_id: 'radio-station' });
    expect(activity?.changes.some(change => change.includes('Preparation only'))).toBe(true);
    const [count] = await sql`select count(*)::int n from label_suite.campaign_outreach_events where org_id=${org}`;
    expect(count.n).toBe(eventCount.n);
  });
  it("does not expose an actor from another workspace in malformed activity rows", async () => {
    const auditId = randomUUID(), eventId = randomUUID();
    await sql`insert into label_suite.audit_events (id,org_id,actor_user_id,event_type,object_type,object_id) values (${auditId},${org},${foreignActor},'radio.fixture','campaign_station','radio-link')`;
    await sql`insert into label_suite.campaign_outreach_events (id,org_id,campaign_id,actor_user_id,event_type,details) values (${eventId},${org},'radio-campaign',${foreignActor},'radio.fixture','{}')`;
    const rows = (await detail()).activity.filter(row => row.event_type === 'radio.fixture');
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.actor_name === null)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('Foreign private actor');
  });
  it("rejects delivery fields and moving sent state backwards", async () => {
    const before = await detail();
    for (const extra of [{ status: 'sent' }, { follow_up_at: '2026-10-01' }, { last_contacted_at: '2026-10-01' }, { provider: 'email' }]) {
      await expect(update({ ...input(before.station.revision), ...extra })).rejects.toThrow();
    }
    await sql`update label_suite.campaign_stations set status='sent' where id='radio-link'`;
    await expect(update({ ...input(before.station.revision), status: 'selected' })).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.campaign_stations set status='selected' where id='radio-link'`;
  });
  it("refuses archived campaigns, current read-only roles, foreign links and rolls back audit failure", async () => {
    const before = await detail();
    await sql`update label_suite.campaigns set status='archived' where id='radio-campaign'`;
    await expect(update(input(before.station.revision))).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.campaigns set status='active' where id='radio-campaign'`;
    await sql`update label_suite.org_memberships set role='member' where org_id=${org}`;
    await expect(update(input(before.station.revision))).rejects.toMatchObject({ status: 403 });
    await sql`update label_suite.org_memberships set role='operator' where org_id=${org}`;
    await expect(update(input(before.station.revision), 'radio-foreign-link')).rejects.toMatchObject({ status: 404 });
    audit.fail = true;
    try { await expect(update(input(before.station.revision))).rejects.toThrow('Fixture audit failure'); }
    finally { audit.fail = false; }
    expect((await detail()).station).toEqual(before.station);
  });
});
