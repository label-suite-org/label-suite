import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

process.env.DATABASE_URL ??= "postgres://label_suite:label_suite@127.0.0.1:55432/label_suite";

import {
  getCampaignActivitySnapshot,
} from "./campaign-activity";

const enabled = process.env.CAMPAIGN_ACTIVITY_INTEGRATION === "1";

describe.skipIf(!enabled)("campaign activity PostgreSQL integration", () => {
  const prefix = `campaign_activity_${Date.now()}`;
  const orgId = `${prefix}_org`;
  const otherOrgId = `${prefix}_other_org`;
  const campaignId = `${prefix}_campaign`;
  const otherOrgCampaignId = `${prefix}_other_campaign`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await pool.query("insert into label_suite.orgs (id,name,slug) values ($1,$2,$3),($4,$5,$6)", [
      orgId, "Campaign activity integration", `${prefix}-org`, otherOrgId, "Other activity integration", `${prefix}-other-org`,
    ]);
    await pool.query("insert into label_suite.campaigns (id,org_id,campaign_name) values ($1,$2,$3),($4,$5,$6)", [
      campaignId, orgId, "Activity campaign", otherOrgCampaignId, otherOrgId, "Other campaign",
    ]);
  });

  afterAll(async () => {
    await pool.query("delete from label_suite.campaigns where id in ($1,$2)", [campaignId, otherOrgCampaignId]);
    await pool.query("delete from label_suite.audit_logs where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.orgs where id in ($1,$2)", [orgId, otherOrgId]);
    await pool.end();
  });

  it("enforces tenant-scoped campaign existence before loading production sources", async () => {
    await expect(getCampaignActivitySnapshot(orgId, `${prefix}_missing`)).rejects.toMatchObject({
      status: 404,
      message: "Campaign not found",
    });
    await expect(getCampaignActivitySnapshot(orgId, otherOrgCampaignId)).rejects.toMatchObject({
      status: 404,
      message: "Campaign not found",
    });
    await expect(getCampaignActivitySnapshot(orgId, campaignId)).resolves.toMatchObject({
      items: expect.any(Array),
      sourceStates: expect.any(Array),
    });
  });
});
