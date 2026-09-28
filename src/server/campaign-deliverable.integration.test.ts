import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.CAMPAIGN_DELIVERABLE_INTEGRATION === "1";
const suffix = randomUUID();
const orgId = `campaign-deliverable-org-${suffix}`;
const actorId = `campaign-deliverable-user-${suffix}`;
const campaignId = `campaign-deliverable-${suffix}`;
const otherCampaignId = `campaign-deliverable-other-${suffix}`;
const contactId = `campaign-deliverable-contact-${suffix}`;
const engagementId = `campaign-deliverable-engagement-${suffix}`;
const deliverableId = `campaign-deliverable-item-${suffix}`;
let admin: Sql | undefined;
let scoped: typeof import("../lib/db").runWithDatabaseContext;
let route: typeof import("../pages/api/campaigns/[id]/os");

describe.skipIf(!enabled)("Campaign deliverable updates on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)
      || decodeURIComponent(target.pathname) !== "/label_suite"
      || process.env.RELEASE_GATE_FIXTURE_DISPOSABLE !== "1") throw new Error("Disposable local label_suite database required");
    admin = postgres(target.toString(), { max: 2 });
    [route, { runWithDatabaseContext: scoped }] = await Promise.all([import("../pages/api/campaigns/[id]/os"), import("../lib/db")]);
    await admin`insert into label_suite.orgs (id, name, slug) values (${orgId}, 'Deliverable fixture', ${orgId})`;
    await admin`insert into label_suite."user" (id, name, email, "emailVerified") values (${actorId}, 'Fixture operator', ${`${actorId}@example.test`}, true)`;
    await admin`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${suffix}, ${orgId}, ${actorId}, 'operator')`;
    await admin`insert into label_suite.campaigns (id, org_id, campaign_name) values (${campaignId}, ${orgId}, 'Fixture Campaign'), (${otherCampaignId}, ${orgId}, 'Other Campaign')`;
    await admin`insert into label_suite.contacts (id, org_id, name) values (${contactId}, ${orgId}, 'Fixture creator')`;
    await admin`insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id) values (${engagementId}, ${orgId}, ${campaignId}, ${contactId})`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from label_suite.campaigns where id in (${campaignId}, ${otherCampaignId})`;
    await admin`delete from label_suite.contacts where id = ${contactId}`;
    await admin`delete from label_suite.audit_events where org_id = ${orgId}`;
    await admin`delete from label_suite.audit_logs where org_id = ${orgId}`;
    await admin`delete from label_suite.org_memberships where org_id = ${orgId}`;
    await admin`delete from label_suite."user" where id = ${actorId}`;
    await admin`delete from label_suite.orgs where id = ${orgId}`;
    await admin.end();
  });

  const post = (targetCampaign: string, role: string, action: string, input: unknown, targetOrg = orgId) => scoped({ userId: actorId, orgId: targetOrg }, async () => route.POST({
    request: new Request(`https://labels.example/api/campaigns/${targetCampaign}/os`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) }),
    params: { id: targetCampaign }, locals: { orgId: targetOrg, membershipRole: role, user: { id: actorId } },
  } as never));
  const get = () => scoped({ userId: actorId, orgId }, async () => route.GET({ params: { id: campaignId }, locals: { orgId } } as never));

  it("checks capability and campaign ownership, persists partial evidence/approval updates, and audits only successful writes", async () => {
    expect((await post(campaignId, "operator", "create_deliverable", { id: deliverableId, engagement_id: engagementId, description: "Launch video", due_date: "2026-10-01T00:00:00.000Z", notes: "First cut" })).status).toBe(201);
    const loaded = await (await get()).json();
    const revision = loaded.deliverables[0].updated_at;
    const update = { id: deliverableId, expected_updated_at: revision, approval_status: "approved", evidence_url: "https://example.test/final" };
    expect((await post(campaignId, "member", "update_deliverable", update)).status).toBe(403);
    expect((await post(otherCampaignId, "operator", "update_deliverable", update)).status).toBe(404);
    expect((await post(campaignId, "operator", "update_deliverable", update, "another-org")).status).toBe(404);
    expect((await post(campaignId, "operator", "update_deliverable", update)).status).toBe(200);
    const [saved] = await admin!`select description, due_date, approval_status, evidence_url, notes from label_suite.campaign_creator_deliverables where id = ${deliverableId}`;
    expect(saved).toMatchObject({ description: "Launch video", approval_status: "approved", evidence_url: "https://example.test/final", notes: "First cut" });
    expect(saved.due_date).toBeTruthy();
    expect((await post(campaignId, "operator", "update_deliverable", update)).status).toBe(409);
    const [audit] = await admin!`select count(*)::int as count, max(actor_user_id) as actor from label_suite.audit_logs where org_id = ${orgId} and entity_type = 'campaign_creator_deliverables' and entity_id = ${deliverableId} and action = 'update'`;
    expect(audit).toMatchObject({ count: 1, actor: actorId });
    const refreshed = await (await get()).json();
    expect((await post(campaignId, "operator", "update_deliverable", { id: deliverableId, expected_updated_at: refreshed.deliverables[0].updated_at, due_date: "2026-10-02T00:00:00.000Z", notes: "Approved cut" })).status).toBe(200);
    const [revised] = await admin!`select to_char(due_date, 'YYYY-MM-DD HH24:MI:SS') as due_date, approval_status, evidence_url, notes from label_suite.campaign_creator_deliverables where id = ${deliverableId}`;
    expect(revised).toMatchObject({ approval_status: "approved", evidence_url: "https://example.test/final", notes: "Approved cut" });
    expect(revised.due_date).toBe("2026-10-02 00:00:00");
    expect((await (await get()).json()).deliverables[0].due_date).toBe("2026-10-02T00:00:00.000Z");
  });
});
