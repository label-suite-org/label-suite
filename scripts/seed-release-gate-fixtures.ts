import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { auth } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { users } from "../src/db/auth-schema";
import {
  campaign_outreach_drafts,
  org_memberships,
  orgs,
} from "../src/db/schema";
import {
  getCampaignPublicPageEditor,
  publishCampaignPublicPageRevision,
  reviewCampaignPublicPageRevision,
  saveCampaignPublicPageDraft,
} from "../src/server/campaign-public-page";
import {
  approveDraft,
  createManualRadioUpdateDraft,
  hashDraftContent,
} from "../src/server/campaign-communicator";
import { deriveCampaignDocument, legacyTextToCampaignDocument } from "../src/lib/campaign-rich-text";
import { assertDisposableReleaseGateTarget } from "./release-gate-fixture-safety";
import { releaseGateFixtureWorld } from "./release-gate-fixture-world";

const { orgId: ORG_ID, foreignTenant: FOREIGN_TENANT_FIXTURE, ids: FIXTURE_IDS, relationships: FIXTURE_RELATIONSHIPS, radio } = releaseGateFixtureWorld;
const FIXTURE_USER = {
  name: "Release Gate Operator",
  email: process.env.E2E_USER_EMAIL?.trim() ?? "",
  password: process.env.E2E_USER_PASSWORD?.trim() ?? "",
} as const;
const READ_ONLY_FIXTURE_USER = {
  name: "Release Gate Read-only Member",
  email: process.env.E2E_READ_ONLY_USER_EMAIL?.trim() || readOnlyFixtureEmail(FIXTURE_USER.email),
  password: process.env.E2E_READ_ONLY_USER_PASSWORD?.trim() || FIXTURE_USER.password,
} as const;
const RADIO_REVIEW_SLUG = radio.reviewSlug;
const RADIO_PUBLIC_SLUG = radio.publicSlug;
const ARTWORK_FIXTURE_URL = radio.artworkUrl;
const RADIO_SUBJECT = radio.subject;
const RADIO_BODY = radio.body;
const GOAL_DOCUMENT = deriveCampaignDocument({ type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Release-gate airplay goal" }] },
  { type: "paragraph", content: [{ type: "text", text: "Prepare a clear independent-radio update for the isolated fixture." }] },
] }, 20_000);
const NOTES_DOCUMENT = deriveCampaignDocument({ type: "doc", content: [
  { type: "paragraph", content: [{ type: "text", text: "Fixture notes remain local to release-gate verification.", marks: [{ type: "italic" }] }] },
] }, 20_000);
const RADIO_BODY_DOCUMENT = deriveCampaignDocument(legacyTextToCampaignDocument(RADIO_BODY), 10_000);
const FOCUSED_BODY_DOCUMENT = deriveCampaignDocument(legacyTextToCampaignDocument("A versioned focused fixture note for Release Gate FM.\n\nListen: https://example.test/fountain-listen"), 10_000);
const RELEASE_NOTE_DOCUMENT = deriveCampaignDocument({ type: "doc", content: [
  { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Fountain Edits" }] },
  { type: "paragraph", content: [{ type: "text", text: "An ", }, { type: "text", text: "isolated", marks: [{ type: "bold" }] }, { type: "text", text: " reviewed fixture with a ", }, { type: "text", text: "safe listen link", marks: [{ type: "link", attrs: { href: "https://example.test/fountain-listen" } }] }, { type: "text", text: ". Hostile-looking fixture text stays literal: <script>window.fixture = true</script> onclick=\"fixture()\" javascript:alert(1) data:text/html,fixture." }] },
] }, 20_000);
// Keep the public renderer's publication date stable across CI runs. The
// release-gate assertion intentionally proves this exact published projection
// rather than accepting whatever wall-clock date seeded the fixture.
const PUBLIC_FIXTURE_PUBLISHED_AT = releaseGateFixtureWorld.publicFixturePublishedAt;

async function findUserByEmail(email: string) {
  const rows = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}

function readOnlyFixtureEmail(email: string) {
  const at = email.indexOf("@");
  return at > 0 ? `${email.slice(0, at)}+readonly${email.slice(at)}` : `${email}+readonly@example.test`;
}

async function ensureFixtureUser(user: { name: string; email: string; password: string } = FIXTURE_USER) {
  const existing = await findUserByEmail(user.email);
  if (existing) return existing.id;

  const baseUrl = process.env.E2E_BASE_URL?.trim() || process.env.PUBLIC_SITE_URL?.trim() || "http://localhost:4321";
  const headers = new Headers({ host: new URL(baseUrl).host });

  await auth.api.signUpEmail({
    body: {
      name: user.name,
      email: user.email,
      password: user.password,
    },
    headers,
  });

  const created = await findUserByEmail(user.email);
  if (!created) {
    throw new Error("Release-gate fixture user did not persist after signUpEmail.");
  }

  return created.id;
}

async function ensureTrueNatureOrg(userId: string, role: "owner" | "member" = "owner") {
  await db.insert(orgs).values({
    id: ORG_ID,
    name: "True Nature",
    slug: "true-nature",
    plan: "internal",
    timezone: "Europe/Copenhagen",
    currency: "DKK",
    validation_sweep_mode: "manual",
    default_release_policy: "readiness_gates",
    isrc_country_code: "DK",
    isrc_registrant_code: "O7P",
  }).onConflictDoNothing({ target: orgs.id });

  await db.insert(org_memberships).values({
    id: `${ORG_ID}:${userId}`,
    org_id: ORG_ID,
    user_id: userId,
    role,
  }).onConflictDoUpdate({
    target: [org_memberships.org_id, org_memberships.user_id],
    set: { role },
  });
}

async function ensureForeignTenantFixture(memberUserId: string) {
  await db.insert(orgs).values({
    id: FOREIGN_TENANT_FIXTURE.org,
    name: "E2E Release Gate Foreign Tenant",
    slug: "e2e-release-gate-foreign",
    plan: "internal",
    timezone: "Europe/Copenhagen",
    currency: "DKK",
    validation_sweep_mode: "manual",
    default_release_policy: "readiness_gates",
    catalog_prefix: "E2E",
  }).onConflictDoUpdate({
    target: orgs.id,
    set: { name: "E2E Release Gate Foreign Tenant", slug: "e2e-release-gate-foreign" },
  });

  await db.insert(org_memberships).values({
    id: FOREIGN_TENANT_FIXTURE.membership,
    org_id: FOREIGN_TENANT_FIXTURE.org,
    user_id: memberUserId,
    role: "member",
  }).onConflictDoUpdate({
    target: [org_memberships.org_id, org_memberships.user_id],
    set: { role: "member" },
  });

  await db.execute(sql`
    insert into label_suite.campaigns (id, org_id, campaign_name, campaign_type, status, owner, goal, main_platform)
    values (
      ${FOREIGN_TENANT_FIXTURE.campaign}, ${FOREIGN_TENANT_FIXTURE.org},
      ${"E2E Foreign Tenant Campaign"}, ${"radio"}, ${"planning"},
      ${READ_ONLY_FIXTURE_USER.name}, ${"Synthetic tenant-isolation fixture only."}, ${"radio"}
    )
    on conflict (id) do update set
      org_id = excluded.org_id,
      campaign_name = excluded.campaign_name,
      campaign_type = excluded.campaign_type,
      status = excluded.status,
      owner = excluded.owner,
      goal = excluded.goal,
      main_platform = excluded.main_platform,
      updated_at = now()
  `);

  await db.execute(sql`
    insert into label_suite.campaign_sources (
      id, org_id, campaign_id, source_key, source_type, title, authorization_note, notes
    ) values (
      ${FOREIGN_TENANT_FIXTURE.source}, ${FOREIGN_TENANT_FIXTURE.org},
      ${FOREIGN_TENANT_FIXTURE.campaign}, ${"e2e-foreign-tenant"}, ${"fixture"},
      ${"E2E foreign tenant source"}, ${"Tenant-isolation evidence only; no outreach authority."},
      ${"Synthetic release-gate data with no private contacts."}
    )
    on conflict (id) do update set
      org_id = excluded.org_id,
      campaign_id = excluded.campaign_id,
      source_key = excluded.source_key,
      source_type = excluded.source_type,
      title = excluded.title,
      authorization_note = excluded.authorization_note,
      notes = excluded.notes,
      updated_at = now()
  `);

  await db.execute(sql`
    insert into label_suite.campaign_leads (
      id, org_id, campaign_id, source_id, dedupe_key, target_name, target_type,
      discovery_source, relationship_warmth, editorial_fit, useful_reach,
      direct_free_access, pipeline_stage
    ) values (
      ${FOREIGN_TENANT_FIXTURE.lead}, ${FOREIGN_TENANT_FIXTURE.org},
      ${FOREIGN_TENANT_FIXTURE.campaign}, ${FOREIGN_TENANT_FIXTURE.source},
      ${"e2e:foreign-tenant-lead"}, ${"E2E Foreign Tenant Lead"}, ${"editorial"},
      ${"Synthetic tenant-isolation fixture"}, ${0}, ${1}, ${1}, ${1}, ${"identified"}
    )
    on conflict (id) do update set
      org_id = excluded.org_id,
      campaign_id = excluded.campaign_id,
      source_id = excluded.source_id,
      dedupe_key = excluded.dedupe_key,
      target_name = excluded.target_name,
      target_type = excluded.target_type,
      discovery_source = excluded.discovery_source,
      relationship_warmth = excluded.relationship_warmth,
      editorial_fit = excluded.editorial_fit,
      useful_reach = excluded.useful_reach,
      direct_free_access = excluded.direct_free_access,
      pipeline_stage = excluded.pipeline_stage,
      updated_at = now()
  `);
}

async function ensureCatalogFixtures() {
  await db.execute(sql`
    insert into label_suite.artists (id, org_id, name)
    values (${FIXTURE_IDS.artist}, ${ORG_ID}, ${"Release Gate Artist"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into label_suite.releases (id, org_id, title, artist_id, format, status)
    values (${FIXTURE_IDS.release}, ${ORG_ID}, ${"Release Gate Single"}, ${FIXTURE_RELATIONSHIPS.catalog.releaseArtistId}, ${"single"}, ${"draft"})
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    update label_suite.releases
    set title = ${"Release Gate Single"}, release_date = ${"2026-08-05"}, updated_at = coalesce(updated_at, now())
    where id = ${FIXTURE_IDS.release} and org_id = ${ORG_ID}
  `);

  await db.execute(sql`
    insert into label_suite.tracks (id, org_id, release_id, title, position, track_ready, track_missing)
    values (
      ${FIXTURE_IDS.track},
      ${ORG_ID},
      ${FIXTURE_RELATIONSHIPS.catalog.trackReleaseId},
      ${"Release Gate Track"},
      ${1},
      ${false},
      ${"Seeded CI fixture intentionally leaves the audio file missing."}
    )
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    update label_suite.tracks
    set title = ${"Release Gate Track"}, duration = ${347}, updated_at = coalesce(updated_at, now())
    where id = ${FIXTURE_IDS.track} and org_id = ${ORG_ID}
  `);
}

async function ensureCampaignFixtures() {
  await db.execute(sql`
    insert into label_suite.campaigns (
      id,
      org_id,
      campaign_name,
      linked_release_id,
      linked_artist_id,
      campaign_type,
      status,
      owner,
      goal,
      goal_document,
      notes,
      notes_document,
      main_platform
    )
    values (
      ${FIXTURE_IDS.campaign},
      ${ORG_ID},
      ${"Release Gate Campaign"},
      ${FIXTURE_RELATIONSHIPS.campaign.releaseId},
      ${FIXTURE_RELATIONSHIPS.campaign.artistId},
      ${"radio"},
      ${"planning"},
      ${FIXTURE_USER.name},
      ${GOAL_DOCUMENT.plainText},
      ${JSON.stringify(GOAL_DOCUMENT.document)}::jsonb,
      ${NOTES_DOCUMENT.plainText},
      ${JSON.stringify(NOTES_DOCUMENT.document)}::jsonb,
      ${"radio"}
    )
    on conflict (id) do update set
      goal = excluded.goal,
      goal_document = excluded.goal_document,
      notes = excluded.notes,
      notes_document = excluded.notes_document,
      updated_at = now(),
      revision = label_suite.campaigns.revision + 1
  `);

  await db.execute(sql`
    insert into label_suite.radio_stations (
      id,
      org_id,
      name,
      call_sign,
      city,
      country,
      email,
      dj_name,
      tier
    )
    values (
      ${FIXTURE_IDS.station},
      ${ORG_ID},
      ${"Release Gate FM"},
      ${"RGFM"},
      ${"Copenhagen"},
      ${"DK"},
      ${"dj@release-gate.fm"},
      ${"Fixture DJ"},
      ${"priority"}
    )
    on conflict (id) do nothing
  `);

  await db.execute(sql`
    insert into label_suite.campaign_stations (id, org_id, campaign_id, station_id, status)
    values (${FIXTURE_RELATIONSHIPS.campaign.campaignStationId}, ${ORG_ID}, ${FIXTURE_RELATIONSHIPS.campaign.id}, ${FIXTURE_RELATIONSHIPS.campaign.stationId}, ${"pending"})
    on conflict (id) do nothing
  `);
}

async function ensureCampaignActivityFixtures(userId: string) {
  await db.execute(sql`
    delete from label_suite.campaign_activity_proposal_decisions
    where org_id = ${ORG_ID} and campaign_id = ${FIXTURE_IDS.campaign}
  `);

  const operatorLeads = [
    { key: "desktop", leadId: FIXTURE_IDS.activityLeads.desktop, taskId: FIXTURE_IDS.activityTasks.desktop, eventId: FIXTURE_IDS.activityEvents.desktop, runId: FIXTURE_IDS.activityRuns.desktop, suggestionId: FIXTURE_IDS.activitySuggestions.desktop, at: "2026-08-06T10:00:00.000Z" },
    { key: "mobile390", leadId: FIXTURE_IDS.activityLeads.mobile390, taskId: FIXTURE_IDS.activityTasks.mobile390, eventId: FIXTURE_IDS.activityEvents.mobile390, runId: FIXTURE_IDS.activityRuns.mobile390, suggestionId: FIXTURE_IDS.activitySuggestions.mobile390, at: "2026-08-06T11:00:00.000Z" },
    { key: "mobile320", leadId: FIXTURE_IDS.activityLeads.mobile320, taskId: FIXTURE_IDS.activityTasks.mobile320, eventId: FIXTURE_IDS.activityEvents.mobile320, runId: FIXTURE_IDS.activityRuns.mobile320, suggestionId: FIXTURE_IDS.activitySuggestions.mobile320, at: "2026-08-06T12:00:00.000Z" },
  ] as const;

  for (const fixture of [...operatorLeads, { key: "read-only", leadId: FIXTURE_IDS.activityLeads.readOnly, taskId: null, eventId: null, at: "2026-08-06T13:00:00.000Z" }] as const) {
    await db.execute(sql`
      insert into label_suite.campaign_leads (
        id, org_id, campaign_id, source_id, station_id, exact_edit_track_id,
        dedupe_key, target_name, target_type, contact_route, contact_route_verified_at,
        discovery_source, musical_fit, relationship_warmth, editorial_fit,
        useful_reach, direct_free_access, pipeline_stage, pitch_angle
      ) values (
        ${fixture.leadId}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${FIXTURE_IDS.source},
        ${FIXTURE_IDS.station}, ${FIXTURE_IDS.track}, ${`activity:${fixture.key}`},
        ${`Release Gate Activity ${fixture.key}`}, ${"radio_station"}, ${"Synthetic activity route"}, now(),
        ${"Release-gate activity fixture"}, ${"Independent electronic radio"}, ${2}, ${2}, ${1}, ${2},
        ${"qualified"}, ${"Review the deterministic relationship activity fixture"}
      )
      on conflict (id) do update set
        target_name = excluded.target_name,
        pipeline_stage = excluded.pipeline_stage,
        contact_route_verified_at = excluded.contact_route_verified_at,
        updated_at = now()
    `);

    if (fixture.eventId) {
      await db.execute(sql`
        insert into label_suite.campaign_outreach_events (
          id, org_id, campaign_id, lead_id, event_type, actor_user_id, occurred_at, details
        ) values (
          ${fixture.eventId}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${fixture.leadId},
          ${"research_completed"}, ${userId}, ${fixture.at}::timestamp,
          ${JSON.stringify({ suggestion_type: "release-gate-activity", version: "1" })}::jsonb
        )
        on conflict (id) do update set
          lead_id = excluded.lead_id,
          actor_user_id = excluded.actor_user_id,
          occurred_at = excluded.occurred_at,
          details = excluded.details,
          updated_at = now()
      `);

      await db.execute(sql`
        insert into label_suite.campaign_enrichment_runs (
          id, org_id, campaign_id, lead_id, status, started_at, completed_at, created_at, updated_at
        ) values (
          ${fixture.runId}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${fixture.leadId}, ${"completed"},
          ${fixture.at}::timestamp, ${fixture.at}::timestamp, ${fixture.at}::timestamp, ${fixture.at}::timestamp
        )
        on conflict (id) do update set
          campaign_id = excluded.campaign_id,
          lead_id = excluded.lead_id,
          status = excluded.status,
          completed_at = excluded.completed_at,
          updated_at = excluded.updated_at
      `);

      await db.execute(sql`
        insert into label_suite.campaign_enrichment_suggestions (
          id, org_id, campaign_id, lead_id, enrichment_run_id, suggestion_type,
          suggested_value, evidence, status, resolved_by, resolved_at, created_at, updated_at
        ) values (
          ${fixture.suggestionId}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${fixture.leadId}, ${fixture.runId},
          ${"pitch_angle"}, ${JSON.stringify({ value: "Lead with the verified release context." })}::jsonb,
          ${JSON.stringify([{ title: "Release-gate evidence", url: "https://example.test/release-gate-evidence", retrieved_at: fixture.at, citation_text: "Synthetic accepted research context." }])}::jsonb,
          ${"accepted"}, ${userId}, ${fixture.at}::timestamp, ${fixture.at}::timestamp, ${fixture.at}::timestamp
        )
        on conflict (id) do update set
          campaign_id = excluded.campaign_id,
          lead_id = excluded.lead_id,
          enrichment_run_id = excluded.enrichment_run_id,
          suggested_value = excluded.suggested_value,
          evidence = excluded.evidence,
          status = excluded.status,
          resolved_by = excluded.resolved_by,
          resolved_at = excluded.resolved_at,
          updated_at = excluded.updated_at
      `);

      await db.execute(sql`
        insert into label_suite.ops_tasks (
          id, org_id, task_name, status, priority, owner, due_date,
          linked_campaign_id, linked_campaign_lead_id, next_action, updated_at
        ) values (
          ${fixture.taskId}, ${ORG_ID}, ${"Release-gate activity review"}, ${"completed"}, ${null},
          ${FIXTURE_USER.name}, ${"2026-08-12"}, ${FIXTURE_IDS.campaign}, ${fixture.leadId},
          ${"Review the deterministic activity proposal"}, ${fixture.at}::timestamp
        )
        on conflict (id) do update set
          status = excluded.status,
          priority = excluded.priority,
          linked_campaign_id = excluded.linked_campaign_id,
          linked_campaign_lead_id = excluded.linked_campaign_lead_id,
          next_action = excluded.next_action,
          updated_at = excluded.updated_at
      `);
    }
  }

  await db.execute(sql`
    insert into label_suite.email_logs (
      id, org_id, campaign_id, station_id, subject, body, status, provider, operator_id, sent_at
    ) values (
      ${FIXTURE_IDS.activityEmail}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${FIXTURE_IDS.station},
      ${"Release-gate activity fixture"}, ${"Synthetic evidence only; no message was delivered."},
      ${"sent"}, ${"fixture"}, ${userId}, ${"2026-08-06T14:00:00.000Z"}::timestamp
    )
    on conflict (id) do update set
      subject = excluded.subject,
      body = excluded.body,
      status = excluded.status,
      provider = excluded.provider,
      operator_id = excluded.operator_id,
      sent_at = excluded.sent_at
  `);
}

async function ensureRadioUpdateFixtures(userId: string) {
  await db.execute(sql`
    insert into label_suite.media_assets (
      id, org_id, asset_name, asset_type, linked_release_id, version,
      approval_status, delivery_status, file_link
    ) values (
      ${FIXTURE_IDS.artwork}, ${ORG_ID}, ${"Fountain release-gate cover"}, ${"artwork"},
      ${FIXTURE_IDS.release}, ${"approved-v1"}, ${"approved"}, ${"not_sent"}, ${ARTWORK_FIXTURE_URL}
    )
    on conflict (id) do update set
      linked_release_id = excluded.linked_release_id,
      approval_status = excluded.approval_status,
      file_link = excluded.file_link
  `);

  await db.execute(sql`
    insert into label_suite.campaign_audiences (id, org_id, name, description, membership_rules)
    values (
      ${FIXTURE_IDS.audience},
      ${ORG_ID},
      ${"Release Gate independent-radio network"},
      ${"Isolated release-gate audience: focused targets are excluded and duplicate recipient emails remain visible in preview."},
      ${JSON.stringify({
        include_contact_roles: [],
        exclude_contact_roles: [],
        require_contact_email: true,
        exclude_contact_ids: [],
        include_station_states: [],
        exclude_station_states: [],
        require_station_email: true,
        exclude_station_ids: [],
      })}::jsonb
    )
    on conflict (id) do update set
      name = excluded.name,
      description = excluded.description,
      membership_rules = excluded.membership_rules,
      updated_at = now()
  `);

  await db.execute(sql`
    update label_suite.campaigns
    set campaign_name = ${"Fountain Edits — Release Gate Campaign"},
        campaign_audience_id = ${FIXTURE_IDS.audience},
        content_provider = ${"not_resolved"},
        updated_at = now(),
        revision = revision + 1
    where id = ${FIXTURE_IDS.campaign} and org_id = ${ORG_ID}
  `);

  await db.execute(sql`
    update label_suite.radio_stations
    set name = ${"Release Gate FM"}, email = ${"focused@release-gate.example"}, updated_at = now()
    where id = ${FIXTURE_IDS.station} and org_id = ${ORG_ID}
  `);

  await db.execute(sql`
    insert into label_suite.radio_stations (id, org_id, name, call_sign, city, country, email, dj_name, tier)
    values
      (${FIXTURE_IDS.duplicateStationA}, ${ORG_ID}, ${"Release Gate Network One"}, ${"RGN1"}, ${"Copenhagen"}, ${"DK"}, ${"network@release-gate.example"}, ${"Network desk"}, ${"priority"}),
      (${FIXTURE_IDS.duplicateStationB}, ${ORG_ID}, ${"Release Gate Network Duplicate"}, ${"RGN2"}, ${"Copenhagen"}, ${"DK"}, ${" NETWORK@release-gate.example "}, ${"Network desk"}, ${"priority"})
    on conflict (id) do update set
      name = excluded.name,
      email = excluded.email,
      updated_at = now()
  `);

  for (const stationId of [FIXTURE_IDS.station, FIXTURE_IDS.duplicateStationA, FIXTURE_IDS.duplicateStationB]) {
    await db.execute(sql`
      insert into label_suite.campaign_audience_stations (id, org_id, audience_id, station_id)
      values (${`${FIXTURE_IDS.audience}:${stationId}`}, ${ORG_ID}, ${FIXTURE_IDS.audience}, ${stationId})
      on conflict (org_id, audience_id, station_id) do nothing
    `);
  }

  await db.execute(sql`
    insert into label_suite.campaign_sources (
      id, org_id, campaign_id, source_key, source_type, title, authorization_note, notes
    ) values (
      ${FIXTURE_IDS.source}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${"release-gate-radio"},
      ${"fixture"}, ${"Release-gate radio fixture"},
      ${"Local release-gate evidence only; never an outreach authorization."},
      ${"Synthetic data with no private contacts."}
    )
    on conflict (org_id, campaign_id, source_key) do update set
      authorization_note = excluded.authorization_note,
      notes = excluded.notes,
      updated_at = now()
  `);

  await db.execute(sql`
    insert into label_suite.campaign_leads (
      id, org_id, campaign_id, source_id, station_id, exact_edit_track_id,
      dedupe_key, target_name, target_type, contact_route, contact_route_verified_at,
      discovery_source, musical_fit, relationship_warmth, editorial_fit,
      useful_reach, direct_free_access, pipeline_stage, pitch_angle
    ) values (
      ${FIXTURE_IDS.lead}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${FIXTURE_IDS.source},
      ${FIXTURE_IDS.station}, ${FIXTURE_IDS.track}, ${`radio:${FIXTURE_IDS.station}`},
      ${"Release Gate FM"}, ${"radio_station"}, ${"Synthetic music desk email"}, now(),
      ${"Release-gate fixture"}, ${"Independent electronic radio"}, ${2}, ${3}, ${1}, ${2},
      ${"qualified"}, ${"A focused one-to-one Fountain edit pitch"}
    )
    on conflict (org_id, campaign_id, dedupe_key) do update set
      source_id = excluded.source_id,
      station_id = excluded.station_id,
      exact_edit_track_id = excluded.exact_edit_track_id,
      target_name = excluded.target_name,
      pipeline_stage = excluded.pipeline_stage,
      updated_at = now()
  `);

  const reviewedRevision = await ensureReviewedRadioPage({
    campaignId: FIXTURE_IDS.campaign,
    slug: RADIO_REVIEW_SLUG,
    title: "Fountain Edits — Radio Release Gate",
    releaseNoteDocument: RELEASE_NOTE_DOCUMENT.document,
    userId,
  });
  await ensureApprovedRadioDraft(reviewedRevision, userId);

  await db.execute(sql`
    insert into label_suite.campaigns (
      id, org_id, campaign_name, linked_release_id, linked_artist_id,
      campaign_type, status, owner, goal, main_platform
    ) values (
      ${FIXTURE_IDS.publishedCampaign}, ${ORG_ID}, ${"Fountain Edits — Published Fixture"},
      ${FIXTURE_IDS.release}, ${FIXTURE_IDS.artist}, ${"radio"}, ${"active"},
      ${FIXTURE_USER.name}, ${"Isolated public-renderer release-gate fixture"}, ${"radio"}
    )
    on conflict (id) do update set
      campaign_name = excluded.campaign_name,
      linked_release_id = excluded.linked_release_id,
      linked_artist_id = excluded.linked_artist_id,
      updated_at = now(),
      revision = label_suite.campaigns.revision + 1
  `);
  const publicRevision = await ensureReviewedRadioPage({
    campaignId: FIXTURE_IDS.publishedCampaign,
    slug: RADIO_PUBLIC_SLUG,
    title: "Fountain Edits — Published Fixture",
    releaseNoteDocument: RELEASE_NOTE_DOCUMENT.document,
    userId,
  });
  const publicEditor = await getCampaignPublicPageEditor(ORG_ID, FIXTURE_IDS.publishedCampaign);
  if (publicEditor.page?.status !== "published" || publicEditor.page.current_published_revision_id !== publicRevision.id) {
    await publishCampaignPublicPageRevision(ORG_ID, FIXTURE_IDS.publishedCampaign, publicRevision.id, userId);
  }
  await db.execute(sql`
    update label_suite.campaign_public_page_revisions
    set reviewed_at = ${PUBLIC_FIXTURE_PUBLISHED_AT}::timestamptz,
        updated_at = ${PUBLIC_FIXTURE_PUBLISHED_AT}::timestamptz
    where id = ${publicRevision.id}
      and org_id = ${ORG_ID}
  `);
  await db.execute(sql`
    update label_suite.campaign_public_pages
    set updated_at = ${PUBLIC_FIXTURE_PUBLISHED_AT}::timestamptz
    where campaign_id = ${FIXTURE_IDS.publishedCampaign}
      and org_id = ${ORG_ID}
  `);
  return reviewedRevision;
}

async function ensureReviewedRadioPage(input: {
  campaignId: string;
  slug: string;
  title: string;
  releaseNoteDocument: unknown;
  userId: string;
}) {
  const releaseNote = deriveCampaignDocument(input.releaseNoteDocument, 20_000);
  const editor = await getCampaignPublicPageEditor(ORG_ID, input.campaignId);
  const currentReviewed = editor.revisions.find((revision) => (
    revision.review_status === "reviewed"
    && revision.content && typeof revision.content === "object"
    && (revision.content as { title?: unknown }).title === input.title
    && campaignDocumentMatches(
      (revision.content as { release_note_document?: unknown }).release_note_document,
      releaseNote.hash,
    )
  ));
  if (currentReviewed && editor.page?.slug === input.slug) return currentReviewed;

  const saved = await saveCampaignPublicPageDraft(ORG_ID, input.campaignId, {
    slug: input.slug,
    content: {
      label_line: "True Nature",
      title: input.title,
      release_note: releaseNote.plainText,
      release_note_document: releaseNote.document,
      artwork_asset_id: FIXTURE_IDS.artwork,
      focus_track_ids: [FIXTURE_IDS.track],
      listen_url: "https://example.test/fountain-listen",
      download_url: "https://example.test/fountain-download",
      metadata_url: "https://example.test/fountain-metadata",
      contact_name: "Release Gate Desk",
      contact_email: "radio@release-gate.example",
      network_statement: "Shared with our independent radio network.",
    },
  }, input.userId);
  return (await reviewCampaignPublicPageRevision(ORG_ID, input.campaignId, saved.revision.id, input.userId)).revision;
}

function campaignDocumentMatches(value: unknown, expectedHash: string): boolean {
  try {
    return deriveCampaignDocument(value, 20_000).hash === expectedHash;
  } catch {
    return false;
  }
}

async function ensureApprovedRadioDraft(
  revision: { id: string; version: number; content_hash: string },
  userId: string,
) {
  const expectedApprovalHash = hashDraftContent(RADIO_SUBJECT, RADIO_BODY_DOCUMENT.document);
  const approved = await db.select({
    id: campaign_outreach_drafts.id,
    subject: campaign_outreach_drafts.subject,
    body: campaign_outreach_drafts.body,
    body_document: campaign_outreach_drafts.body_document,
    context_snapshot: campaign_outreach_drafts.context_snapshot,
    approval_hash: campaign_outreach_drafts.approval_hash,
  })
    .from(campaign_outreach_drafts)
    .where(and(
      eq(campaign_outreach_drafts.org_id, ORG_ID),
      eq(campaign_outreach_drafts.campaign_id, FIXTURE_IDS.campaign),
      eq(campaign_outreach_drafts.scope, "radio_update"),
      eq(campaign_outreach_drafts.status, "approved"),
    ));
  if (approved.some((draft) => isExactApprovedRadioFixture(draft, revision.id, expectedApprovalHash))) return;

  const draft = await createManualRadioUpdateDraft(ORG_ID, FIXTURE_IDS.campaign, {
    page_revision_id: revision.id,
    subject: RADIO_SUBJECT,
    body: RADIO_BODY_DOCUMENT.plainText,
    body_document: RADIO_BODY_DOCUMENT.document,
  }, userId);
  await approveDraft(ORG_ID, draft.id, userId);
}

async function ensureFocusedDraft() {
  const focusedRows = await db.select({
    id: campaign_outreach_drafts.id,
    version: campaign_outreach_drafts.version,
  }).from(campaign_outreach_drafts).where(and(
    eq(campaign_outreach_drafts.org_id, ORG_ID),
    eq(campaign_outreach_drafts.campaign_id, FIXTURE_IDS.campaign),
    eq(campaign_outreach_drafts.lead_id, FIXTURE_IDS.lead),
    eq(campaign_outreach_drafts.scope, "focused"),
  ));
  const version = nextFixtureVersion(focusedRows, FIXTURE_IDS.focusedDraft);
  await db.execute(sql`
    update label_suite.campaign_outreach_drafts
    set status = ${"superseded"}, updated_at = now()
    where org_id = ${ORG_ID}
      and campaign_id = ${FIXTURE_IDS.campaign}
      and lead_id = ${FIXTURE_IDS.lead}
      and scope = ${"focused"}
      and id <> ${FIXTURE_IDS.focusedDraft}
      and status in (${"draft"}, ${"approved"})
  `);
  await db.execute(sql`
    insert into label_suite.campaign_outreach_drafts (
      id, org_id, campaign_id, lead_id, scope, version, status, subject,
      body, body_document, body_html, context_snapshot
    ) values (
      ${FIXTURE_IDS.focusedDraft}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${FIXTURE_IDS.lead},
      ${"focused"}, ${version}, ${"draft"}, ${"Fountain Edits — focused fixture"},
      ${FOCUSED_BODY_DOCUMENT.plainText}, ${JSON.stringify(FOCUSED_BODY_DOCUMENT.document)}::jsonb,
      ${FOCUSED_BODY_DOCUMENT.html},
      ${JSON.stringify({ fixture: "release-gate", scope: "focused", campaign_id: FIXTURE_IDS.campaign, lead_id: FIXTURE_IDS.lead })}::jsonb
    ) on conflict (id) do update set
      subject = excluded.subject,
      body = excluded.body,
      body_document = excluded.body_document,
      body_html = excluded.body_html,
      context_snapshot = excluded.context_snapshot,
      status = excluded.status,
      updated_at = now()
  `);
}

function nextFixtureVersion(rows: readonly { id: string; version: number }[], fixtureId: string): number {
  return rows.find((row) => row.id === fixtureId)?.version
    ?? Math.max(0, ...rows.map((row) => row.version)) + 1;
}

function isExactApprovedRadioFixture(
  draft: {
    subject: string | null;
    body: string | null;
    body_document: unknown;
    context_snapshot: unknown;
    approval_hash: string | null;
  },
  revisionId: string,
  expectedApprovalHash: string,
): boolean {
  if (snapshotPageRevisionId(draft.context_snapshot) !== revisionId || draft.subject !== RADIO_SUBJECT || draft.approval_hash !== expectedApprovalHash) return false;
  try {
    const document = deriveCampaignDocument(draft.body_document ?? draft.body ?? "", 10_000).document;
    return JSON.stringify(document) === JSON.stringify(RADIO_BODY_DOCUMENT.document)
      && hashDraftContent(draft.subject, document) === expectedApprovalHash;
  } catch {
    return false;
  }
}

function snapshotPageRevisionId(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = (snapshot as { page_revision_id?: unknown }).page_revision_id;
  return typeof value === "string" ? value : null;
}

async function ensureEditorAiRunFixtures(reviewedRevisionId: string) {
  const proposalDocument = deriveCampaignDocument(legacyTextToCampaignDocument("A deterministic release-gate proposal for operator review."), 20_000).document;
  const contextManifest = JSON.stringify({ campaign: { id: FIXTURE_IDS.campaign } });
  for (const run of [
    { id: FIXTURE_IDS.aiGoalRun, surface: "campaign_goal", leadId: null, draftId: null, revisionId: null, hash: GOAL_DOCUMENT.hash },
    { id: FIXTURE_IDS.aiFocusedRun, surface: "focused_outreach_body", leadId: FIXTURE_IDS.lead, draftId: FIXTURE_IDS.focusedDraft, revisionId: null, hash: FOCUSED_BODY_DOCUMENT.hash },
    { id: FIXTURE_IDS.aiPublicRun, surface: "public_release_note", leadId: null, draftId: null, revisionId: reviewedRevisionId, hash: RELEASE_NOTE_DOCUMENT.hash },
  ]) {
    await db.execute(sql`
      insert into label_suite.campaign_editor_ai_runs (
        id, org_id, campaign_id, surface, lead_id, draft_id, page_revision_id,
        operation, scope, input_document_hash, context_manifest, proposed_document,
        provider, model, rationale, citation_ids, status
      ) values (
        ${run.id}, ${ORG_ID}, ${FIXTURE_IDS.campaign}, ${run.surface}, ${run.leadId}, ${run.draftId}, ${run.revisionId},
        ${"improve"}, ${"document"}, ${run.hash}, ${contextManifest}::jsonb, ${JSON.stringify(proposalDocument)}::jsonb,
        ${"test"}, ${"release-gate-intercept"}, ${"Deterministic local release-gate proposal."}, ${JSON.stringify([])}::jsonb, ${"ready"}
      ) on conflict (id) do update set
        input_document_hash = excluded.input_document_hash,
        context_manifest = excluded.context_manifest,
        proposed_document = excluded.proposed_document,
        provider = excluded.provider,
        model = excluded.model,
        rationale = excluded.rationale,
        citation_ids = excluded.citation_ids,
        status = excluded.status,
        updated_at = now()
    `);
  }
}

async function ensureEventFixture() {
  await db.execute(sql`
    insert into label_suite.project_events (
      id,
      org_id,
      title,
      event_type,
      status,
      start_date,
      artist_id,
      release_id,
      all_day,
      is_confirmed,
      timezone,
      city,
      country_code,
      notes
    )
    values (
      ${FIXTURE_IDS.event},
      ${ORG_ID},
      ${"Release Gate Event"},
      ${"concert"},
      ${"planned"},
      ${"2026-08-15"},
      ${FIXTURE_IDS.artist},
      ${FIXTURE_IDS.release},
      ${true},
      ${false},
      ${"Europe/Copenhagen"},
      ${"Copenhagen"},
      ${"DK"},
      ${"Seeded for authenticated release-gate coverage."}
    )
    on conflict (id) do nothing
  `);
}

async function ensureAnalyticsDataHealthFixture() {
  const runId = "e2e-analytics-data-health-run";
  await db.execute(sql`
    insert into label_suite.analytics_import_runs (
      id, org_id, source, mode, requested_date_range, requested_aggregation,
      status, started_at, completed_at, files_downloaded, rows_imported, metadata
    ) values (
      ${runId}, ${ORG_ID}, ${"sisense"}, ${"sync"}, ${"All Dates"}, ${"Daily"},
      ${"completed"}, now(), now(), ${1}, ${1832},
      ${JSON.stringify({ completeness: { version: 1, expectedWidgetKeys: ["tracks"], downloadedWidgetKeys: ["tracks"], skippedWidgets: [], state: "complete" } })}::jsonb
    ) on conflict (id) do update set completed_at = excluded.completed_at, metadata = excluded.metadata
  `);
  await db.execute(sql`
    insert into label_suite.analytics_import_files (
      id, org_id, run_id, source, widget_key, requested_date_range, requested_aggregation,
      file_name, sha256, byte_size, row_count, storage_status
    ) values (
      ${"e2e-analytics-data-health-file"}, ${ORG_ID}, ${runId}, ${"sisense"}, ${"tracks"}, ${"All Dates"}, ${"Daily"},
      ${"release-gate-tracks.csv"}, ${"e".repeat(64)}, ${1832}, ${1832}, ${"not_requested"}
    ) on conflict (id) do update set run_id = excluded.run_id, row_count = excluded.row_count
  `);
  await db.execute(sql`
    insert into label_suite.analytics_metric_rows (
      id, org_id, source, widget_key, row_key, row_hash, requested_date_range,
      requested_aggregation, dimensions, metrics, raw_row, first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
    )
    select
      'e2e-analytics-' || lpad(series::text, 4, '0'), ${ORG_ID}, ${"sisense"}, ${"tracks"},
      'release-gate-row-' || series, md5('release-gate-row-' || series), ${"All Dates"}, ${"Daily"},
      jsonb_build_object('source_id', case when series in (1, 1832) then 'cross-batch-duplicate' else 'row-' || series end),
      '{}'::jsonb,
      jsonb_build_object('source_id', case when series in (1, 1832) then 'cross-batch-duplicate' else 'row-' || series end),
      ${runId}, ${runId}, now(), now()
    from generate_series(1, 1832) as series
    on conflict (org_id, source, widget_key, requested_aggregation, requested_date_range, row_key)
    do update set last_seen_run_id = excluded.last_seen_run_id, last_seen_at = excluded.last_seen_at
  `);
}

async function verifyMembership(userId: string) {
  const rows = await db.select({ id: org_memberships.id }).from(org_memberships).where(and(
    eq(org_memberships.org_id, ORG_ID),
    eq(org_memberships.user_id, userId),
  )).limit(1);

  if (!rows[0]) {
    throw new Error("Release-gate fixture user is missing True Nature membership.");
  }
}

async function main() {
  assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL,
    fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL,
    userPassword: process.env.E2E_USER_PASSWORD,
    ci: process.env.CI,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  const userId = await ensureFixtureUser();
  const readOnlyUserId = await ensureFixtureUser(READ_ONLY_FIXTURE_USER);
  await ensureTrueNatureOrg(userId);
  await ensureTrueNatureOrg(readOnlyUserId, "member");
  await verifyMembership(userId);
  await verifyMembership(readOnlyUserId);
  await ensureForeignTenantFixture(readOnlyUserId);
  await ensureCatalogFixtures();
  await ensureCampaignFixtures();
  const reviewedRevision = await ensureRadioUpdateFixtures(userId);
  await ensureCampaignActivityFixtures(userId);
  await ensureFocusedDraft();
  await ensureEditorAiRunFixtures(reviewedRevision.id);
  await ensureEventFixture();
  await ensureAnalyticsDataHealthFixture();

  console.log("[release-gate:seed] fixture user and records ready");
  console.log(JSON.stringify({
    userEmail: FIXTURE_USER.email,
    readOnlyUserEmail: READ_ONLY_FIXTURE_USER.email,
    artistId: FIXTURE_IDS.artist,
    releaseId: FIXTURE_IDS.release,
    eventId: FIXTURE_IDS.event,
    campaignId: FIXTURE_IDS.campaign,
    foreignTenantLeadId: FOREIGN_TENANT_FIXTURE.lead,
    stationId: FIXTURE_IDS.station,
  }));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("[release-gate:seed] failed", error);
    process.exit(1);
  });
