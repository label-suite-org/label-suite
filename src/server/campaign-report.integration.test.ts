import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.CAMPAIGN_REPORT_INTEGRATION === "1";
const suffix = randomUUID();
const orgId = `campaign-report-org-${suffix}`;
const foreignOrgId = `campaign-report-foreign-org-${suffix}`;
const actorId = `campaign-report-user-${suffix}`;
const campaignId = `campaign-report-${suffix}`;
const otherCampaignId = `campaign-report-other-${suffix}`;
const artistId = `campaign-report-artist-${suffix}`;
const releaseId = `campaign-report-release-${suffix}`;
const contactId = `campaign-report-contact-${suffix}`;
const otherContactId = `campaign-report-other-contact-${suffix}`;
const foreignContactId = `campaign-report-foreign-contact-${suffix}`;
const engagementId = `campaign-report-engagement-${suffix}`;
let admin: Sql | undefined;
let finalize: typeof import("./campaign-os").finalizeCampaignReport;
let workspace: typeof import("./campaign-os").getCampaignOsWorkspace;
let scoped: typeof import("../lib/db").runWithDatabaseContext;
let route: typeof import("../pages/api/campaigns/[id]/os");

describe.skipIf(!enabled)("Campaign report finalisation on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)
      || decodeURIComponent(target.pathname) !== "/label_suite"
      || process.env.RELEASE_GATE_FIXTURE_DISPOSABLE !== "1") throw new Error("Disposable local label_suite database required");
    admin = postgres(target.toString(), { max: 2 });
    [{ finalizeCampaignReport: finalize, getCampaignOsWorkspace: workspace }, { runWithDatabaseContext: scoped }, route] = await Promise.all([import("./campaign-os"), import("../lib/db"), import("../pages/api/campaigns/[id]/os")]);
    await admin`insert into label_suite.orgs (id, name, slug) values (${orgId}, 'Campaign report fixture', ${orgId}), (${foreignOrgId}, 'Foreign fixture', ${foreignOrgId})`;
    await admin`insert into label_suite."user" (id, name, email, "emailVerified") values (${actorId}, 'Fixture operator', ${`${actorId}@example.test`}, true)`;
    await admin`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${suffix}, ${orgId}, ${actorId}, 'operator')`;
    await admin`insert into label_suite.artists (id, org_id, name) values (${artistId}, ${orgId}, 'Original Artist')`;
    await admin`insert into label_suite.releases (id, org_id, title, artist_id) values (${releaseId}, ${orgId}, 'Original Release', ${artistId})`;
    await admin`insert into label_suite.campaigns (id, org_id, campaign_name, linked_artist_id, linked_release_id, start_date, end_date, brief, goal, notes)
      values (${campaignId}, ${orgId}, 'Original Campaign', ${artistId}, ${releaseId}, '2026-09-01', '2026-09-30', 'Original brief', 'Original goal', 'Original notes'),
      (${otherCampaignId}, ${orgId}, 'Other Campaign', ${artistId}, ${releaseId}, null, null, null, null, null)`;
    await admin`insert into label_suite.campaign_territories (id, org_id, campaign_id, country_code) values (${`territory-${suffix}`}, ${orgId}, ${campaignId}, 'DK')`;
    await admin`insert into label_suite.contacts (id, org_id, name) values (${contactId}, ${orgId}, 'Fixture creator'), (${otherContactId}, ${orgId}, 'Other fixture creator'), (${foreignContactId}, ${foreignOrgId}, 'Foreign creator')`;
    await admin`insert into label_suite.campaign_creator_engagements (id, org_id, campaign_id, contact_id) values (${engagementId}, ${orgId}, ${otherCampaignId}, ${contactId})`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from label_suite.campaigns where id in (${campaignId}, ${otherCampaignId})`;
    await admin`delete from label_suite.contacts where id in (${contactId}, ${otherContactId}, ${foreignContactId})`;
    await admin`delete from label_suite.releases where id = ${releaseId}`;
    await admin`delete from label_suite.artists where id = ${artistId}`;
    await admin`delete from label_suite.audit_events where org_id in (${orgId}, ${foreignOrgId})`;
    await admin`delete from label_suite.audit_logs where org_id in (${orgId}, ${foreignOrgId})`;
    await admin`delete from label_suite.org_memberships where org_id = ${orgId}`;
    await admin`delete from label_suite."user" where id = ${actorId}`;
    await admin`delete from label_suite.orgs where id in (${orgId}, ${foreignOrgId})`;
    await admin.end();
  });

  it("keeps one immutable snapshot when two request-scoped finalisations race", async () => {
    const run = (narrative: string) => scoped({ userId: actorId, orgId }, () => finalize(orgId, campaignId, narrative, actorId), { isolationLevel: "repeatable read" });
    const results = await Promise.allSettled([run("First candidate"), run("Second candidate")]);
    const winners = results.filter((result) => result.status === "fulfilled");
    const losers = results.filter((result) => result.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect((losers[0] as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    const [saved] = await admin!`select final_report, final_report_snapshot, final_report_finalized_at, final_report_finalized_by from label_suite.campaigns where id = ${campaignId}`;
    expect(saved.final_report).toBe(results[0].status === "fulfilled" ? "First candidate" : "Second candidate");
    expect(saved.final_report_snapshot).toMatchObject({
      campaign: { id: campaignId, name: "Original Campaign", artist_id: artistId, artist_name: "Original Artist", release_id: releaseId, release_title: "Original Release", start_date: "2026-09-01", end_date: "2026-09-30", territories: ["DK"], brief: "Original brief", goal: "Original goal", notes: "Original notes" },
      cost: { planned: 0, committed: 0, paid: 0 }, post_count: 0,
    });
    expect(saved.final_report_finalized_at).toBeTruthy();
    expect(saved.final_report_finalized_by).toBe(actorId);
    await admin!`update label_suite.campaigns set campaign_name = 'Revised Campaign', brief = 'Later brief', notes = 'Later notes' where id = ${campaignId}`;
    await admin!`update label_suite.artists set name = 'Revised Artist' where id = ${artistId}`;
    await admin!`update label_suite.releases set title = 'Revised Release' where id = ${releaseId}`;
    await admin!`update label_suite.campaign_territories set country_code = 'DE' where campaign_id = ${campaignId}`;
    const later = await scoped({ userId: actorId, orgId }, () => workspace(orgId, campaignId));
    expect(later.report.snapshot).toMatchObject({ campaign: { name: "Original Campaign", artist_name: "Original Artist", release_title: "Original Release", territories: ["DK"], brief: "Original brief", notes: "Original notes" } });
    expect(later.campaign).toMatchObject({ name: "Revised Campaign", artist_name: "Revised Artist", release_title: "Revised Release", territories: ["DE"], brief: "Later brief", notes: "Later notes" });
    await expect(scoped({ userId: actorId, orgId }, () => workspace("another-org", campaignId))).rejects.toMatchObject({ status: 404 });
  });

  it("rejects wrong-workspace and cross-Campaign post references without contacting a provider", async () => {
    const fetch = vi.fn(() => { throw new Error("External provider call is forbidden"); });
    vi.stubGlobal("fetch", fetch);
    const post = (targetOrg: string, targetCampaign: string, role: string, engagement: string | null) => scoped({ userId: actorId, orgId: targetOrg }, async () => route.POST({
      request: new Request(`https://suite.test/api/campaigns/${targetCampaign}/os`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_post", input: { url: "https://example.test/post", platform: "Instagram", published_at: "2026-09-28T00:00:00.000Z", metrics_captured_at: "2026-09-29T00:00:00.000Z", engagement_id: engagement, manual_metrics: { views: 120 }, notes: "Manual screenshot" } }) }),
      params: { id: targetCampaign }, locals: { orgId: targetOrg, membershipRole: role, user: { id: actorId } },
    } as never));
    expect((await post(orgId, campaignId, "member", null)).status).toBe(403);
    expect((await post("another-org", campaignId, "operator", null)).status).toBe(404);
    expect((await post(orgId, campaignId, "operator", engagementId)).status).toBe(404);
    expect((await post(orgId, campaignId, "operator", null)).status).toBe(201);
    const [saved] = await admin!`select count(*)::int as count, max(metrics_captured_at) as captured_at from label_suite.campaign_posts where campaign_id = ${campaignId}`;
    expect(saved.count).toBe(1);
    expect(saved.captured_at).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("requires fresh Contact and channel permission before contact and after revocation", async () => {
    const fetch = vi.fn(() => { throw new Error("Campaign OS must not send outreach"); });
    vi.stubGlobal("fetch", fetch);
    const command = (role: string, action: string, input: Record<string, unknown>) => scoped({ userId: actorId, orgId }, async () => route.POST({
      request: new Request(`https://suite.test/api/campaigns/${campaignId}/os`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, input }) }),
      params: { id: campaignId }, locals: { orgId, membershipRole: role, user: { id: actorId } },
    } as never));
    try {
      expect((await command("operator", "create_engagement", { contact_id: foreignContactId })).status).toBe(404);
      expect((await command("operator", "update_engagement", { id: engagementId, status: "contacted" })).status).toBe(404);
      const created = await command("operator", "create_engagement", { contact_id: contactId, outreach_channel: "email", relationship_notes: "Known from the release" });
      expect(created.status).toBe(201);
      const { id } = await created.json();
      const update = (input: Record<string, unknown>) => command("operator", "update_engagement", { id, ...input });
      expect((await update({ status: "contacted" })).status).toBe(409);
      expect((await update({ outreach_permission_status: "permitted" })).status).toBe(409);
      expect((await update({ outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in" })).status).toBe(409);
      expect((await command("member", "update_engagement", { id, outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z" })).status).toBe(403);
      expect((await update({ outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z" })).status).toBe(200);
      expect((await update({ status: "contacted" })).status).toBe(200);
      expect((await update({ outreach_channel: "DM" })).status).toBe(409);
      expect((await update({ outreach_channel: "DM", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z" })).status).toBe(409);
      expect((await update({ contact_id: otherContactId })).status).toBe(409);
      expect((await update({ outreach_permission_status: "revoked" })).status).toBe(409);
      expect((await update({ outreach_permission_status: "revoked", outreach_permission_revoked_at: "2026-09-28T11:00:00.000Z" })).status).toBe(200);
      expect((await update({ status: "negotiating" })).status).toBe(409);
      expect((await update({ outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z", outreach_permission_revoked_at: null })).status).toBe(409);
      expect((await update({ contact_id: otherContactId, outreach_channel: "DM" })).status).toBe(409);
      expect((await update({ contact_id: otherContactId, outreach_channel: "DM", outreach_permission_status: "permitted", outreach_permission_basis: "Other creator opted in to DM", outreach_permission_recorded_at: "2026-09-28T12:00:00.000Z", outreach_permission_revoked_at: null })).status).toBe(200);
      const [saved] = await admin!`select contact_id, status, outreach_channel, outreach_permission_status, outreach_permission_basis, to_char(outreach_permission_recorded_at, 'YYYY-MM-DD HH24:MI:SS') as recorded_at_text, outreach_permission_revoked_at from label_suite.campaign_creator_engagements where id = ${id}`;
      expect(saved).toMatchObject({ contact_id: otherContactId, status: "contacted", outreach_channel: "DM", outreach_permission_status: "permitted", outreach_permission_basis: "Other creator opted in to DM", outreach_permission_revoked_at: null });
      expect(saved.recorded_at_text).toBe("2026-09-28 12:00:00");
      const loaded = await scoped({ userId: actorId, orgId }, async () => route.GET({ params: { id: campaignId }, locals: { orgId } } as never));
      expect((await loaded.json()).engagements.find((item: { id: string }) => item.id === id).outreach_permission_recorded_at).toBe("2026-09-28T12:00:00.000Z");
      const [audit] = await admin!`select count(*)::int as count, min(actor_user_id) as actor from label_suite.audit_logs where org_id = ${orgId} and entity_type = 'campaign_creator_engagements' and entity_id = ${id} and action = 'update'`;
      expect(audit).toMatchObject({ count: 4, actor: actorId });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
