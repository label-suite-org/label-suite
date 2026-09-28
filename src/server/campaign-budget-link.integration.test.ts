import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.CAMPAIGN_BUDGET_INTEGRATION === "1";
const suffix = randomUUID();
const orgId = `campaign-budget-org-${suffix}`;
const otherOrgId = `campaign-budget-other-org-${suffix}`;
const actorId = `campaign-budget-user-${suffix}`;
const campaignId = `campaign-budget-${suffix}`;
const otherCampaignId = `campaign-budget-other-${suffix}`;
const foreignCampaignId = `campaign-budget-foreign-${suffix}`;
const contacts = [`campaign-budget-contact-1-${suffix}`, `campaign-budget-contact-2-${suffix}`];
const engagements = [`campaign-budget-engagement-1-${suffix}`, `campaign-budget-engagement-2-${suffix}`];
const otherEngagementId = `campaign-budget-other-engagement-${suffix}`;
const lines = { available: `campaign-budget-available-${suffix}`, otherLinked: `campaign-budget-other-linked-${suffix}`, rollback: `campaign-budget-rollback-${suffix}`, unrelated: `campaign-budget-unrelated-${suffix}`, otherCampaign: `campaign-budget-other-campaign-${suffix}`, foreign: `campaign-budget-foreign-line-${suffix}` };
let admin: Sql | undefined;
let scoped: typeof import("../lib/db").runWithDatabaseContext;
let route: typeof import("../pages/api/campaigns/[id]/os");

describe.skipIf(!enabled)("Campaign creator Budget links on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)
      || decodeURIComponent(target.pathname) !== "/label_suite"
      || process.env.RELEASE_GATE_FIXTURE_DISPOSABLE !== "1") throw new Error("Disposable local label_suite database required");
    admin = postgres(target.toString(), { max: 2 });
    [route, { runWithDatabaseContext: scoped }] = await Promise.all([import("../pages/api/campaigns/[id]/os"), import("../lib/db")]);
    await admin`insert into label_suite.orgs (id, name, slug) values (${orgId}, 'Budget fixture', ${orgId}), (${otherOrgId}, 'Other fixture', ${otherOrgId})`;
    await admin`insert into label_suite."user" (id, name, email, "emailVerified") values (${actorId}, 'Fixture operator', ${`${actorId}@example.test`}, true)`;
    await admin`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${suffix}, ${orgId}, ${actorId}, 'operator')`;
    await admin`insert into label_suite.campaigns (id, org_id, campaign_name) values (${campaignId}, ${orgId}, 'Creator Campaign'), (${otherCampaignId}, ${orgId}, 'Other Campaign'), (${foreignCampaignId}, ${otherOrgId}, 'Foreign Campaign')`;
    await admin`insert into label_suite.contacts (id, org_id, name) values (${contacts[0]}, ${orgId}, 'Creator One'), (${contacts[1]}, ${orgId}, 'Creator Two')`;
    await admin`insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id) values (${engagements[0]}, ${orgId}, ${campaignId}, ${contacts[0]}), (${engagements[1]}, ${orgId}, ${campaignId}, ${contacts[1]})`;
    await admin`insert into label_suite.budget_line_items (id, org_id, campaign_id, name, amount, planned_amount, committed_amount, paid_amount) values
      (${lines.available}, ${orgId}, null, 'Creator fee', 100, 100, 60, 25),
      (${lines.otherLinked}, ${orgId}, null, 'Legacy cross-Campaign link', 77, 77, 0, 0),
      (${lines.rollback}, ${orgId}, null, 'Rollback candidate', 55, 55, 0, 0),
      (${lines.unrelated}, ${orgId}, ${campaignId}, 'Unlinked Campaign cost', 40, 40, 20, 10),
      (${lines.otherCampaign}, ${orgId}, ${otherCampaignId}, 'Other Campaign cost', 900, 900, 300, 100),
      (${lines.foreign}, ${otherOrgId}, ${foreignCampaignId}, 'Foreign cost', 800, 800, 500, 200)`;
    await admin`insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id, budget_line_id) values (${otherEngagementId}, ${orgId}, ${otherCampaignId}, ${contacts[0]}, ${lines.otherLinked})`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from label_suite.budget_line_items where org_id in (${orgId}, ${otherOrgId})`;
    await admin`delete from label_suite.campaigns where org_id in (${orgId}, ${otherOrgId})`;
    await admin`delete from label_suite.contacts where org_id = ${orgId}`;
    await admin`delete from label_suite.audit_events where org_id in (${orgId}, ${otherOrgId})`;
    await admin`delete from label_suite.audit_logs where org_id in (${orgId}, ${otherOrgId})`;
    await admin`delete from label_suite.org_memberships where org_id = ${orgId}`;
    await admin`delete from label_suite."user" where id = ${actorId}`;
    await admin`delete from label_suite.orgs where id in (${orgId}, ${otherOrgId})`;
    await admin.end();
  });

  const post = (role: string, engagementId: string, budgetLineId: string | null) => scoped({ userId: actorId, orgId }, async () => route.POST({
    request: new Request(`https://labels.example/api/campaigns/${campaignId}/os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_engagement", input: { id: engagementId, budget_line_id: budgetLineId } }) }),
    params: { id: campaignId }, locals: { orgId, membershipRole: role, user: { id: actorId } },
  } as never));
  const get = () => scoped({ userId: actorId, orgId }, async () => (await route.GET({ params: { id: campaignId }, locals: { orgId } } as never)).json());

  it("claims only same-workspace available lines, counts distinct links, and preserves Budget paid evidence after unlink", async () => {
    const initial = await get();
    expect(initial.cost).toEqual({ planned: 0, committed: 0, paid: 0 });
    expect(initial.budgetLineOptions.map((line: { id: string }) => line.id)).toEqual([lines.available, lines.rollback, lines.unrelated]);
    expect((await post("member", engagements[0], lines.available)).status).toBe(403);
    expect((await post("fundraiser", engagements[0], lines.available)).status).toBe(403);
    expect((await post("operator", engagements[0], lines.otherCampaign)).status).toBe(404);
    expect((await post("operator", engagements[0], lines.otherLinked)).status).toBe(404);
    expect((await post("operator", engagements[0], lines.foreign)).status).toBe(404);
    const [rls] = await admin!`select c.relrowsecurity as enabled, exists(select 1 from pg_policies p where p.schemaname = 'label_suite' and p.tablename = 'budget_line_items' and p.policyname = 'tenant_isolation') as policy from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'label_suite' and c.relname = 'budget_line_items'`;
    expect(rls).toMatchObject({ enabled: true, policy: true });
    await expect(admin!`update label_suite.campaign_creator_engagements set budget_line_id = ${lines.foreign} where id = ${engagements[0]}`).rejects.toThrow();
    const { createCampaignEngagement, createCampaignEngagementSchema } = await import("./campaign-os");
    await expect(scoped({ userId: actorId, orgId }, () => createCampaignEngagement(orgId, campaignId, createCampaignEngagementSchema.parse({ id: engagements[0], contact_id: contacts[0], budget_line_id: lines.rollback })))).rejects.toThrow();
    expect((await admin!`select campaign_id from label_suite.budget_line_items where id = ${lines.rollback}`)[0].campaign_id).toBeNull();
    expect((await post("operator", engagements[0], lines.available)).status).toBe(200);
    const linked = await get();
    expect(linked.cost).toEqual({ planned: 100, committed: 60, paid: 25 });
    expect(linked.budgetLines.map((line: { id: string }) => line.id)).toEqual([lines.available]);
    expect((await post("operator", engagements[1], lines.available)).status).toBe(200);
    expect((await get()).cost).toEqual({ planned: 100, committed: 60, paid: 25 });
    const [audit] = await admin!`select count(*)::int as count, max(actor_user_id) as actor from label_suite.audit_logs where org_id = ${orgId} and entity_type = 'campaign_creator_engagements' and entity_id = ${engagements[0]} and action = 'update'`;
    expect(audit).toMatchObject({ count: 1, actor: actorId });
    expect((await post("operator", engagements[0], null)).status).toBe(200);
    expect((await get()).cost).toEqual({ planned: 100, committed: 60, paid: 25 });
    expect((await post("operator", engagements[1], null)).status).toBe(200);
    expect((await get()).cost).toEqual({ planned: 0, committed: 0, paid: 0 });
    const [line] = await admin!`select campaign_id, paid_amount, status from label_suite.budget_line_items where id = ${lines.available}`;
    expect(line).toMatchObject({ campaign_id: campaignId, paid_amount: 25, status: "pending" });
  });
});
