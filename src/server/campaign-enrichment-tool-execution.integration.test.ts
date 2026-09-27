import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { executeCampaignEnrichmentTool } from "./campaign-enrichment-tool-execution";
import { executeOperatorDiagnostics } from "./operator-diagnostics-execution";

const enabled = process.env.CAMPAIGN_ENRICHMENT_TOOL_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";

describe.skipIf(!enabled)("Campaign Enrichment Tool PostgreSQL interface", () => {
  const prefix = `campaign_tool_${Date.now()}`;
  const orgId = `${prefix}_org`;
  const otherOrgId = `${prefix}_other_org`;
  const userId = `${prefix}_user`;
  const campaignId = `${prefix}_campaign`;
  const otherCampaignId = `${prefix}_other_campaign`;
  const releaseId = `${prefix}_release`;
  const otherReleaseId = `${prefix}_other_release`;
  const leadId = `${prefix}_lead`;
  const otherLeadId = `${prefix}_other_lead`;
  const tokenId = `${prefix.replaceAll("_", "-")}-token`;
  const readOnlyTokenId = `${prefix.replaceAll("_", "-")}-read-token`;
  const token = `lsmcp_${tokenId}_${"a".repeat(43)}`;
  const readOnlyToken = `lsmcp_${readOnlyTokenId}_${"b".repeat(43)}`;
  let pool: Pool;
  const telemetry = vi.spyOn(console, "info").mockImplementation(() => undefined);

  beforeAll(async () => {
    assertDisposableIntegrationTarget(process.env, databaseUrl);
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      `insert into label_suite."user" (id,name,email,"emailVerified") values ($1,$2,$3,true)`,
      [userId, "Campaign tool integration", `${prefix}@example.test`],
    );
    await pool.query(
      `insert into label_suite.orgs (id,name,slug) values ($1,$2,$3),($4,$5,$6)`,
      [orgId, "Campaign tool integration", `${prefix}-org`, otherOrgId, "Other campaign tool tenant", `${prefix}-other-org`],
    );
    await pool.query(
      `insert into label_suite.org_memberships (id,org_id,user_id,role) values ($1,$2,$3,'operator')`,
      [`${prefix}_membership`, orgId, userId],
    );
    await pool.query(
      `insert into label_suite.campaigns (id,org_id,campaign_name) values ($1,$2,$3),($4,$5,$6)`,
      [campaignId, orgId, "Campaign tool campaign", otherCampaignId, otherOrgId, "Other tenant campaign"],
    );
    await pool.query(
      `insert into label_suite.releases (id,org_id,title,release_missing,release_ready)
       values ($1,$2,$3,$4,false),($5,$6,$7,$8,false)`,
      [releaseId, orgId, "Operator release", "UPC/EAN", otherReleaseId, otherOrgId, "Other tenant release", "cover"],
    );
    await pool.query(
      `insert into label_suite.campaign_leads
        (id,org_id,campaign_id,dedupe_key,target_name,target_type,discovery_source)
       values ($1,$2,$3,$4,$5,'radio_show','integration'),($6,$7,$8,$9,$10,'radio_show','integration')`,
      [
        leadId,
        orgId,
        campaignId,
        `${prefix}_lead_key`,
        "Campaign tool lead",
        otherLeadId,
        otherOrgId,
        otherCampaignId,
        `${prefix}_other_lead_key`,
        "Other tenant lead",
      ],
    );
    await pool.query(
      `insert into label_suite.local_tool_tokens
        (id,org_id,user_id,name,token_prefix,secret_hash,scopes,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,now() + interval '1 day'),
              ($8,$2,$3,$9,$10,$11,$12::jsonb,now() + interval '1 day')`,
      [
        tokenId,
        orgId,
        userId,
        "Campaign tool integration",
        `lsmcp_${tokenId}`,
        createHash("sha256").update(token).digest("hex"),
        JSON.stringify(["campaign.enrichment.read", "campaign.enrichment.claim", "campaign.enrichment.propose", "operator.diagnostics.read"]),
        readOnlyTokenId,
        "Campaign tool read only",
        `lsmcp_${readOnlyTokenId}`,
        createHash("sha256").update(readOnlyToken).digest("hex"),
        JSON.stringify(["campaign.enrichment.read"]),
      ],
    );
  }, 30_000);

  afterAll(async () => {
    telemetry.mockRestore();
    await pool.query("delete from label_suite.campaign_outreach_events where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.campaign_enrichment_suggestions where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.campaign_enrichment_runs where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.campaign_enrichment_claims where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.local_tool_tokens where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.releases where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.campaigns where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.org_memberships where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.audit_logs where org_id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query("delete from label_suite.orgs where id in ($1,$2)", [orgId, otherOrgId]);
    await pool.query(`delete from label_suite."user" where id=$1`, [userId]);
    await pool.end();
  }, 30_000);

  it("attributes auth failures before parsing and hides another tenant's lead", async () => {
    const malformed = authenticatedRequest(
      `/api/local-tools/v1/campaign-enrichment/items/${leadId}/proposals`,
      readOnlyToken,
      { method: "POST", body: "{" },
    );
    const forbidden = await executeCampaignEnrichmentTool(malformed, {
      kind: "submit_proposal",
      itemId: leadId,
    });

    expect(forbidden.status).toBe(403);
    expect(telemetry.mock.calls.map(([event]) => JSON.parse(String(event)))).toEqual(expect.arrayContaining([
      expect.objectContaining({
        tool: "submit_enrichment_proposal",
        operation: "authenticate",
        result_category: "scope_forbidden",
      }),
    ]));

    const crossTenant = authenticatedRequest(
      `/api/local-tools/v1/campaign-enrichment/items/${otherLeadId}`,
      token,
    );
    const hidden = await executeCampaignEnrichmentTool(crossTenant, {
      kind: "get_item",
      itemId: otherLeadId,
    });

    expect(hidden.status).toBe(404);
    await expect(hidden.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    const audit = await pool.query(
      `select action,metadata from label_suite.audit_logs where org_id=$1 and action='local_tool.item_get'`,
      [orgId],
    );
    expect(audit.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ metadata: expect.objectContaining({ result_category: "not_found" }) }),
    ]));
  });

  it("persists only proposal records for a valid authenticated submission", async () => {
    const itemRequest = authenticatedRequest(`/api/local-tools/v1/campaign-enrichment/items/${leadId}`, token);
    const itemResponse = await executeCampaignEnrichmentTool(itemRequest, { kind: "get_item", itemId: leadId });
    expect(itemResponse.status).toBe(200);
    const item = (await itemResponse.json()).data;
    const beforeLead = await loadLead();

    const claimRequest = authenticatedRequest(
      `/api/local-tools/v1/campaign-enrichment/items/${leadId}/claim`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ expected_lead_revision: item.lead_revision, lease_minutes: 20 }),
      },
    );
    const claimResponse = await executeCampaignEnrichmentTool(claimRequest, { kind: "claim_item", itemId: leadId });
    const claim = (await claimResponse.json()).data;

    const proposalRequest = authenticatedRequest(
      `/api/local-tools/v1/campaign-enrichment/items/${leadId}/proposals`,
      token,
      {
        method: "POST",
        body: JSON.stringify({
          claim_id: claim.id,
          expected_lead_revision: item.lead_revision,
          idempotency_key: "018f47be-19f1-7a52-b9d8-30fcd2f54a44",
          proposals: [{
            field: "musical_fit",
            value: "Compatible specialist programming",
            rationale: "The cited archive documents compatible programming.",
            evidence: [{
              title: "Programme archive",
              url: "https://example.com/programme",
              retrieved_at: "2026-08-12T12:00:00.000Z",
              citation_text: "The archive lists compatible specialist programming.",
            }],
          }],
          client: { name: "label-suite-codex", version: "0.1.0", session_label: "integration" },
        }),
      },
    );
    const response = await executeCampaignEnrichmentTool(proposalRequest, {
      kind: "submit_proposal",
      itemId: leadId,
    });

    expect(response.status).toBe(201);
    expect(await loadLead()).toEqual(beforeLead);
    const persisted = await pool.query(
      `select
         (select count(*)::int from label_suite.campaign_enrichment_runs where org_id=$1 and lead_id=$2) as runs,
         (select count(*)::int from label_suite.campaign_enrichment_suggestions where org_id=$1 and lead_id=$2 and status='pending') as pending,
         (select count(*)::int from label_suite.campaign_outreach_events where org_id=$1 and lead_id=$2 and event_type='enrichment_proposals_submitted') as events,
         (select count(*)::int from label_suite.campaign_enrichment_claims where org_id=$1 and lead_id=$2) as claims`,
      [orgId, leadId],
    );
    expect(persisted.rows[0]).toEqual({ runs: 1, pending: 1, events: 1, claims: 0 });
    const audit = await pool.query(
      `select metadata from label_suite.audit_logs where org_id=$1 and action='local_tool.proposal_submit'`,
      [orgId],
    );
    expect(audit.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({ result_category: "submitted", proposal_count: 1 }),
      }),
    ]));
  });

  it("returns only the resolved tenant's bounded operator diagnostics", async () => {
    const jobsRequest = authenticatedRequest("/api/local-tools/v1/operator/jobs/health", token);
    const jobsResponse = await executeOperatorDiagnostics(jobsRequest, { kind: "jobs_health" });
    expect(jobsResponse.status).toBe(200);
    const jobs = (await jobsResponse.json()).data;
    expect(jobs).toEqual(expect.objectContaining({
      queued: expect.any(Number),
      running: expect.any(Number),
      failed: expect.any(Number),
      expired_leases: expect.any(Number),
      active_workers: expect.any(Number),
    }));
    expect(JSON.stringify(jobs)).not.toMatch(/payload|lease_owner|idempotency/i);

    const ownRequest = authenticatedRequest(
      `/api/local-tools/v1/operator/operations-brief?resource_type=release&resource_id=${releaseId}`,
      token,
    );
    const ownResponse = await executeOperatorDiagnostics(ownRequest, {
      kind: "operations_brief",
      searchParams: new URL(ownRequest.url).searchParams,
    });
    expect(ownResponse.status).toBe(200);
    await expect(ownResponse.json()).resolves.toMatchObject({
      data: {
        resource_type: "release",
        record: { id: releaseId, title: "Operator release" },
        readiness: { state: "blocked", blockers: ["UPC/EAN"] },
      },
    });

    const otherRequest = authenticatedRequest(
      `/api/local-tools/v1/operator/operations-brief?resource_type=release&resource_id=${otherReleaseId}`,
      token,
    );
    const hiddenResponse = await executeOperatorDiagnostics(otherRequest, {
      kind: "operations_brief",
      searchParams: new URL(otherRequest.url).searchParams,
    });
    expect(hiddenResponse.status).toBe(404);
    await expect(hiddenResponse.json()).resolves.toMatchObject({ error: { code: "not_found" } });
  });

  function authenticatedRequest(path: string, bearer: string, init: RequestInit = {}) {
    return new Request(`https://labels.example${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${bearer}`, ...init.headers },
    });
  }

  async function loadLead() {
    return (await pool.query(
      "select row_to_json(lead) as value from label_suite.campaign_leads lead where id=$1",
      [leadId],
    )).rows[0].value;
  }
});

export function assertDisposableIntegrationTarget(
  env: NodeJS.ProcessEnv,
  connectionString: string,
): void {
  if (env.CAMPAIGN_ENRICHMENT_TOOL_INTEGRATION_DISPOSABLE !== "1") {
    throw new Error("Refusing Campaign Enrichment Tool integration target without the disposable marker.");
  }
  let target: URL;
  try {
    target = new URL(connectionString);
  } catch {
    throw new Error("Refusing Campaign Enrichment Tool integration target: DATABASE_URL must be PostgreSQL.");
  }
  if (
    (target.protocol !== "postgres:" && target.protocol !== "postgresql:")
    || (target.hostname !== "127.0.0.1" && target.hostname !== "localhost")
  ) {
    throw new Error("Refusing Campaign Enrichment Tool integration target: only local PostgreSQL is allowed.");
  }
  if (target.search || target.hash) {
    throw new Error("Refusing Campaign Enrichment Tool integration target: query parameters and fragments are not allowed.");
  }
  const databaseName = target.pathname.slice(1);
  const disposableCiDatabase = env.CI === "true" && databaseName === "label_suite";
  if (!disposableCiDatabase && !databaseName.startsWith("label_suite_campaign_tool_")) {
    throw new Error("Refusing Campaign Enrichment Tool integration target: database is not allowlisted as disposable.");
  }
}

describe("Campaign Enrichment Tool integration target safety", () => {
  it("requires an explicit disposable marker", () => {
    expect(() => assertDisposableIntegrationTarget(
      {},
      "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite_campaign_tool_test",
    )).toThrow("disposable marker");
  });

  it("rejects remote and non-allowlisted databases", () => {
    const env = { CAMPAIGN_ENRICHMENT_TOOL_INTEGRATION_DISPOSABLE: "1" };
    expect(() => assertDisposableIntegrationTarget(
      env,
      "postgres://label_suite:label_suite@example.com/label_suite_campaign_tool_test",
    )).toThrow("only local PostgreSQL");
    expect(() => assertDisposableIntegrationTarget(
      env,
      "postgres://label_suite:label_suite@127.0.0.1/label_suite",
    )).toThrow("not allowlisted as disposable");
    expect(() => assertDisposableIntegrationTarget(
      env,
      "postgres://label_suite:label_suite@127.0.0.1/label_suite_campaign_tool_test?host=example.com",
    )).toThrow("query parameters and fragments");
  });

  it("allows the CI service database only when CI and disposable markers are explicit", () => {
    expect(() => assertDisposableIntegrationTarget(
      { CI: "true", CAMPAIGN_ENRICHMENT_TOOL_INTEGRATION_DISPOSABLE: "1" },
      "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite",
    )).not.toThrow();
  });
});
