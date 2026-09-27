import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const suite = process.env.NATIVE_CONTACTS_INTEGRATION === "1" ? describe : describe.skip;
const suffix = randomUUID(), org = `native-contacts-${suffix}`, actor = `native-actor-${suffix}`;
let sql: ReturnType<typeof postgres>;
let service: typeof import("./native-contacts");
let scoped: typeof import("../lib/db").runWithDatabaseContext;
suite("native Contacts disposable database", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_contacts_fixture") throw new Error("Disposable fixture only");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./native-contacts");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Fixture',${org})`;
    await sql`insert into label_suite."user" (id,name,email,"emailVerified") values (${actor},'Fixture',${`${actor}@example.test`},true)`;
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${suffix},${org},${actor},'operator')`;
  });
  afterAll(async () => { if (sql) await sql.end(); });
  it("filters people and organizations before pagination without crossing workspaces", async () => {
    const same = randomUUID();
    await sql`insert into label_suite.contacts (id,org_id,name) values (${same},${org},'Filtered identity')`;
    await sql`insert into label_suite.organizations (id,org_id,name) values (${same},${org},'Filtered identity')`;
    for (const kind of ["person", "organization"] as const) {
      const page = await scoped({ userId: actor, orgId: org }, () => service.listNativeContacts(org, service.parseNativeContactList({ query: "Filtered identity", kind, limit: "1", cursor: null })));
      expect(page.items.map(item => item.identity)).toEqual([{ kind, id: same }]);
      expect(page.next_cursor).toBeNull();
    }
    const foreign = await scoped({ userId: actor, orgId: org }, () => service.listNativeContacts("other-workspace", service.parseNativeContactList({ query: "Filtered identity", kind: null, limit: "1", cursor: null })));
    expect(foreign.items).toEqual([]);
  });
  it("shows bounded campaign context from leads, creator engagements and explicit audience membership", async () => {
    const person = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: "person", name: "Campaign person" } as never, actor));
    const audience = randomUUID();
    await sql`insert into label_suite.campaign_audiences (id,org_id,name) values (${audience},${org},'Contact fixture audience')`;
    await sql`insert into label_suite.campaign_audience_contacts (id,org_id,audience_id,contact_id) values (${randomUUID()},${org},${audience},${person.id})`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < ids.length; index++) {
      await sql`insert into label_suite.campaigns (id,org_id,campaign_name,campaign_audience_id) values (${ids[index]},${org},${'Contact campaign ' + index},${index === 2 ? audience : null})`;
    }
    await sql`insert into label_suite.campaign_leads (id,org_id,campaign_id,contact_id,dedupe_key,target_name,target_type,discovery_source) values (${randomUUID()},${org},${ids[0]},${person.id},${randomUUID()},'Fixture','youtube_channel','manual')`;
    await sql`insert into label_suite.campaign_creator_engagements (id,org_id,campaign_id,contact_id) values (${randomUUID()},${org},${ids[1]},${person.id})`;
    // A duplicate path must not duplicate a campaign in the contact's context.
    await sql`insert into label_suite.campaign_creator_engagements (id,org_id,campaign_id,contact_id) values (${randomUUID()},${org},${ids[0]},${person.id})`;
    const detail = await scoped({ userId: actor, orgId: org }, () => service.getNativeContactDetail(org, person.id, "person"));
    expect(detail.context.campaigns.items.map(item => item.id)).toEqual(ids);
    expect(detail.context.campaigns).toMatchObject({ partial: false });
    await expect(scoped({ userId: actor, orgId: org }, () => service.getNativeContactDetail("foreign-workspace", person.id, "person"))).rejects.toMatchObject({ status: 404 });
  });
  it("edits a newly created canonical Person and rejects a stale repeat", async () => {
    const created = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: "person", name: "Fixture Person" } as never, actor));
    const command = { kind: "person", expected_updated_at: created.revision!, name: "Updated Person" } as const;
    const edited = await scoped({ userId: actor, orgId: org }, () => service.updateNativeContact(org, created.id, command as never, actor));
    expect(edited).toMatchObject({ kind: "person" });
    await expect(scoped({ userId: actor, orgId: org }, () => service.updateNativeContact(org, created.id, command as never, actor))).rejects.toMatchObject({ status: 409 });
    const [row] = await sql`select name from label_suite.contacts where id = ${created.id}`;
    expect(row.name).toBe("Updated Person");
  });
  it.each([["accept", "ignore"], ["ignore", "ignore"]] as const)("allows one proposal decision winner for %s/%s", async (first, second) => {
    const created = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: "person", name: "Proposal fixture" } as never, actor));
    const proposal = randomUUID();
    await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,contact_id,field,value,normalized_value,evidence) values (${proposal},${org},${created.id},'email','cited@example.test','cited@example.test',${sql.json({ message_id: 'synthetic-message' })})`;
    const results = await Promise.allSettled([first, second].map(action => scoped({ userId: actor, orgId: org }, () => service.decideNativeContactProposal(org, created.id, { id: proposal, kind: 'person', action, expected_updated_at: created.revision! }, actor))));
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(loser.reason).toMatchObject({ status: 409 });
    const [state] = await sql`select status from label_suite.contact_enrichment_suggestions where id = ${proposal}`;
    const [contact] = await sql`select email from label_suite.contacts where id = ${created.id}`;
    expect(contact.email).toBe(state.status === 'applied' ? 'cited@example.test' : null);
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where object_id = ${proposal}`;
    expect(audit.count).toBe(1);
  });
  it.each(["gmail", "unsupported"])("rejects missing or unauthorized citation authority (%s) and rolls back", async (sourceType) => {
    const created = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: 'person', name: 'Uncited fixture' } as never, actor));
    const proposal = randomUUID();
    await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,contact_id,field,value,normalized_value,source_type,evidence) values (${proposal},${org},${created.id},'email','uncited@example.test','uncited@example.test',${sourceType},${sourceType === 'gmail' ? null : sql.json({ message_id: 'not-gmail-authority' })})`;
    await expect(scoped({ userId: actor, orgId: org }, () => service.decideNativeContactProposal(org, created.id, { id: proposal, kind: 'person', action: 'accept', expected_updated_at: created.revision! }, actor))).rejects.toMatchObject({ status: 409 });
    const [state] = await sql`select status from label_suite.contact_enrichment_suggestions where id = ${proposal}`;
    const [contact] = await sql`select email from label_suite.contacts where id = ${created.id}`;
    expect(state.status).toBe('pending'); expect(contact.email).toBeNull();
  });
  it.each(["email", "organization_name"])("rolls back the %s proposal, contact and relationships when audit insertion fails", async (field) => {
    const created = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: 'person', name: 'Audit rollback fixture' } as never, actor));
    const proposal = randomUUID();
    await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,contact_id,field,value,normalized_value,evidence) values (${proposal},${org},${created.id},${field},'audit@example.test','audit@example.test',${sql.json({ message_id: 'synthetic-audit-message' })})`;
    await sql.unsafe(`CREATE FUNCTION label_suite.fixture_contacts_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$`);
    await sql.unsafe(`CREATE TRIGGER fixture_contacts_audit_failure BEFORE INSERT ON label_suite.audit_events FOR EACH ROW EXECUTE FUNCTION label_suite.fixture_contacts_audit_failure()`);
    try {
      await expect(scoped({ userId: actor, orgId: org }, () => service.decideNativeContactProposal(org, created.id, { id: proposal, kind: 'person', action: 'accept', expected_updated_at: created.revision! }, actor))).rejects.toThrow();
      const [state] = await sql`select status from label_suite.contact_enrichment_suggestions where id = ${proposal}`;
      const [contact] = await sql`select email from label_suite.contacts where id = ${created.id}`;
      expect(state.status).toBe('pending'); expect(contact.email).toBeNull();
      const links = await sql`select id from label_suite.contact_organizations where org_id=${org} and contact_id=${created.id}`;
      expect(links).toHaveLength(0);
      const newOrganizations = await sql`select id from label_suite.organizations where org_id=${org} and name='audit@example.test'`;
      expect(newOrganizations).toHaveLength(0);
      const unchanged = await scoped({ userId: actor, orgId: org }, () => service.getNativeContactDetail(org, created.id, 'person'));
      expect(unchanged.revision).toBe(created.revision);
    } finally {
      await sql.unsafe(`DROP TRIGGER fixture_contacts_audit_failure ON label_suite.audit_events`);
      await sql.unsafe(`DROP FUNCTION label_suite.fixture_contacts_audit_failure()`);
    }
  });
  it("preserves web organization-name acceptance and orphan suggestion dismissal", async () => {
    const { updateContactEnrichmentSuggestion } = await import("./gmail-enrichment");
    const person = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: "person", name: "Organization proposal person" } as never, actor));
    const organizationName = `Organization suggestion ${suffix}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const proposal = randomUUID();
      await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,contact_id,field,value,normalized_value,evidence) values (${proposal},${org},${person.id},'organization_name',${organizationName},${organizationName + attempt},${sql.json({ message_id: 'organization-message' })})`;
      const result = await scoped({ userId: actor, orgId: org }, () => updateContactEnrichmentSuggestion(org, { id: proposal, action: "apply" }, actor));
      expect(result).toMatchObject({ ok: true, action: "apply" });
      const [audit] = await sql`select actor_user_id, "after" from label_suite.audit_events where object_id = ${proposal}`;
      expect(audit.actor_user_id).toBe(actor);
      expect(audit.after.organization_link.created).toBe(attempt === 0);
    }
    const links = await sql`select o.name from label_suite.contact_organizations l join label_suite.organizations o on o.id=l.organization_id where l.org_id=${org} and l.contact_id=${person.id}`;
    expect(links.map(link => link.name)).toEqual([organizationName]);
    const [unchanged] = await sql`select company from label_suite.contacts where id=${person.id}`;
    expect(unchanged.company).toBeNull();
    const orphan = randomUUID();
    await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,field,value,normalized_value) values (${orphan},${org},'email','orphan@example.test','orphan@example.test')`;
    await scoped({ userId: actor, orgId: org }, () => updateContactEnrichmentSuggestion(org, { id: orphan, action: "ignore" }, actor));
    const [ignored] = await sql`select status from label_suite.contact_enrichment_suggestions where id=${orphan}`;
    expect(ignored.status).toBe("ignored");
  });
  it("reuses one organization when proposals for different people are accepted concurrently", async () => {
    const people = await Promise.all(["First", "Second"].map(name => scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: "person", name } as never, actor))));
    const name = `Concurrent organization ${suffix}`;
    const proposalIDs = [randomUUID(), randomUUID()];
    for (let i = 0; i < people.length; i++) {
      await sql`insert into label_suite.contact_enrichment_suggestions (id,org_id,contact_id,field,value,normalized_value,evidence) values (${proposalIDs[i]},${org},${people[i].id},'organization_name',${name},${name},${sql.json({ message_id: 'concurrent-organization-message' })})`;
    }
    const results = await Promise.all(people.map((person, i) => scoped({ userId: actor, orgId: org }, () => service.decideNativeContactProposal(org, person.id, { id: proposalIDs[i], kind: "person", action: "accept", expected_updated_at: person.revision! }, actor))));
    expect(results.map(result => result.status)).toEqual(["applied", "applied"]);
    const organizations = await sql`select id from label_suite.organizations where org_id=${org} and name=${name}`;
    expect(organizations).toHaveLength(1);
    const links = await sql`select contact_id from label_suite.contact_organizations where org_id=${org} and organization_id=${organizations[0].id}`;
    expect(links.map(link => link.contact_id).sort()).toEqual(people.map(person => person.id).sort());
  });
  it("detects a canonical legacy edit before a native save", async () => {
    const { updateContact } = await import('./contacts');
    const created = await scoped({ userId: actor, orgId: org }, () => service.createNativeContact(org, { kind: 'person', name: 'Legacy fixture' } as never, actor));
    await scoped({ userId: actor, orgId: org }, () => updateContact(org, { id: created.id, name: 'Legacy changed' } as never, actor));
    await expect(scoped({ userId: actor, orgId: org }, () => service.updateNativeContact(org, created.id, { kind: 'person', name: 'Stale native', expected_updated_at: created.revision! } as never, actor))).rejects.toMatchObject({ status: 409 });
  });
  it("does not skip an Organization with the same name/id as a Person at a page boundary", async () => {
    const same = randomUUID();
    await sql`insert into label_suite.contacts (id,org_id,name) values (${same},${org},'Collision fixture')`;
    await sql`insert into label_suite.organizations (id,org_id,name) values (${same},${org},'Collision fixture')`;
    const one = await scoped({ userId: actor, orgId: org }, () => service.listNativeContacts(org, service.parseNativeContactList({ query: 'Collision fixture', kind: null, limit: '1', cursor: null })));
    expect(one.items).toHaveLength(1);
    const two = await scoped({ userId: actor, orgId: org }, () => service.listNativeContacts(org, service.parseNativeContactList({ query: 'Collision fixture', kind: null, limit: '1', cursor: one.next_cursor })));
    expect(two.items).toHaveLength(1);
    expect(new Set([one.items[0].identity.kind, two.items[0].identity.kind]).size).toBe(2);
    const person = await scoped({ userId: actor, orgId: org }, () => service.getNativeContactDetail(org, same, "person"));
    const organization = await scoped({ userId: actor, orgId: org }, () => service.getNativeContactDetail(org, same, "organization"));
    expect(person.identity).toEqual({ kind: "person", id: same });
    expect(organization.identity).toEqual({ kind: "organization", id: same });
    if (process.env.NATIVE_CONTACTS_CONTRACT_OUTPUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.env.NATIVE_CONTACTS_CONTRACT_OUTPUT, JSON.stringify({ person, organization, page: one }, null, 2));
    }
  });
});
