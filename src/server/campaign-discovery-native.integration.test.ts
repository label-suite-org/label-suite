import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_DISCOVERY_INTEGRATION === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
const describeFixture = enabled ? describe : describe.skip;
const suffix = randomUUID();
const orgA = `native-discovery-org-a-${suffix}`;
const orgB = `native-discovery-org-b-${suffix}`;
const userA = `native-discovery-user-a-${suffix}`;
const campaignA = `native-discovery-campaign-a-${suffix}`;
const campaignB = `native-discovery-campaign-b-${suffix}`;

let admin: Sql | undefined;
let executeCampaignDiscoveryCommand: typeof import("./campaign-discovery").executeCampaignDiscoveryCommand;
let runWithDatabaseContext: typeof import("../lib/db").runWithDatabaseContext;

const now = () => new Date("2026-09-17T10:00:00.000Z");
const context = { id: campaignA, campaign_name: "Fixture Campaign", artist_name: "Fixture Artist", release_title: "Fixture Release", goal: null, tracks: ["Fixture Track"] };

describeFixture("native discovery canonical fixture", () => {
  beforeAll(async () => {
    assertLocalCiDatabase(databaseUrl);
    admin = postgres(databaseUrl, { max: 1 });
    [{ executeCampaignDiscoveryCommand }, { runWithDatabaseContext }] = await Promise.all([
      import("./campaign-discovery"),
      import("../lib/db"),
    ]);
    await seedFixture(admin);
  }, 30_000);

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from "label_suite"."audit_logs" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."campaign_discovery_reviews" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."campaign_discovery_runs" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."creator_channels" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."campaign_leads" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."campaigns" where "id" in (${campaignA}, ${campaignB})`;
    await admin`delete from "label_suite"."org_memberships" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."user" where "id" = ${userA}`;
    // Fixture deletion triggers can append audit rows; clear them after dependents.
    await admin`delete from "label_suite"."audit_logs" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."orgs" where "id" in (${orgA}, ${orgB})`;
    await admin.end();
  }, 30_000);

  it("persists an operator shortlist with revision and audit, then rejects a stale revision", async () => {
    const dependencies = { loadContext: async () => context, actorUserId: userA, now };
    const shortlisted = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeCampaignDiscoveryCommand(
      orgA, campaignA, { type: "shortlist", channel_id: "channel-a", expected_revision: 0 }, dependencies,
    ));
    expect(shortlisted.review).toMatchObject({ state: "shortlisted", revision: 1, actor_user_id: userA });
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeCampaignDiscoveryCommand(
      orgA, campaignA, { type: "reject", channel_id: "channel-a", expected_revision: 0, reason: "wrong_music" }, dependencies,
    ))).rejects.toMatchObject({ status: 409 });
    const [audit] = await admin!`select count(*)::int as count from "label_suite"."audit_logs" where "org_id" = ${orgA} and "action" = 'campaign.discovery.reviewed'`;
    expect(audit.count).toBe(1);
  });

  it.each([true, false])("rolls back stale promotion with outer request context=%s", async (wrapped) => {
    const { promoteAndSaveCampaignDiscoveryReview, saveCampaignDiscoveryReview } = await import("./campaign-discovery-db");
    const channel = `race-${suffix}-${wrapped}`;
    const input = { orgId: orgA, campaignId: campaignA, provider: "youtube", providerChannelId: channel, nextState: "shortlisted" as const, reason: null, actorUserId: userA, expectedRevision: 0, decidedAt: now().toISOString() };
    await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => saveCampaignDiscoveryReview(input));
    const lock = Math.floor(Math.random() * 1_000_000_000);
    const trigger = `fixture_race_${suffix.replaceAll("-", "")}`;
    await admin!.unsafe(`CREATE FUNCTION label_suite.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`);
    await admin!.unsafe(`CREATE TRIGGER ${trigger} BEFORE INSERT ON label_suite.campaign_leads FOR EACH ROW EXECUTE FUNCTION label_suite.${trigger}()`);
    let pending: Promise<unknown> | undefined;
    try {
      await admin!.begin(async tx => {
        await tx`select pg_advisory_xact_lock(${lock})`;
        // Attach rejection handling immediately, then prove the write reached the lock.
        const promote = () => promoteAndSaveCampaignDiscoveryReview({
          ...input, nextState: "promoted", expectedRevision: 1,
          promotion: { campaignId: campaignA, channel: { provider_channel_id: channel, title: "Race fixture", url: `https://youtube.test/${channel}` }, evidence: [] },
        });
        pending = (wrapped ? runWithDatabaseContext({ userId: userA, orgId: orgA }, promote) : promote()).then(value => ({ value }), error => ({ error }));
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          await tx`select pg_stat_clear_snapshot()`;
          const rows = await tx`select pid from pg_stat_activity where datname = current_database() and wait_event = 'advisory' and query ilike '%campaign_leads%'`;
          if (rows.length) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        expect(blocked).toBe(true);
        // A second real transaction advances the revision while lead insertion waits.
        await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => saveCampaignDiscoveryReview({ ...input, nextState: "rejected", reason: "wrong_music", expectedRevision: 1 }));
      });
      const outcome = await pending as { error?: { status?: number } };
      expect(outcome.error?.status).toBe(409);
      const [lead] = await admin!`select count(*)::int as count from label_suite.campaign_leads where org_id = ${orgA} and target_url = ${`https://youtube.test/${channel}`}`;
      expect(lead.count).toBe(0);
      const [review] = await admin!`select state, revision from label_suite.campaign_discovery_reviews where org_id = ${orgA} and provider_channel_id = ${channel}`;
      expect(review).toMatchObject({ state: "rejected", revision: 2 });
      const [audit] = await admin!`select count(*)::int as count from label_suite.audit_logs where org_id = ${orgA} and action = 'campaign.discovery.reviewed' and entity_id = ${`discovery_review:${orgA}:${campaignA}:youtube:${channel}`}`;
      expect(audit.count).toBe(2);
    } finally {
      if (pending) await pending;
      await admin!.unsafe(`DROP TRIGGER IF EXISTS ${trigger} ON label_suite.campaign_leads`);
      await admin!.unsafe(`DROP FUNCTION IF EXISTS label_suite.${trigger}()`);
    }
  }, 15_000);

  it("executes bounded JSON projection and traverses equal-time runs without skips", async () => {
    const { loadCampaignDiscoveryWorkspace } = await import("./campaign-discovery");
    const [seed] = await admin!`select channels from label_suite.campaign_discovery_runs where org_id = ${orgA} limit 1`;
    const channels = Array.from({ length: 3 }, (_, n) => ({ ...seed.channels[0], provider_channel_id: `bounded-${n}` }));
    for (const id of ["bounded-a", "bounded-b"]) {
      await admin!`insert into label_suite.campaign_discovery_runs (id, org_id, campaign_id, status, estimated_cost_units, queries, channels, created_at) values (${`${campaignA}:${id}`}, ${orgA}, ${campaignA}, 'completed', 100, ${admin!.json([])}, ${admin!.json(channels)}, '2026-09-17T10:00:00Z')`;
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const response = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => loadCampaignDiscoveryWorkspace(orgA, campaignA, { loadContext: async () => context, now }, { runLimit: 1, candidateLimit: 1, evidenceLimit: 1, cursor }));
      expect(response.runs).toHaveLength(1);
      expect(response.runs[0].channels).toHaveLength(1);
      expect(response.runs[0].channels[0].evidence.length).toBeLessThanOrEqual(1);
      seen.push(response.runs[0].id);
      if (!response.page?.has_more) break;
      cursor = response.page.next_cursor ?? undefined;
      expect(cursor).toBeTruthy();
    }
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  it("retains explicitly selected evidence from older runs of the same candidate", async () => {
    const { listCampaignDiscoveryRuns } = await import("./campaign-discovery-db");
    const [seed] = await admin!`select channels from label_suite.campaign_discovery_runs where org_id = ${orgA} and id = ${`${campaignA}:run`}`;
    const channel = { ...seed.channels[0], evidence: [{ ...seed.channels[0].evidence[0], provider_item_id: "newer-evidence" }] };
    await admin!`insert into label_suite.campaign_discovery_runs (id, org_id, campaign_id, status, estimated_cost_units, queries, channels, created_at)
      values (${`${campaignA}:newer-evidence`}, ${orgA}, ${campaignA}, 'completed', 100, '[]'::jsonb, ${admin!.json([channel])}, '2026-09-19T10:00:00Z')`;
    const rows = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => listCampaignDiscoveryRuns(orgA, campaignA, {
      providerChannelId: "channel-a", runLimit: 1, candidateLimit: 1, evidenceLimit: 10, evidenceIds: ["evidence-a", "newer-evidence"],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].channels).toHaveLength(1);
    expect(rows[0].channels[0].evidence.map((item) => item.provider_item_id).sort()).toEqual(["evidence-a", "newer-evidence"]);
  });

  it("loads only the selected candidate and evidence from a large run history", async () => {
    const { listCampaignDiscoveryRuns } = await import("./campaign-discovery-db");
    const [seed] = await admin!`select channels from label_suite.campaign_discovery_runs where org_id = ${orgA} and id = ${`${campaignA}:run`}`;
    const channels = Array.from({ length: 80 }, (_, n) => ({ ...seed.channels[0], provider_channel_id: `history-${n}` }));
    channels.push({ ...seed.channels[0], provider_channel_id: "target-history" });
    await admin!`insert into label_suite.campaign_discovery_runs (id, org_id, campaign_id, status, estimated_cost_units, queries, channels, created_at)
      select ${campaignA} || ':history-' || n, ${orgA}, ${campaignA}, 'completed', 100, '[]'::jsonb, ${admin!.json(channels)}, '2026-09-18T10:00:00Z'::timestamp from generate_series(1, 30) n`;
    const rows = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => listCampaignDiscoveryRuns(orgA, campaignA, {
      providerChannelId: "target-history", runLimit: 1, candidateLimit: 1, evidenceLimit: 10, evidenceIds: ["evidence-a"],
    }));
    expect(rows).toHaveLength(1);
    expect(rows[0].channels).toHaveLength(1);
    expect(rows[0].channels[0].provider_channel_id).toBe("target-history");
    expect(rows[0].channels[0].evidence.map((item) => item.provider_item_id)).toEqual(["evidence-a"]);
    const foreign = await runWithDatabaseContext({ userId: userA, orgId: orgB }, () => listCampaignDiscoveryRuns(orgB, campaignB, {
      providerChannelId: "target-history", runLimit: 1, candidateLimit: 1, evidenceIds: [],
    }));
    expect(foreign).toEqual([]);
  });

  it("uses canonical duplicate protection on explicit promotion and hides a foreign tenant candidate", async () => {
    const dependencies = { loadContext: async () => context, actorUserId: userA, now };
    const command = { type: "promote" as const, channel_id: "channel-a", expected_revision: 1, evidence_ids: ["evidence-a"] };
    const promoted = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeCampaignDiscoveryCommand(orgA, campaignA, command, dependencies));
    expect(promoted.review).toMatchObject({ state: "promoted", promotion_outcome: "created" });
    const repeated = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeCampaignDiscoveryCommand(
      orgA, campaignA, { ...command, expected_revision: 2 }, dependencies,
    ));
    expect(repeated.review).toMatchObject({ state: "promoted", promotion_outcome: "existing" });
    const [leads] = await admin!`select count(*)::int as count from "label_suite"."campaign_leads" where "org_id" = ${orgA} and "campaign_id" = ${campaignA}`;
    expect(leads.count).toBe(1);
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeCampaignDiscoveryCommand(
      orgB, campaignB, { type: "shortlist", channel_id: "channel-b", expected_revision: 0 }, dependencies,
    ))).rejects.toMatchObject({ status: 404 });
  });
});

async function seedFixture(client: Sql): Promise<void> {
  const channels = [{ provider_channel_id: "channel-a", title: "Fixture Selector", url: "https://youtube.test/channel-a", evidence: [{ provider_item_id: "evidence-a", provider: "youtube_data_api_v3", query: "Fixture Artist Fixture Track", title: "Fixture Artist — Fixture Track", url: "https://youtube.test/evidence-a", published_at: "2026-09-16T10:00:00.000Z", retrieved_at: "2026-09-17T10:00:00.000Z" }], exact_match_evidence: [], prospective_fit: { qualifies: true, signals: ["matching_content_format"] }, activity_freshness: { state: "fresh", latest_activity_at: "2026-09-16T10:00:00.000Z", expires_at: "2026-12-16T10:00:00.000Z" }, relevance: { exactness: 0, editorial_fit: 1, activity: 1, evidence_strength: 1, total: 4 }, review: {} }];
  await client`insert into "label_suite"."orgs" ("id", "name", "slug") values (${orgA}, 'Native discovery A', ${orgA}), (${orgB}, 'Native discovery B', ${orgB})`;
  await client`insert into "label_suite"."user" ("id", "name", "email", "emailVerified") values (${userA}, 'Native discovery operator', ${`${userA}@example.test`}, true)`;
  await client`insert into "label_suite"."org_memberships" ("id", "org_id", "user_id", "role") values (${`${orgA}:${userA}`}, ${orgA}, ${userA}, 'operator')`;
  await client`insert into "label_suite"."campaigns" ("id", "org_id", "campaign_name") values (${campaignA}, ${orgA}, 'Fixture Campaign'), (${campaignB}, ${orgB}, 'Other campaign')`;
  await client`insert into "label_suite"."campaign_discovery_runs" ("id", "org_id", "campaign_id", "status", "estimated_cost_units", "queries", "channels", "created_at") values (${`${campaignA}:run`}, ${orgA}, ${campaignA}, 'completed', 100, ${client.json([])}, ${client.json(channels)}, '2026-09-17T10:00:00.000Z'::timestamp)`;
}

function assertLocalCiDatabase(value: string): void {
  const target = new URL(value);
  const database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  if (!["postgres:", "postgresql:"].includes(target.protocol) || !["127.0.0.1", "localhost", "database"].includes(target.hostname) || database !== "label_suite" || target.search || target.hash) {
    throw new Error("Refusing native discovery fixture target: require the exact local label_suite CI database.");
  }
}
