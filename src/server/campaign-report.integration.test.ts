import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.CAMPAIGN_REPORT_INTEGRATION === "1";
const suffix = randomUUID();
const orgId = `campaign-report-org-${suffix}`;
const actorId = `campaign-report-user-${suffix}`;
const campaignId = `campaign-report-${suffix}`;
let admin: Sql | undefined;
let finalize: typeof import("./campaign-os").finalizeCampaignReport;
let workspace: typeof import("./campaign-os").getCampaignOsWorkspace;
let scoped: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("Campaign report finalisation on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname)
      || decodeURIComponent(target.pathname) !== "/label_suite"
      || process.env.RELEASE_GATE_FIXTURE_DISPOSABLE !== "1") throw new Error("Disposable local label_suite database required");
    admin = postgres(target.toString(), { max: 2 });
    [{ finalizeCampaignReport: finalize, getCampaignOsWorkspace: workspace }, { runWithDatabaseContext: scoped }] = await Promise.all([import("./campaign-os"), import("../lib/db")]);
    await admin`insert into label_suite.orgs (id, name, slug) values (${orgId}, 'Campaign report fixture', ${orgId})`;
    await admin`insert into label_suite."user" (id, name, email, "emailVerified") values (${actorId}, 'Fixture operator', ${`${actorId}@example.test`}, true)`;
    await admin`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${suffix}, ${orgId}, ${actorId}, 'operator')`;
    await admin`insert into label_suite.campaigns (id, org_id, campaign_name) values (${campaignId}, ${orgId}, 'Fixture Campaign')`;
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from label_suite.campaigns where id = ${campaignId}`;
    await admin`delete from label_suite.audit_events where org_id = ${orgId}`;
    await admin`delete from label_suite.audit_logs where org_id = ${orgId}`;
    await admin`delete from label_suite.org_memberships where org_id = ${orgId}`;
    await admin`delete from label_suite."user" where id = ${actorId}`;
    await admin`delete from label_suite.orgs where id = ${orgId}`;
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
    expect(saved.final_report_snapshot).toMatchObject({ cost: { planned: 0, committed: 0, paid: 0 }, post_count: 0 });
    expect(saved.final_report_finalized_at).toBeTruthy();
    expect(saved.final_report_finalized_by).toBe(actorId);
    await expect(scoped({ userId: actorId, orgId }, () => workspace("another-org", campaignId))).rejects.toMatchObject({ status: 404 });
  });
});
