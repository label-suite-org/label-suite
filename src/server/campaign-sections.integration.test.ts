import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const enabled = process.env.NATIVE_SECTIONS_INTEGRATION === "1";
const suite = enabled ? describe : describe.skip;
const id = randomUUID();
const org = `sections-org-${id}`, actor = `sections-user-${id}`, campaign = `sections-campaign-${id}`;
let sql: ReturnType<typeof postgres>;
let mutate: typeof import("./campaign-sections").mutateNativeCampaignSections;
let scoped: typeof import("../lib/db").runWithDatabaseContext;
suite("native sections real database boundary", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_sections_fixture") throw new Error("Disposable fixture only");
    sql = postgres(url.toString(), { max: 1 });
    ({ mutateNativeCampaignSections: mutate } = await import("./campaign-sections"));
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Fixture', ${org})`;
    await sql`insert into label_suite."user" (id, name, email, "emailVerified") values (${actor}, 'Fixture operator', ${`${actor}@example.test`}, true)`;
    await sql`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${id}, ${org}, ${actor}, 'operator')`;
    await sql`insert into label_suite.campaigns (id, org_id, campaign_name, revision) values (${campaign}, ${org}, 'Fixture', 1)`;
  });
  afterAll(async () => { if (sql) await sql.end(); });
  it("persists a revision-checked selection and rejects a repeated stale save", async () => {
    const result = await scoped({ userId: actor, orgId: org }, () => mutate(org, campaign, { action: "select_template", template_id: null, expected_revision: 1 }, actor));
    expect(result.campaign.revision).toBe(2);
    await expect(scoped({ userId: actor, orgId: org }, () => mutate(org, campaign, { action: "select_template", template_id: null, expected_revision: 1 }, actor))).rejects.toMatchObject({ status: 409 });
    const [row] = await sql`select revision, reviewed_template_id from label_suite.campaigns where id = ${campaign}`;
    expect(row).toMatchObject({ revision: 2, reviewed_template_id: null });
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where org_id = ${org} and object_id = ${campaign} and event_type = 'campaign.sections.select_template'`;
    expect(audit.count).toBe(1);
  });
  it("rolls back selection and revision when audit persistence fails", async () => {
    await sql.unsafe(`CREATE FUNCTION label_suite.fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit unavailable'; END $$`);
    await sql.unsafe(`CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON label_suite.audit_events FOR EACH ROW EXECUTE FUNCTION label_suite.fixture_audit_failure()`);
    try {
      await expect(scoped({ userId: actor, orgId: org }, () => mutate(org, campaign, { action: "select_template", template_id: null, expected_revision: 2 }, actor))).rejects.toThrow();
      const [row] = await sql`select revision from label_suite.campaigns where id = ${campaign}`;
      expect(row.revision).toBe(2);
      const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where org_id = ${org} and object_id = ${campaign}`;
      expect(audit.count).toBe(1);
    } finally {
      await sql.unsafe(`DROP TRIGGER fixture_audit_failure ON label_suite.audit_events`);
      await sql.unsafe(`DROP FUNCTION label_suite.fixture_audit_failure()`);
    }
  });
  it("reads bounded real options and exports numeric-version rich-content contract", async () => {
    const { getNativeCampaignSections } = await import("./campaign-sections");
    for (let n = 0; n < 30; n++) {
      await sql`insert into label_suite.email_templates (id, org_id, name, subject, body, source_version) values (${`${id}-template-${n}`}, ${org}, ${`Template ${n}`}, 'Fixture subject', 'Fixture body', 2)`;
      await sql`insert into label_suite.campaign_audiences (id, org_id, name) values (${`${id}-audience-${n}`}, ${org}, ${`Audience ${n}`})`;
    }
    await sql`update label_suite.campaigns set reviewed_template_id = ${`${id}-template-0`}, content_source_version = 2, campaign_audience_id = ${`${id}-audience-0`}, goal_document = ${sql.json({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Fixture rich text", marks: [{ type: "bold" }] }] }] })} where id = ${campaign}`;
    const result = await scoped({ userId: actor, orgId: org }, () => getNativeCampaignSections(org, campaign));
    expect(result.content.template_options.items).toHaveLength(25);
    expect(result.content.template_options.truncated).toBe(true);
    expect(result.audience.options.items).toHaveLength(25);
    expect(result.audience.options.truncated).toBe(true);
    expect(result.content.selection?.source_version).toBe(2);
    expect(result.content.rich_content.goal_document.available).toBe(true);
    if (process.env.NATIVE_SECTIONS_CONTRACT_OUTPUT) {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(process.env.NATIVE_SECTIONS_CONTRACT_OUTPUT, JSON.stringify(result, null, 2));
    }
    for (let n = 0; n < 30; n++) {
      await sql`insert into label_suite.contacts (id, org_id, name, email) values (${`${id}-contact-${n}`}, ${org}, ${`Fixture contact ${n}`}, ${`fixture-${n}@example.test`})`;
    }
    const sampled = await scoped({ userId: actor, orgId: org }, () => getNativeCampaignSections(org, campaign));
    expect(sampled.audience.selection?.counts.available).toBe(false);
    expect((sampled.audience.selection?.included_contacts.items.length ?? 0) + (sampled.audience.selection?.excluded_contacts.items.length ?? 0)).toBeLessThanOrEqual(26);
    await sql`update label_suite.campaigns set campaign_audience_id = null where id = ${campaign}`;
  });
  it("keeps dated options and recent activity ahead of undated rows in bounded reads", async () => {
    const { getNativeCampaignSections } = await import("./campaign-sections");
    const { getCampaignActivitySnapshot } = await import("./campaign-activity");
    await sql`update label_suite.email_templates set updated_at = null where org_id = ${org}`;
    await sql`update label_suite.campaign_audiences set updated_at = null where org_id = ${org}`;
    await sql`update label_suite.email_templates set updated_at = now() where id = ${`${id}-template-0`}`;
    await sql`update label_suite.campaign_audiences set updated_at = now() where id = ${`${id}-audience-0`}`;
    const sections = await scoped({ userId: actor, orgId: org }, () => getNativeCampaignSections(org, campaign));
    expect(sections.content.template_options.items[0]?.id).toBe(`${id}-template-0`);
    expect(sections.audience.options.items[0]?.id).toBe(`${id}-audience-0`);
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, linked_campaign_id, updated_at)
      select ${id} || '-task-' || n, ${org}, 'Undated', ${campaign}, null from generate_series(1, 101) n`;
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, linked_campaign_id, updated_at)
      values (${`${id}-recent`}, ${org}, 'Recent task', ${campaign}, now())`;
    const activity = await scoped({ userId: actor, orgId: org }, () => getCampaignActivitySnapshot(org, campaign, {}, { sourceLimit: 100 }));
    expect(activity.items.some((item) => item.title === 'Recent task')).toBe(true);
  });
  it("checks revision even when detaching an already-empty audience", async () => {
    await expect(scoped({ userId: actor, orgId: org }, () => mutate(org, campaign, { action: "detach_audience", expected_revision: 1 }, actor))).rejects.toMatchObject({ status: 409 });
  });
});
