import { sql } from "drizzle-orm";
import { text, integer, real, timestamp, boolean, index, uniqueIndex, jsonb, check } from "drizzle-orm/pg-core";
import { labelSuiteSchema as schema } from "./_shared";
import { users } from "../auth-schema";
import { contacts, local_tool_tokens, orgs } from "./foundation";
import { artists, releases, tracks } from "./catalog";

// ─── DSP Pitches ────────────────────────────────────────
export const dsp_pitches = schema.table("dsp_pitches", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  release_id: text("release_id").references(() => releases.id),
  platform: text("platform"), // Spotify, Apple Music, etc.
  status: text("status").default("draft"), // draft, sent, responded, approved
  sent_date: timestamp("sent_date"),
  response: text("response"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("dsp_pitches_org_id_idx").on(table.org_id),
  index("dsp_pitches_release_id_idx").on(table.release_id),
  index("dsp_pitches_status_idx").on(table.status),
]);

export const dsp_pitch_releases = schema.table("dsp_pitch_releases", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  dsp_pitch_id: text("dsp_pitch_id").notNull().references(() => dsp_pitches.id),
  release_id: text("release_id").notNull().references(() => releases.id),
  airtable_base_id: text("airtable_base_id"),
  airtable_record_id: text("airtable_record_id"),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("dsp_pitch_releases_org_id_idx").on(table.org_id),
  index("dsp_pitch_releases_pitch_id_idx").on(table.dsp_pitch_id),
  index("dsp_pitch_releases_release_id_idx").on(table.release_id),
  uniqueIndex("dsp_pitch_releases_pitch_release_unique_idx").on(
    table.org_id,
    table.dsp_pitch_id,
    table.release_id,
  ),
]);

// ─── Bugs (Auto-validation) ─────────────────────────────
export const bugs = schema.table("bugs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  bug_key: text("bug_key"), // canonical dedup key
  source_table: text("source_table"),
  source_record_id: text("source_record_id"),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").default("P2"), // P0, P1, P2, P3
  status: text("status").default("logged"), // logged, triaged, in_progress, done
  auto_generated: boolean("auto_generated").default(false),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("bugs_org_id_idx").on(table.org_id),
  index("bugs_status_idx").on(table.status),
  index("bugs_source_record_idx").on(table.source_table, table.source_record_id),
  index("bugs_auto_generated_status_idx").on(table.auto_generated, table.status),
  uniqueIndex("bugs_bug_key_unique").on(table.org_id, table.bug_key).where(sql`${table.bug_key} is not null`),
]);

// ─── ISRC Sequences ─────────────────────────────────────
export const isrc_sequences = schema.table("isrc_sequences", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  year: integer("year").notNull(),
  last_production_number: integer("last_production_number").default(0),
  prefix: text("prefix").default("DKO7P"), // DK registrant code
}, (table) => [
  index("isrc_sequences_org_id_idx").on(table.org_id),
  uniqueIndex("isrc_sequences_year_unique").on(table.org_id, table.year),
]);

// ─── Radio Stations ─────────────────────────────────────
export const radio_stations = schema.table("radio_stations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  call_sign: text("call_sign"),
  frequency: text("frequency"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  email: text("email"),
  phone: text("phone"),
  website: text("website"),
  dj_name: text("dj_name"),
  tier: text("tier"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("radio_stations_org_id_idx").on(table.org_id),
  index("radio_stations_name_idx").on(table.name),
  uniqueIndex("radio_stations_call_sign_unique_idx").on(table.org_id, table.call_sign).where(sql`${table.call_sign} is not null`),
]);

export const campaign_audiences = schema.table("campaign_audiences", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  description: text("description"),
  membership_rules: jsonb("membership_rules").$type<{
    include_contact_roles: string[];
    exclude_contact_roles: string[];
    require_contact_email: boolean;
    exclude_contact_ids: string[];
    include_station_states: string[];
    exclude_station_states: string[];
    require_station_email: boolean;
    exclude_station_ids: string[];
  }>().default({
    include_contact_roles: [],
    exclude_contact_roles: [],
    require_contact_email: true,
    exclude_contact_ids: [],
    include_station_states: [],
    exclude_station_states: [],
    require_station_email: true,
    exclude_station_ids: [],
  }),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_audiences_org_id_idx").on(table.org_id),
  index("campaign_audiences_name_idx").on(table.name),
  uniqueIndex("campaign_audiences_org_name_unique_idx").on(table.org_id, table.name),
]);

export const campaign_audience_contacts = schema.table("campaign_audience_contacts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  audience_id: text("audience_id").notNull().references(() => campaign_audiences.id),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("campaign_audience_contacts_org_id_idx").on(table.org_id),
  index("campaign_audience_contacts_audience_id_idx").on(table.audience_id),
  index("campaign_audience_contacts_contact_id_idx").on(table.contact_id),
  uniqueIndex("campaign_audience_contacts_audience_contact_unique_idx").on(table.org_id, table.audience_id, table.contact_id),
]);

export const campaign_audience_stations = schema.table("campaign_audience_stations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  audience_id: text("audience_id").notNull().references(() => campaign_audiences.id),
  station_id: text("station_id").notNull().references(() => radio_stations.id),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("campaign_audience_stations_org_id_idx").on(table.org_id),
  index("campaign_audience_stations_audience_id_idx").on(table.audience_id),
  index("campaign_audience_stations_station_id_idx").on(table.station_id),
  uniqueIndex("campaign_audience_stations_audience_station_unique_idx").on(table.org_id, table.audience_id, table.station_id),
]);


// ─── Campaigns ──────────────────────────────────────────
export const campaigns = schema.table("campaigns", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_name: text("campaign_name").notNull(),
  linked_release_id: text("linked_release_id").references(() => releases.id),
  linked_artist_id: text("linked_artist_id").references(() => artists.id),
  campaign_type: text("campaign_type"),
  start_date: text("start_date"),
  end_date: text("end_date"),
  status: text("status").default("planning"),
  campaign_audience_id: text("campaign_audience_id").references(() => campaign_audiences.id),
  owner: text("owner"),
  goal: text("goal"),
  goal_document: jsonb("goal_document").$type<Record<string, unknown>>(),
  budget_planned: real("budget_planned"),
  budget_actual: real("budget_actual"),
  kpi_summary: text("kpi_summary"),
  notes: text("notes"),
  notes_document: jsonb("notes_document").$type<Record<string, unknown>>(),
  brief: text("brief"),
  brief_document: jsonb("brief_document").$type<Record<string, unknown>>(),
  final_report: text("final_report"),
  final_report_snapshot: jsonb("final_report_snapshot").$type<Record<string, unknown>>(),
  final_report_finalized_at: timestamp("final_report_finalized_at"),
  final_report_finalized_by: text("final_report_finalized_by").references(() => users.id, { onDelete: "set null" }),
  revision: integer("revision").notNull().default(1),
  performance_rating: integer("performance_rating"),
  main_platform: text("main_platform"),
  reviewed_template_id: text("reviewed_template_id").references(() => email_templates.id),
  content_channel: text("content_channel").default("email"),
  content_provider: text("content_provider").default("brevo"),
  content_operator_id: text("content_operator_id"),
  content_source_version: integer("content_source_version"),
  content_source_references: jsonb("content_source_references")
    .$type<{
      release_id: string | null;
      artist_id: string | null;
      document_ids: string[];
      media_asset_ids: string[];
    }>()
    .notNull()
    .default({
      release_id: null,
      artist_id: null,
      document_ids: [],
      media_asset_ids: [],
    }),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaigns_org_id_idx").on(table.org_id),
  index("campaigns_linked_release_id_idx").on(table.linked_release_id),
  index("campaigns_linked_artist_id_idx").on(table.linked_artist_id),
  index("campaigns_status_idx").on(table.status),
  index("campaigns_audience_idx").on(table.campaign_audience_id),
]);

export const creator_channels = schema.table("creator_channels", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  provider: text("provider").notNull(),
  provider_channel_id: text("provider_channel_id").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("creator_channels_org_id_idx").on(table.org_id),
  uniqueIndex("creator_channels_org_provider_identity_unique_idx").on(
    table.org_id,
    table.provider,
    table.provider_channel_id,
  ),
]);

export const campaign_discovery_runs = schema.table("campaign_discovery_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  estimated_cost_units: integer("estimated_cost_units").notNull(),
  queries: jsonb("queries").notNull(),
  channels: jsonb("channels").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("campaign_discovery_runs_org_campaign_idx").on(table.org_id, table.campaign_id),
  check("campaign_discovery_runs_status_check", sql`${table.status} in ('completed', 'partial', 'failed')`),
]);

export const campaign_discovery_reviews = schema.table("campaign_discovery_reviews", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  provider_channel_id: text("provider_channel_id").notNull(),
  state: text("state").notNull().default("unreviewed"),
  rejection_reason: text("rejection_reason"),
  revision: integer("revision").notNull().default(0),
  actor_user_id: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  promoted_lead_id: text("promoted_lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  promotion_outcome: text("promotion_outcome"),
  promoted_evidence: jsonb("promoted_evidence").notNull().default([]),
  decided_at: timestamp("decided_at"),
  history: jsonb("history").notNull().default([]),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("campaign_discovery_reviews_org_campaign_idx").on(table.org_id, table.campaign_id),
  index("campaign_discovery_reviews_org_channel_idx").on(table.org_id, table.provider, table.provider_channel_id),
  index("campaign_discovery_reviews_promoted_lead_idx").on(table.org_id, table.promoted_lead_id),
  uniqueIndex("campaign_discovery_reviews_campaign_channel_unique_idx").on(
    table.org_id,
    table.campaign_id,
    table.provider,
    table.provider_channel_id,
  ),
  check("campaign_discovery_reviews_state_check", sql`${table.state} in ('unreviewed', 'shortlisted', 'rejected', 'promoted')`),
  check("campaign_discovery_reviews_rejection_reason_check", sql`${table.rejection_reason} is null or ${table.rejection_reason} in ('wrong_music', 'wrong_format', 'inactive', 'insufficient_evidence', 'duplicate', 'unsuitable_contact_model')`),
  check("campaign_discovery_reviews_promotion_outcome_check", sql`${table.promotion_outcome} is null or ${table.promotion_outcome} in ('created', 'existing')`),
]);

export const campaign_territories = schema.table("campaign_territories", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  country_code: text("country_code").notNull(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("campaign_territories_org_id_idx").on(table.org_id),
  index("campaign_territories_campaign_id_idx").on(table.campaign_id),
  uniqueIndex("campaign_territories_org_campaign_country_unique_idx").on(table.org_id, table.campaign_id, table.country_code),
  check("campaign_territories_country_code_check", sql`${table.country_code} ~ '^[A-Z]{2}$'`),
]);

export const campaign_creator_engagements = schema.table("campaign_creator_engagements", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  contact_id: text("contact_id").notNull().references(() => contacts.id),
  status: text("status").notNull().default("identified"),
  relationship_notes: text("relationship_notes"),
  outreach_channel: text("outreach_channel").notNull().default("email"),
  outreach_permission_status: text("outreach_permission_status").notNull().default("unknown"),
  outreach_permission_basis: text("outreach_permission_basis"),
  outreach_permission_recorded_at: timestamp("outreach_permission_recorded_at"),
  outreach_permission_revoked_at: timestamp("outreach_permission_revoked_at"),
  agreed_rate: real("agreed_rate"),
  agreed_currency: text("agreed_currency"),
  budget_line_id: text("budget_line_id"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_creator_engagements_org_id_idx").on(table.org_id),
  index("campaign_creator_engagements_campaign_id_idx").on(table.org_id, table.campaign_id),
  index("campaign_creator_engagements_contact_id_idx").on(table.org_id, table.contact_id),
  index("campaign_creator_engagements_budget_line_id_idx").on(table.budget_line_id),
  uniqueIndex("campaign_creator_engagements_org_campaign_contact_unique_idx").on(table.org_id, table.campaign_id, table.contact_id),
  check("campaign_creator_engagements_status_check", sql`${table.status} in ('identified', 'qualified', 'permission_confirmed', 'contacted', 'negotiating', 'agreed', 'delivering', 'complete', 'declined', 'not_a_fit')`),
  check("campaign_creator_engagements_permission_check", sql`${table.outreach_permission_status} in ('unknown', 'permitted', 'revoked', 'do_not_contact')`),
  check("campaign_creator_engagements_rate_check", sql`${table.agreed_rate} is null or ${table.agreed_rate} >= 0`),
]);

export const campaign_creator_deliverables = schema.table("campaign_creator_deliverables", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  engagement_id: text("engagement_id").notNull().references(() => campaign_creator_engagements.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  due_date: timestamp("due_date"),
  approval_status: text("approval_status").notNull().default("pending"),
  evidence_url: text("evidence_url"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_creator_deliverables_org_id_idx").on(table.org_id),
  index("campaign_creator_deliverables_engagement_id_idx").on(table.org_id, table.engagement_id),
  check("campaign_creator_deliverables_approval_check", sql`${table.approval_status} in ('pending', 'approved', 'changes_requested', 'rejected')`),
]);

export const campaign_posts = schema.table("campaign_posts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  engagement_id: text("engagement_id").references(() => campaign_creator_engagements.id, { onDelete: "set null" }),
  url: text("url").notNull(),
  platform: text("platform").notNull(),
  published_at: timestamp("published_at"),
  metrics_captured_at: timestamp("metrics_captured_at").notNull().defaultNow(),
  manual_metrics: jsonb("manual_metrics").$type<Record<string, number>>().notNull().default({}),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_posts_org_id_idx").on(table.org_id),
  index("campaign_posts_campaign_id_idx").on(table.org_id, table.campaign_id),
  index("campaign_posts_engagement_id_idx").on(table.engagement_id),
]);

// ─── Campaign Stations (join table) ─────────────────────
export const campaign_stations = schema.table("campaign_stations", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").references(() => campaigns.id),
  station_id: text("station_id").references(() => radio_stations.id),
  status: text("status").default("pending"),
  last_contacted_at: timestamp("last_contacted_at"),
  follow_up_at: timestamp("follow_up_at"),
  feedback: text("feedback"),
  priority: text("priority").default("medium"),
  pitch_angle: text("pitch_angle"),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_stations_org_id_idx").on(table.org_id),
  index("campaign_stations_campaign_id_idx").on(table.campaign_id),
  index("campaign_stations_station_id_idx").on(table.station_id),
  index("campaign_stations_status_idx").on(table.status),
  index("campaign_stations_follow_up_at_idx").on(table.follow_up_at),
  uniqueIndex("campaign_stations_pair_unique_idx").on(table.org_id, table.campaign_id, table.station_id),
]);

// ─── Campaign earned-media workspace ──────────────────
export const campaign_sources = schema.table("campaign_sources", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  source_key: text("source_key").notNull(),
  source_type: text("source_type").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  external_id: text("external_id"),
  authorization_note: text("authorization_note"),
  notes: text("notes"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_sources_org_id_idx").on(table.org_id),
  index("campaign_sources_campaign_id_idx").on(table.campaign_id),
  uniqueIndex("campaign_sources_org_campaign_key_unique_idx").on(table.org_id, table.campaign_id, table.source_key),
]);

export const campaign_leads = schema.table("campaign_leads", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  source_id: text("source_id").references(() => campaign_sources.id, { onDelete: "set null" }),
  contact_id: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  station_id: text("station_id").references(() => radio_stations.id, { onDelete: "set null" }),
  exact_edit_track_id: text("exact_edit_track_id").references(() => tracks.id, { onDelete: "set null" }),
  dedupe_key: text("dedupe_key").notNull(),
  target_name: text("target_name").notNull(),
  target_type: text("target_type").notNull(),
  target_url: text("target_url"),
  contact_route: text("contact_route"),
  contact_route_verified_at: timestamp("contact_route_verified_at"),
  discovery_source: text("discovery_source").notNull(),
  recommending_person: text("recommending_person"),
  introduction_available: boolean("introduction_available"),
  musical_fit: text("musical_fit"),
  relationship_warmth: integer("relationship_warmth").notNull().default(0),
  editorial_fit: integer("editorial_fit").notNull().default(0),
  useful_reach: integer("useful_reach").notNull().default(0),
  direct_free_access: integer("direct_free_access").notNull().default(0),
  pipeline_stage: text("pipeline_stage").notNull().default("identified"),
  pitch_angle: text("pitch_angle"),
  last_contacted_at: timestamp("last_contacted_at"),
  follow_up_at: timestamp("follow_up_at"),
  outcome: text("outcome"),
  evidence_url: text("evidence_url"),
  published_at: timestamp("published_at"),
  notes: text("notes"),
  readiness_task_waiver_reason: text("readiness_task_waiver_reason"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_leads_org_id_idx").on(table.org_id),
  index("campaign_leads_campaign_id_idx").on(table.campaign_id),
  index("campaign_leads_stage_idx").on(table.org_id, table.campaign_id, table.pipeline_stage),
  index("campaign_leads_follow_up_idx").on(table.org_id, table.follow_up_at),
  index("campaign_leads_station_id_idx").on(table.station_id),
  index("campaign_leads_contact_id_idx").on(table.contact_id),
  uniqueIndex("campaign_leads_org_campaign_dedupe_unique_idx").on(table.org_id, table.campaign_id, table.dedupe_key),
  check("campaign_leads_target_type_check", sql`${table.target_type} in ('radio_station', 'radio_show', 'youtube_channel', 'editorial', 'community', 'premiere', 'guest_mix', 'other')`),
  check("campaign_leads_pipeline_stage_check", sql`${table.pipeline_stage} in ('identified', 'qualified', 'ready', 'sent', 'responded', 'confirmed', 'published', 'nurture')`),
  check("campaign_leads_relationship_warmth_check", sql`${table.relationship_warmth} between 0 and 3`),
  check("campaign_leads_editorial_fit_check", sql`${table.editorial_fit} between 0 and 3`),
  check("campaign_leads_useful_reach_check", sql`${table.useful_reach} between 0 and 2`),
  check("campaign_leads_direct_free_access_check", sql`${table.direct_free_access} between 0 and 2`),
]);

export const campaign_dogfood_entries = schema.table("campaign_dogfood_entries", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  entry_type: text("entry_type").notNull(),
  severity: text("severity").notNull().default("P2"),
  title: text("title").notNull(),
  details: text("details"),
  ui_surface: text("ui_surface"),
  status: text("status").notNull().default("logged"),
  evidence_url: text("evidence_url"),
  linked_lead_id: text("linked_lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  linked_draft_id: text("linked_draft_id").references(() => campaign_outreach_drafts.id, { onDelete: "set null" }),
  linked_enrichment_run_id: text("linked_enrichment_run_id").references(() => campaign_enrichment_runs.id, { onDelete: "set null" }),
  linked_page_revision_id: text("linked_page_revision_id").references(() => campaign_public_page_revisions.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_dogfood_entries_org_id_idx").on(table.org_id),
  index("campaign_dogfood_entries_campaign_id_idx").on(table.campaign_id),
  index("campaign_dogfood_entries_status_idx").on(table.org_id, table.campaign_id, table.status),
  index("campaign_dogfood_entries_linked_lead_id_idx").on(table.linked_lead_id),
  index("campaign_dogfood_entries_linked_draft_id_idx").on(table.linked_draft_id),
  index("campaign_dogfood_entries_linked_enrichment_run_id_idx").on(table.linked_enrichment_run_id),
  index("campaign_dogfood_entries_linked_page_revision_id_idx").on(table.linked_page_revision_id),
  check("campaign_dogfood_entries_type_check", sql`${table.entry_type} in ('bug', 'friction', 'missing_field', 'improvement')`),
  check("campaign_dogfood_entries_severity_check", sql`${table.severity} in ('P0', 'P1', 'P2', 'P3')`),
  check("campaign_dogfood_entries_status_check", sql`${table.status} in ('logged', 'triaged', 'in_progress', 'fixed', 'wont_fix')`),
]);

export const CAMPAIGN_RESEARCH_STATUSES = ["running", "completed", "failed", "refused"] as const;
export const CAMPAIGN_SUGGESTION_STATUSES = ["pending", "accepted", "rejected", "superseded"] as const;
export const CAMPAIGN_DRAFT_STATUSES = ["draft", "approved", "superseded"] as const;

export const campaign_communicator_prompts = schema.table("campaign_communicator_prompts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  prompt: text("prompt").notNull(),
  created_by: text("created_by").references(() => users.id, { onDelete: "set null" }),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_communicator_prompts_org_id_idx").on(table.org_id),
  index("campaign_communicator_prompts_campaign_id_idx").on(table.campaign_id),
  uniqueIndex("campaign_communicator_prompts_org_campaign_version_unique_idx").on(table.org_id, table.campaign_id, table.version),
]);

export const campaign_enrichment_claims = schema.table("campaign_enrichment_claims", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").notNull().references(() => campaign_leads.id, { onDelete: "cascade" }),
  token_id: text("token_id").notNull().references(() => local_tool_tokens.id),
  user_id: text("user_id").notNull().references(() => users.id),
  claimed_at: timestamp("claimed_at").notNull().defaultNow(),
  renewed_at: timestamp("renewed_at"),
  expires_at: timestamp("expires_at").notNull(),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("campaign_enrichment_claims_org_lead_unique_idx").on(table.org_id, table.lead_id),
  index("campaign_enrichment_claims_org_campaign_idx").on(table.org_id, table.campaign_id),
  index("campaign_enrichment_claims_token_id_idx").on(table.token_id),
  index("campaign_enrichment_claims_expires_at_idx").on(table.expires_at),
]);

export const campaign_enrichment_runs = schema.table("campaign_enrichment_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").notNull().references(() => campaign_leads.id, { onDelete: "cascade" }),
  prompt_id: text("prompt_id").references(() => campaign_communicator_prompts.id, { onDelete: "set null" }),
  status: text("status").notNull().default("running"),
  source_kind: text("source_kind").$type<"in_app_provider" | "codex_mcp">().notNull().default("in_app_provider"),
  submitted_by_user_id: text("submitted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  local_tool_token_id: text("local_tool_token_id").references(() => local_tool_tokens.id, { onDelete: "set null" }),
  expected_lead_revision: text("expected_lead_revision"),
  idempotency_key: text("idempotency_key"),
  submission_hash: text("submission_hash"),
  client_metadata: jsonb("client_metadata").$type<Record<string, unknown>>().notNull().default({}),
  started_at: timestamp("started_at").defaultNow(),
  completed_at: timestamp("completed_at"),
  failure_reason: text("failure_reason"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_enrichment_runs_org_id_idx").on(table.org_id),
  index("campaign_enrichment_runs_campaign_id_idx").on(table.campaign_id),
  index("campaign_enrichment_runs_lead_id_idx").on(table.lead_id),
  uniqueIndex("campaign_enrichment_runs_org_lead_running_unique_idx")
    .on(table.org_id, table.lead_id)
    .where(sql`${table.status} = 'running'`),
  uniqueIndex("campaign_enrichment_runs_local_tool_idempotency_unique_idx")
    .on(table.org_id, table.source_kind, table.idempotency_key)
    .where(sql`${table.idempotency_key} is not null`),
  check("campaign_enrichment_runs_status_check", sql`${table.status} in ('running', 'completed', 'failed', 'refused')`),
  check("campaign_enrichment_runs_source_kind_check", sql`${table.source_kind} in ('in_app_provider', 'codex_mcp')`),
  check("campaign_enrichment_runs_expected_lead_revision_check", sql`${table.expected_lead_revision} is null or ${table.expected_lead_revision} ~ '^[a-f0-9]{64}$'`),
  check("campaign_enrichment_runs_submission_hash_check", sql`${table.submission_hash} is null or ${table.submission_hash} ~ '^[a-f0-9]{64}$'`),
]);

export const campaign_enrichment_suggestions = schema.table("campaign_enrichment_suggestions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").notNull().references(() => campaign_leads.id, { onDelete: "cascade" }),
  enrichment_run_id: text("enrichment_run_id").notNull().references(() => campaign_enrichment_runs.id, { onDelete: "cascade" }),
  suggestion_type: text("suggestion_type").notNull(),
  suggested_value: jsonb("suggested_value").$type<Record<string, unknown>>().notNull(),
  evidence: jsonb("evidence").$type<Array<{
    title: string;
    url: string;
    retrieved_at: string;
    citation_text: string;
  }>>().notNull().default([]),
  status: text("status").notNull().default("pending"),
  resolved_by: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolved_at: timestamp("resolved_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_enrichment_suggestions_org_id_idx").on(table.org_id),
  index("campaign_enrichment_suggestions_campaign_id_idx").on(table.campaign_id),
  index("campaign_enrichment_suggestions_lead_id_idx").on(table.lead_id),
  index("campaign_enrichment_suggestions_run_id_idx").on(table.enrichment_run_id),
  check("campaign_enrichment_suggestions_status_check", sql`${table.status} in ('pending', 'accepted', 'rejected', 'superseded')`),
]);

export const campaign_outreach_drafts = schema.table("campaign_outreach_drafts", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  enrichment_run_id: text("enrichment_run_id").references(() => campaign_enrichment_runs.id, { onDelete: "set null" }),
  scope: text("scope").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  subject: text("subject"),
  body: text("body").notNull(),
  body_document: jsonb("body_document").$type<Record<string, unknown>>(),
  body_html: text("body_html"),
  context_snapshot: jsonb("context_snapshot").$type<Record<string, unknown>>().notNull(),
  approval_hash: text("approval_hash"),
  approved_by: text("approved_by").references(() => users.id, { onDelete: "set null" }),
  approved_at: timestamp("approved_at"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_outreach_drafts_org_id_idx").on(table.org_id),
  index("campaign_outreach_drafts_campaign_id_idx").on(table.campaign_id),
  index("campaign_outreach_drafts_lead_id_idx").on(table.lead_id),
  uniqueIndex("campaign_outreach_drafts_org_lead_version_unique_idx").on(table.org_id, table.lead_id, table.version),
  uniqueIndex("campaign_outreach_drafts_org_campaign_scope_version_without_lead_unique_idx")
    .on(table.org_id, table.campaign_id, table.scope, table.version)
    .where(sql`${table.lead_id} is null`),
  check("campaign_outreach_drafts_scope_check", sql`${table.scope} in ('focused', 'radio_update')`),
  check("campaign_outreach_drafts_status_check", sql`${table.status} in ('draft', 'approved', 'superseded')`),
]);

export const campaign_outreach_events = schema.table("campaign_outreach_events", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  draft_id: text("draft_id").references(() => campaign_outreach_drafts.id, { onDelete: "set null" }),
  event_type: text("event_type").notNull(),
  actor_user_id: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  occurred_at: timestamp("occurred_at").notNull().defaultNow(),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_outreach_events_org_id_idx").on(table.org_id),
  index("campaign_outreach_events_campaign_id_idx").on(table.campaign_id),
  index("campaign_outreach_events_lead_id_idx").on(table.lead_id),
  index("campaign_outreach_events_draft_id_idx").on(table.draft_id),
  index("campaign_outreach_events_occurred_at_idx").on(table.org_id, table.occurred_at),
]);

export const campaign_activity_proposal_decisions = schema.table("campaign_activity_proposal_decisions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  lead_id: text("lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  proposal_key: text("proposal_key").notNull(),
  rule_key: text("rule_key").notNull(),
  rule_version: integer("rule_version").notNull(),
  decision: text("decision").notNull(),
  reason: text("reason"),
  decided_by: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decided_at: timestamp("decided_at").notNull().defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("campaign_activity_proposal_decisions_org_campaign_proposal_unique_idx").on(table.org_id, table.campaign_id, table.proposal_key),
  index("campaign_activity_proposal_decisions_campaign_id_idx").on(table.org_id, table.campaign_id),
  index("campaign_activity_proposal_decisions_lead_id_idx").on(table.org_id, table.lead_id),
  index("campaign_activity_proposal_decisions_decision_idx").on(table.org_id, table.campaign_id, table.decision),
  check("campaign_activity_proposal_decisions_decision_check", sql`${table.decision} in ('dismissed', 'resolved')`),
]);

// ─── Campaign public radio update pages ─────────────────
export const campaign_public_pages = schema.table("campaign_public_pages", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("draft"),
  // The cyclic revision pointers are added by migration 0068 after both tables exist.
  current_draft_revision_id: text("current_draft_revision_id"),
  current_published_revision_id: text("current_published_revision_id"),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_public_pages_org_id_idx").on(table.org_id),
  index("campaign_public_pages_campaign_id_idx").on(table.campaign_id),
  index("campaign_public_pages_status_idx").on(table.org_id, table.status),
  uniqueIndex("campaign_public_pages_org_campaign_unique_idx").on(table.org_id, table.campaign_id),
  uniqueIndex("campaign_public_pages_slug_unique_idx").on(table.slug),
  check(
    "campaign_public_pages_slug_canonical_check",
    sql`${table.slug} <> '' and ${table.slug} = regexp_replace(regexp_replace(lower(trim(${table.slug})), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')`,
  ),
  check("campaign_public_pages_status_check", sql`${table.status} in ('draft', 'published', 'unpublished')`),
]);

export const campaign_public_page_revisions = schema.table("campaign_public_page_revisions", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  // The cyclic page foreign key is represented in migration 0068.
  page_id: text("page_id").notNull(),
  version: integer("version").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  source_snapshot: jsonb("source_snapshot").$type<Record<string, unknown>>().notNull(),
  author_id: text("author_id").references(() => users.id, { onDelete: "set null" }),
  authored_at: timestamp("authored_at").notNull().defaultNow(),
  reviewer_id: text("reviewer_id").references(() => users.id, { onDelete: "set null" }),
  reviewed_at: timestamp("reviewed_at"),
  review_status: text("review_status").notNull().default("draft"),
  content_hash: text("content_hash").notNull(),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("campaign_public_page_revisions_org_id_idx").on(table.org_id),
  index("campaign_public_page_revisions_page_id_idx").on(table.page_id),
  index("campaign_public_page_revisions_review_status_idx").on(table.org_id, table.review_status),
  uniqueIndex("campaign_public_page_revisions_page_id_id_unique_idx").on(table.page_id, table.id),
  uniqueIndex("campaign_public_page_revisions_org_page_version_unique_idx").on(table.org_id, table.page_id, table.version),
  check("campaign_public_page_revisions_version_check", sql`${table.version} > 0`),
  check("campaign_public_page_revisions_review_status_check", sql`${table.review_status} in ('draft', 'reviewed', 'superseded')`),
]);

export const campaign_editor_ai_runs = schema.table("campaign_editor_ai_runs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  surface: text("surface").notNull(),
  lead_id: text("lead_id").references(() => campaign_leads.id, { onDelete: "set null" }),
  draft_id: text("draft_id").references(() => campaign_outreach_drafts.id, { onDelete: "set null" }),
  page_revision_id: text("page_revision_id").references(() => campaign_public_page_revisions.id, { onDelete: "set null" }),
  operation: text("operation").notNull(),
  scope: text("scope").notNull(),
  selection_from: integer("selection_from"),
  selection_to: integer("selection_to"),
  input_document_hash: text("input_document_hash").notNull(),
  context_manifest: jsonb("context_manifest").$type<Record<string, unknown>>().notNull(),
  proposed_document: jsonb("proposed_document").$type<Record<string, unknown>>(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  rationale: text("rationale"),
  citation_ids: jsonb("citation_ids").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("running"),
  failure_category: text("failure_category"),
  decided_by: text("decided_by").references(() => users.id, { onDelete: "set null" }),
  decided_at: timestamp("decided_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("campaign_editor_ai_runs_org_id_idx").on(table.org_id),
  index("campaign_editor_ai_runs_campaign_id_idx").on(table.campaign_id),
  index("campaign_editor_ai_runs_org_campaign_status_idx").on(table.org_id, table.campaign_id, table.status),
  index("campaign_editor_ai_runs_lead_id_idx").on(table.lead_id),
  index("campaign_editor_ai_runs_draft_id_idx").on(table.draft_id),
  index("campaign_editor_ai_runs_page_revision_id_idx").on(table.page_revision_id),
  check("campaign_editor_ai_runs_surface_check", sql`${table.surface} in ('campaign_goal', 'campaign_notes', 'public_release_note', 'focused_outreach_body', 'radio_update_body')`),
  check("campaign_editor_ai_runs_operation_check", sql`${table.operation} in ('draft', 'enrich', 'improve', 'shorten', 'tone', 'custom')`),
  check("campaign_editor_ai_runs_scope_check", sql`${table.scope} in ('selection', 'document')`),
  check("campaign_editor_ai_runs_status_check", sql`${table.status} in ('running', 'ready', 'accepted', 'rejected', 'failed', 'stale')`),
]);

// ─── Email Templates ───────────────────────────────────
export const email_templates = schema.table("email_templates", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  description: text("description"),
  channel: text("channel").notNull().default("email"),
  current_version: integer("current_version").notNull().default(1),
  review_status: text("review_status").notNull().default("draft"),
  reviewed_at: timestamp("reviewed_at"),
  reviewed_by: text("reviewed_by"),
  source_version: integer("source_version"),
  source_references: jsonb("source_references")
    .$type<{
      release_id: string | null;
      artist_id: string | null;
      document_ids: string[];
      media_asset_ids: string[];
    }>()
    .notNull()
    .default({
      release_id: null,
      artist_id: null,
      document_ids: [],
      media_asset_ids: [],
    }),
  is_default: boolean("is_default").default(false),
  created_at: timestamp("created_at").defaultNow(),
  updated_at: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("email_templates_org_id_idx").on(table.org_id),
]);

// ─── Email Logs ────────────────────────────────────────
export const email_logs = schema.table("email_logs", {
  id: text("id").primaryKey(),
  org_id: text("org_id").notNull().default("true-nature").references(() => orgs.id),
  campaign_id: text("campaign_id").references(() => campaigns.id),
  station_id: text("station_id").references(() => radio_stations.id),
  template_id: text("template_id").references(() => email_templates.id),
  subject: text("subject").notNull(),
  body: text("body"),
  status: text("status").notNull().default("sent"), // sent, failed
  provider: text("provider").notNull().default("brevo"),
  operator_id: text("operator_id").references(() => users.id),
  sender_email: text("sender_email"),
  error_message: text("error_message"),
  brevo_message_id: text("brevo_message_id"),
  sent_at: timestamp("sent_at").defaultNow(),
  created_at: timestamp("created_at").defaultNow(),
}, (table) => [
  index("email_logs_org_id_idx").on(table.org_id),
  index("email_logs_campaign_id_idx").on(table.campaign_id),
  index("email_logs_station_id_idx").on(table.station_id),
  index("email_logs_provider_idx").on(table.provider),
  index("email_logs_operator_id_idx").on(table.operator_id),
  index("email_logs_status_idx").on(table.status),
]);
