import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const enabled = process.env.CAMPAIGN_OS_FOUNDATION_INTEGRATION === "1";

describe.skipIf(!enabled)("Campaign OS foundation on disposable PostgreSQL", () => {
  it("isolates all four tables for a non-owner role and enforces references and audit", async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)
      || decodeURIComponent(target.pathname) !== "/label_suite"
      || process.env.RELEASE_GATE_FIXTURE_DISPOSABLE !== "1") throw new Error("Disposable local label_suite database required");
    const sql = postgres(target.toString(), { max: 1 });
    const suffix = randomUUID().replaceAll("-", "");
    const org = `campaign-os-${suffix}`, foreignOrg = `campaign-os-foreign-${suffix}`;
    const actor = `campaign-os-user-${suffix}`, role = `campaign_os_test_${suffix}`;
    const campaign = `campaign-os-campaign-${suffix}`, foreignCampaign = `campaign-os-foreign-campaign-${suffix}`;
    const contact = `campaign-os-contact-${suffix}`, foreignContact = `campaign-os-foreign-contact-${suffix}`;
    const engagement = `campaign-os-engagement-${suffix}`, foreignEngagement = `campaign-os-foreign-engagement-${suffix}`;
    const records = [
      { table: "campaign_territories", own: `territory-${suffix}`, foreign: `foreign-territory-${suffix}`, update: "country_code = 'SE'" },
      { table: "campaign_creator_engagements", own: engagement, foreign: foreignEngagement, update: "relationship_notes = 'Reviewed'" },
      { table: "campaign_creator_deliverables", own: `deliverable-${suffix}`, foreign: `foreign-deliverable-${suffix}`, update: "notes = 'Reviewed'" },
      { table: "campaign_posts", own: `post-${suffix}`, foreign: `foreign-post-${suffix}`, update: "notes = 'Reviewed'" },
    ];
    const rollback = new Error("Rollback Campaign OS fixture");
    try {
      await expect(sql.begin(async (tx) => {
        await tx`insert into label_suite.orgs (id, name, slug) values (${org}, 'Campaign OS fixture', ${org}), (${foreignOrg}, 'Foreign fixture', ${foreignOrg})`;
        await tx`insert into label_suite."user" (id, name, email, "emailVerified") values (${actor}, 'Fixture operator', ${`${actor}@example.test`}, true)`;
        await tx`insert into label_suite.campaigns (id, org_id, campaign_name) values (${campaign}, ${org}, 'Local Campaign'), (${foreignCampaign}, ${foreignOrg}, 'Foreign Campaign')`;
        await tx`insert into label_suite.contacts (id, org_id, name) values (${contact}, ${org}, 'Local creator'), (${foreignContact}, ${foreignOrg}, 'Foreign creator')`;
        await tx`insert into label_suite.campaign_territories (id, org_id, campaign_id, country_code) values (${records[0].own}, ${org}, ${campaign}, 'DK'), (${records[0].foreign}, ${foreignOrg}, ${foreignCampaign}, 'DE')`;
        await tx`insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id) values (${engagement}, ${org}, ${campaign}, ${contact}), (${foreignEngagement}, ${foreignOrg}, ${foreignCampaign}, ${foreignContact})`;
        await tx`insert into label_suite.campaign_creator_deliverables (id, org_id, engagement_id, description) values (${records[2].own}, ${org}, ${engagement}, 'Local draft'), (${records[2].foreign}, ${foreignOrg}, ${foreignEngagement}, 'Foreign draft')`;
        await tx`insert into label_suite.campaign_posts (id, org_id, campaign_id, engagement_id, url, platform) values (${records[3].own}, ${org}, ${campaign}, ${engagement}, 'https://example.test/local', 'Instagram'), (${records[3].foreign}, ${foreignOrg}, ${foreignCampaign}, ${foreignEngagement}, 'https://example.test/foreign', 'Instagram')`;
        await tx.unsafe(`create role ${role} nologin nosuperuser nobypassrls`);
        await tx.unsafe(`grant usage on schema label_suite to ${role}`);
        await tx.unsafe(`grant select, insert, update, delete on ${records.map(({ table }) => `label_suite.${table}`).join(", ")} to ${role}`);
        await tx`select set_config('app.current_org_id', ${org}, true), set_config('app.current_user_id', ${actor}, true)`;
        await tx.unsafe(`set local role ${role}`);
        const [identity] = await tx`select current_user as name, rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
        expect(identity).toMatchObject({ name: role, rolsuper: false, rolbypassrls: false });
        for (const { table, own, foreign, update } of records) {
          expect(await tx.unsafe(`select id from label_suite.${table}`)).toEqual([{ id: own }]);
          expect(await tx.unsafe(`update label_suite.${table} set ${update} where id = $1 returning id`, [foreign])).toEqual([]);
          expect(await tx.unsafe(`delete from label_suite.${table} where id = $1 returning id`, [foreign])).toEqual([]);
          expect(await tx.unsafe(`update label_suite.${table} set ${update} where id = $1 returning id`, [own])).toEqual([{ id: own }]);
        }
        const foreignWrites = [
          ["insert into label_suite.campaign_territories (id, org_id, campaign_id, country_code) values ($1, $2, $3, 'SE')", [`blocked-territory-${suffix}`, foreignOrg, foreignCampaign]],
          ["insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id) values ($1, $2, $3, $4)", [`blocked-engagement-${suffix}`, foreignOrg, foreignCampaign, foreignContact]],
          ["insert into label_suite.campaign_creator_deliverables (id, org_id, engagement_id, description) values ($1, $2, $3, 'Blocked draft')", [`blocked-deliverable-${suffix}`, foreignOrg, foreignEngagement]],
          ["insert into label_suite.campaign_posts (id, org_id, campaign_id, engagement_id, url, platform) values ($1, $2, $3, $4, 'https://example.test/blocked', 'Instagram')", [`blocked-post-${suffix}`, foreignOrg, foreignCampaign, foreignEngagement]],
        ] as const;
        for (const [statement, values] of foreignWrites) {
          await expect(tx.savepoint((sp) => sp.unsafe(statement, [...values]))).rejects.toThrow(/row-level security/);
        }
        await tx.unsafe("reset role");
        const audits = await tx`select entity_type, entity_id, actor_user_id from label_suite.audit_logs where org_id = ${org} and action = 'update' and entity_type in ('campaign_territories', 'campaign_creator_engagements', 'campaign_creator_deliverables', 'campaign_posts') order by entity_type`;
        expect(audits).toEqual(records.map(({ table, own }) => ({ entity_type: table, entity_id: own, actor_user_id: actor })).sort((a, b) => a.entity_type.localeCompare(b.entity_type)));
        await expect(tx.savepoint((sp) => sp`update label_suite.campaign_territories set campaign_id = ${foreignCampaign} where id = ${records[0].own}`)).rejects.toThrow(/Cross-organization reference/);
        await expect(tx.savepoint((sp) => sp`update label_suite.campaign_creator_engagements set contact_id = ${foreignContact} where id = ${engagement}`)).rejects.toThrow(/Cross-organization reference/);
        await expect(tx.savepoint((sp) => sp`update label_suite.campaign_creator_deliverables set engagement_id = ${foreignEngagement} where id = ${records[2].own}`)).rejects.toThrow(/Cross-organization reference/);
        await expect(tx.savepoint((sp) => sp`update label_suite.campaign_posts set engagement_id = ${foreignEngagement} where id = ${records[3].own}`)).rejects.toThrow(/Cross-organization reference/);
        throw rollback;
      })).rejects.toBe(rollback);
    } finally {
      await sql.end();
    }
  }, 20_000);
});
