import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

process.env.DATABASE_URL ??= "postgres://label_suite:label_suite@127.0.0.1:55432/label_suite";

import { GET, PATCH } from "../pages/api/campaigns/[id]/activity";

const enabled = process.env.CAMPAIGN_ACTIVITY_INTEGRATION === "1";

describe.skipIf(!enabled)("campaign activity API PostgreSQL integration", () => {
  const prefix = `campaign_activity_route_${Date.now()}`;
  const orgId = `${prefix}_org`;
  const campaignId = `${prefix}_campaign`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  beforeAll(async () => {
    await pool.query("insert into label_suite.orgs (id,name,slug) values ($1,$2,$3)", [orgId, "Campaign activity route integration", `${prefix}-org`]);
    await pool.query("insert into label_suite.campaigns (id,org_id,campaign_name) values ($1,$2,$3)", [campaignId, orgId, "Activity route campaign"]);
  });

  afterAll(async () => {
    await pool.query("delete from label_suite.campaigns where id=$1", [campaignId]);
    await pool.query("delete from label_suite.audit_logs where org_id=$1", [orgId]);
    await pool.query("delete from label_suite.orgs where id=$1", [orgId]);
    await pool.end();
  });

  const locals = { orgId, membershipRole: "operator", user: { id: "integration-user" } };

  it("returns 404 for unknown and cross-tenant campaign paths", async () => {
    const unknown = await GET!({ locals, params: { id: `${prefix}_missing` } } as never);
    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "Campaign not found" });

    const crossTenant = await GET!({ locals: { ...locals, orgId: `${prefix}_other_org` }, params: { id: campaignId } } as never);
    expect(crossTenant.status).toBe(404);
    await expect(crossTenant.json()).resolves.toEqual({ error: "Campaign not found" });
  });

  it("checks campaign existence on PATCH before proposal derivation", async () => {
    const response = await PATCH!({
      locals,
      params: { id: `${prefix}_missing` },
      request: new Request("https://suite.test/activity", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposal_key: "stale", decision: "resolved", reason: null }),
      }),
    } as never);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Campaign not found" });
  });
});
