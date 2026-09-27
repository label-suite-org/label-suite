import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import {
  campaign_activity_proposal_decisions,
  campaign_creator_deliverables,
  campaign_creator_engagements,
  campaign_dogfood_entries,
  campaign_leads,
  campaign_outreach_drafts,
  campaign_public_page_revisions,
  campaign_public_pages,
  campaign_posts,
  campaign_territories,
} from "./schema";

const EXPECTED_TABLE_EXPORTS = [
  "CAMPAIGN_DRAFT_STATUSES",
  "CAMPAIGN_RESEARCH_STATUSES",
  "CAMPAIGN_SUGGESTION_STATUSES",
  "airtable_record_mappings",
  "analytics_duplicate_reviews",
  "analytics_import_files",
  "analytics_import_runs",
  "analytics_metric_changes",
  "analytics_metric_rows",
  "artists",
  "artist_portals",
  "artist_portal_submissions",
  "audit_events",
  "audit_logs",
  "campaign_activity_proposal_decisions",
  "campaign_creator_deliverables",
  "campaign_creator_engagements",
  "campaign_audience_contacts",
  "campaign_audience_stations",
  "campaign_audiences",
  "campaign_dogfood_entries",
  "campaign_enrichment_claims",
  "campaign_communicator_prompts",
  "campaign_discovery_reviews",
  "campaign_discovery_runs",
  "campaign_enrichment_runs",
  "campaign_editor_ai_runs",
  "campaign_enrichment_suggestions",
  "campaign_outreach_drafts",
  "campaign_outreach_events",
  "campaign_leads",
  "campaign_public_page_revisions",
  "campaign_public_pages",
  "campaign_posts",
  "campaign_sources",
  "campaign_territories",
  "budget_categories",
  "budget_line_documents",
  "budget_line_items",
  "budget_line_variance_requests",
  "budget_projects",
  "bugs",
  "calls",
  "calendar_connections",
  "calendar_event_links",
  "calendar_releases",
  "campaign_stations",
  "campaigns",
  "catalog_entries",
  "contact_enrichment_suggestions",
  "contact_organizations",
  "contacts",
  "creator_channels",
  "dashboard_preferences",
  "data_quality_issues",
  "documents",
  "finance_transaction_matches",
  "finance_transactions",
  "dsp_pitch_releases",
  "dsp_pitches",
  "email_logs",
  "email_templates",
  "external_object_links",
  "funding_need_budget_lines",
  "funding_needs",
  "funding_source_events",
  "funding_sources",
  "gmail_connections",
  "grant_application_calls",
  "grant_application_documents",
  "grant_application_events",
  "grant_application_funding_needs",
  "grant_application_requirements",
  "grant_applications",
  "grant_deadlines",
  "grant_document_extractions",
  "grant_requirements",
  "grants",
  "integration_connections",
  "integration_errors",
  "integration_providers",
  "isrc_sequences",
  "job_attempts",
  "job_runs",
  "job_workers",
  "local_tool_tokens",
  "resource_upload_intents",
  "media_asset_files",
  "media_assets",
  "notification_deliveries",
  "notification_device_attempts",
  "notification_devices",
  "notification_intents",
  "notification_preferences",
  "notification_source_receipts",
  "ops_tasks",
  "org_invitations",
  "org_memberships",
  "organizations",
  "orgs",
  "project_artists",
  "project_contacts",
  "project_events",
  "project_funding_profiles",
  "project_import_runs",
  "project_organizations",
  "project_source_records",
  "radio_stations",
  "raw_integration_events",
  "release_milestones",
  "release_reporting",
  "release_delivery_attempts",
  "releases",
  "reporting_weeks",
  "roles",
  "royalties_revenue",
  "royalty_calculation_runs",
  "royalty_earnings",
  "royalty_import_currency_totals",
  "royalty_imports",
  "royalty_ledger_entries",
  "royalty_ledger_transactions",
  "royalty_payouts",
  "royalty_split_lines",
  "royalty_split_snapshots",
  "royalty_statement_lines",
  "royalty_statements",
  "samply_comment_links",
  "samply_connections",
  "samply_events",
  "samply_files",
  "samply_players",
  "samply_projects",
  "side_artists",
  "sync_jobs",
  "tour_deal_terms",
  "tour_details",
  "tour_lodging",
  "tour_show_details",
  "tour_travel_legs",
  "tracks",
  "works",
] as const;

describe("domain schema export contract", () => {
  it("preserves the complete public table set", () => {
    expect(Object.keys(schema).sort()).toEqual([...EXPECTED_TABLE_EXPORTS].sort());
  });

  it("exports the campaign-scoped Creator Engagement and manual post records", () => {
    expect(campaign_creator_engagements.outreach_permission_basis).toBeDefined();
    expect(campaign_creator_deliverables.approval_status).toBeDefined();
    expect(campaign_posts.manual_metrics).toBeDefined();
    expect(campaign_territories.country_code).toBeDefined();
  });

  it("exports campaign lead contact-route verification", () => {
    expect(campaign_leads.contact_route_verified_at).toBeDefined();
  });

  it("exports the local-tool governance tables and run provenance", () => {
    expect(schema.local_tool_tokens).toBeDefined();
    expect(schema.campaign_enrichment_claims).toBeDefined();

    for (const column of [
      "id",
      "org_id",
      "user_id",
      "name",
      "token_prefix",
      "secret_hash",
      "scopes",
      "expires_at",
      "revoked_at",
      "last_used_at",
      "created_at",
      "updated_at",
    ] as const) {
      expect(schema.local_tool_tokens[column]).toBeDefined();
    }

    for (const column of [
      "id",
      "org_id",
      "campaign_id",
      "lead_id",
      "token_id",
      "user_id",
      "claimed_at",
      "renewed_at",
      "expires_at",
      "created_at",
      "updated_at",
    ] as const) {
      expect(schema.campaign_enrichment_claims[column]).toBeDefined();
    }

    for (const column of [
      "source_kind",
      "submitted_by_user_id",
      "local_tool_token_id",
      "expected_lead_revision",
      "idempotency_key",
      "submission_hash",
      "client_metadata",
    ] as const) {
      expect(schema.campaign_enrichment_runs[column]).toBeDefined();
    }
  });

  it("exports discovery promotion provenance on review records", () => {
    expect(schema.campaign_discovery_reviews.promoted_lead_id).toBeDefined();
    expect(schema.campaign_discovery_reviews.promotion_outcome).toBeDefined();
    expect(schema.campaign_discovery_reviews.promoted_evidence).toBeDefined();
  });

  it("models one claim per tenant lead and idempotent local-tool runs", () => {
    expect(schema.campaign_enrichment_claims).toBeDefined();
    const claimIndex = getTableConfig(schema.campaign_enrichment_claims).indexes.find(
      (index) => index.config.name === "campaign_enrichment_claims_org_lead_unique_idx",
    );
    expect(claimIndex?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "org_id" }),
        expect.objectContaining({ name: "lead_id" }),
      ],
      unique: true,
    });

    const runIndex = getTableConfig(schema.campaign_enrichment_runs).indexes.find(
      (index) => index.config.name === "campaign_enrichment_runs_local_tool_idempotency_unique_idx",
    );
    expect(runIndex?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "org_id" }),
        expect.objectContaining({ name: "source_kind" }),
        expect.objectContaining({ name: "idempotency_key" }),
      ],
      unique: true,
      where: expect.anything(),
    });
  });

  it("exports tenant-scoped campaign activity proposal decisions", () => {
    const config = getTableConfig(campaign_activity_proposal_decisions);
    expect(config.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ config: expect.objectContaining({
        name: "campaign_activity_proposal_decisions_org_campaign_proposal_unique_idx",
        unique: true,
      }) }),
      expect.objectContaining({ config: expect.objectContaining({
        name: "campaign_activity_proposal_decisions_lead_id_idx",
      }) }),
    ]));
    expect(config.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "campaign_activity_proposal_decisions_decision_check" }),
    ]));
  });

  it("keeps lead-less radio-update draft versions unique per campaign", () => {
    const nullLeadVersionIndex = getTableConfig(campaign_outreach_drafts).indexes.find(
      (index) => index.config.name === "campaign_outreach_drafts_org_campaign_scope_version_without_lead_unique_idx",
    );

    expect(nullLeadVersionIndex?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "org_id" }),
        expect.objectContaining({ name: "campaign_id" }),
        expect.objectContaining({ name: "scope" }),
        expect.objectContaining({ name: "version" }),
      ],
      unique: true,
      where: expect.anything(),
    });
  });

  it("exports versioned public radio update storage", () => {
    expect(campaign_public_pages.current_published_revision_id).toBeDefined();
    expect(campaign_public_pages.current_draft_revision_id).toBeDefined();
    expect(campaign_public_page_revisions.content).toBeDefined();
    expect(campaign_public_page_revisions.source_snapshot).toBeDefined();
    expect(campaign_public_page_revisions.content_hash).toBeDefined();
    expect(campaign_dogfood_entries.linked_page_revision_id).toBeDefined();

    const pageIndexes = getTableConfig(campaign_public_pages).indexes;
    expect(pageIndexes.find((index) => index.config.name === "campaign_public_pages_org_campaign_unique_idx")?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "org_id" }),
        expect.objectContaining({ name: "campaign_id" }),
      ],
      unique: true,
    });
    expect(pageIndexes.find((index) => index.config.name === "campaign_public_pages_slug_unique_idx")?.config).toMatchObject({
      columns: [expect.objectContaining({ name: "slug" })],
      unique: true,
    });
    expect(getTableConfig(campaign_public_pages).checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "campaign_public_pages_slug_canonical_check" })]),
    );

    const revisionIndex = getTableConfig(campaign_public_page_revisions).indexes.find(
      (index) => index.config.name === "campaign_public_page_revisions_org_page_version_unique_idx",
    );
    expect(revisionIndex?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "org_id" }),
        expect.objectContaining({ name: "page_id" }),
        expect.objectContaining({ name: "version" }),
      ],
      unique: true,
    });
    expect(getTableConfig(campaign_public_page_revisions).indexes.find(
      (index) => index.config.name === "campaign_public_page_revisions_page_id_id_unique_idx",
    )?.config).toMatchObject({
      columns: [
        expect.objectContaining({ name: "page_id" }),
        expect.objectContaining({ name: "id" }),
      ],
      unique: true,
    });
  });
});
