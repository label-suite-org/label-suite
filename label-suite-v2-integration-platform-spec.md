# Label Suite V2 - Integration-First Music Operations Platform Spec

> Historical/reference document. Current product hierarchy lives in
> `docs/product/label-suite-product-map.md`; current execution state lives in GitHub Issues.

| | |
|---|---|
| Product | Label Suite |
| Version | V2 planning spec |
| Date | 2026-07-08 |
| Status | Draft for implementation planning |
| Companion docs | `label-suite-PRD.md`, `label-suite-technical-spec.md`, `samply-integration-spec.md` |

---

## 1. Executive Summary

Label Suite V2 should evolve from a label operations cockpit into an integration-first operating layer for independent music companies.

The product should not try to replace the best vertical tools in music. Instead, it should connect them into one reliable operational system of record:

- Samply owns external asset review and playback.
- WARM can own radio airplay monitoring.
- DSP/distributor systems own delivery and platform state.
- Royalty sources own earnings statements.
- Banks and bookkeeping systems own money movement and accounting records.
- Label Suite owns the normalized operational truth across all of them.

The strategic shift for V2 is:

> Data should be entered once, linked to canonical label objects, synced through modular connectors, validated by data-quality rules, and surfaced wherever the label needs to act.

WARM is the ideal first V2 proof point because it turns radio plugging from a manual CRM workflow into a measurable operational loop: release -> campaign -> station outreach -> airplay detection -> royalty/admin evidence -> task or report.

---

## 2. Current Baseline

The current repo already has the right spine for this architecture:

- Auth, orgs, memberships, invitations: `src/db/schema.ts`
- Releases, tracks, works, rights roles, readiness engine: `src/db/schema.ts`, `src/lib/readiness.ts`, `src/lib/readiness-core.ts`
- Samply connection/project/player/file/event tables: `src/db/schema.ts`
- Campaigns, radio stations, campaign-station joins: `src/db/schema.ts`
- Royalty rows and payout preview logic: `src/db/schema.ts`, `src/server/royalties.ts`, `src/server/royalties-dashboard-core.ts`
- Budget projects, line items, funding sources, document links: `src/db/schema.ts`
- Protected app shell and navigation: `src/lib/navigation.ts`, `src/layouts/AppLayout.astro`

The main V2 gap is not page count. The gap is a shared integration substrate.

Today, each external system risks becoming its own custom island:

- Samply has dedicated tables.
- Gmail enrichment has dedicated tables.
- Royalties import has dedicated API logic.
- DSP pitches are manual records, not delivery integrations.
- WARM would be another one-off if added directly as `warm_*` pages without shared connector infrastructure.

V2 should introduce a reusable integration layer first, then implement WARM on top of it.

---

## 3. Product Thesis

### 3.1 Positioning

Label Suite is the API-first operations layer for independent labels. It connects release metadata, rights, assets, promotion, airplay, royalties, payouts, and accounting into one coherent operational graph.

### 3.2 Differentiator

Most music tools own one vertical workflow:

- Asset sharing
- Royalty accounting
- Distribution
- Radio monitoring
- Campaign management
- Accounting

Label Suite should own the cross-system workflow:

1. A release is created.
2. Assets are reviewed in Samply.
3. Readiness and rights clearance are computed in Label Suite.
4. Delivery status is pulled from a DSP/distributor.
5. Radio activity is pulled from WARM.
6. Royalty statements are imported and matched to the same releases/tracks/works.
7. Payments and accounting entries reconcile against the same operational records.

### 3.3 Product Principle

Every integration must answer four questions:

1. Which Label Suite object does this external object map to?
2. Which system is authoritative for each field?
3. What changed since the last sync?
4. What action, blocker, report, or financial consequence follows from the change?

---

## 4. V2 Information Architecture

V2 should reduce top-level feature sprawl and organize around operational domains.

### 4.1 Proposed Navigation

```text
Home
  Dashboard
  Today

Catalog
  Releases
  Tracks
  Works & Rights
  Artists

Assets & Review
  Samply Review
  Media Assets
  Documents

Distribution
  Delivery Status
  DSP Pitches
  Metadata Patches
  Delivery Errors

Promotion
  Campaigns
  Radio Plugging
  WARM Airplay
  Stations & Contacts

Finance
  Royalties
  Statements
  Payees
  Payouts
  Budget
  Bank & Accounting
  Forecast

Operations
  Tasks
  Data Quality
  Imports
  Integrations
  Audit Log
  Settings

Portal
  Artist / Payee Portal
```

### 4.2 Navigation Changes From Current App

- Merge `Radio Plugging` and `Radio Stations` under `Promotion`.
- Merge `Media Assets` and `Documents` under `Assets & Review`, while preserving contextual panels on releases, artists, works, campaigns, budget lines, and statements.
- Keep `Today` as the operator queue, but move raw task/database views under `Operations`.
- Move `Forecast` under `Finance`.
- Treat `Integrations`, `Data Quality`, and `Audit Log` as core V2 infrastructure, not admin afterthoughts.

---

## 5. Integration Platform Architecture

### 5.1 Architectural Goal

Build one integration substrate that can support WARM, Samply, DSP delivery, royalty sources, banks, bookkeeping systems, and future music infrastructure APIs.

### 5.2 Core Concepts

| Concept | Meaning |
|---|---|
| Provider | The external service type, such as `warm`, `samply`, `gmail`, `awal`, `xero` |
| Connection | A tenant-specific configured account for a provider |
| External object | A remote object from a provider, such as a WARM song, Samply project, DSP release, bank transaction |
| Object link | Mapping between an external object and a Label Suite object |
| Sync job | A pull, push, webhook, import, or reconciliation run |
| Raw event | Immutable provider payload or source row |
| Normalized record | Canonical Label Suite representation of provider data |
| Data quality issue | A blocking or review-needed mismatch |
| Audit event | Who/what/when record for trust and support |

### 5.3 Proposed Core Tables

Add these tables before building more provider-specific integrations.

#### `integration_providers`

Purpose: catalog available integrations and their capabilities.

Suggested fields:

- `id`
- `key` - `warm`, `samply`, `gmail`, `awal`, `xero`
- `name`
- `category` - `assets`, `airplay`, `distribution`, `royalties`, `banking`, `accounting`, `crm`
- `capabilities` - JSON array
- `auth_type` - `api_key`, `oauth`, `manual_import`, `webhook`, `none`
- `status` - `planned`, `private_beta`, `active`, `deprecated`
- `created_at`
- `updated_at`

#### `integration_connections`

Purpose: one configured provider account per org, or multiple where needed.

Suggested fields:

- `id`
- `org_id`
- `provider_id`
- `label`
- `status` - `connected`, `needs_attention`, `paused`, `revoked`
- `auth_ref` - reference to encrypted secret storage, not raw token
- `settings` - provider-specific JSON
- `last_checked_at`
- `last_successful_sync_at`
- `created_by`
- `created_at`
- `updated_at`

#### `external_object_links`

Purpose: map remote objects to canonical Label Suite objects.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `provider_key`
- `external_object_type`
- `external_object_id`
- `external_object_url`
- `label_suite_object_type` - `release`, `track`, `work`, `artist`, `campaign`, `station`, `royalty_statement`, `bank_transaction`
- `label_suite_object_id`
- `match_method` - `manual`, `isrc`, `upc`, `title_artist`, `provider_callback`, `import_rule`
- `match_confidence`
- `status` - `active`, `needs_review`, `ignored`, `archived`
- `metadata`
- `created_at`
- `updated_at`

#### `sync_jobs`

Purpose: durable record of every sync/import/export attempt.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `provider_key`
- `job_type` - `pull`, `push`, `webhook`, `manual_import`, `export`, `reconcile`
- `status` - `queued`, `running`, `succeeded`, `failed`, `partial`, `cancelled`
- `started_at`
- `finished_at`
- `cursor_before`
- `cursor_after`
- `records_seen`
- `records_created`
- `records_updated`
- `records_failed`
- `triggered_by`
- `error_summary`
- `created_at`

#### `raw_integration_events`

Purpose: immutable raw provider evidence.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `sync_job_id`
- `provider_key`
- `event_type`
- `external_object_type`
- `external_object_id`
- `idempotency_key`
- `occurred_at`
- `received_at`
- `payload`
- `payload_hash`
- `processing_status`
- `processing_error`

#### `integration_errors`

Purpose: operational errors that need attention.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `sync_job_id`
- `severity` - `info`, `warning`, `error`, `critical`
- `code`
- `message`
- `external_object_type`
- `external_object_id`
- `resolved_at`
- `resolved_by`
- `created_at`

#### `data_quality_issues`

Purpose: product-facing mismatches and missing links.

Suggested fields:

- `id`
- `org_id`
- `source`
- `issue_type` - `unmatched_track`, `missing_isrc`, `duplicate_match`, `currency_missing`, `station_unmatched`, `period_overlap`, `rights_missing`
- `priority` - `P0`, `P1`, `P2`, `P3`
- `status` - `open`, `triaged`, `resolved`, `ignored`
- `label_suite_object_type`
- `label_suite_object_id`
- `external_object_type`
- `external_object_id`
- `details`
- `created_at`
- `updated_at`

#### `audit_events`

Purpose: trust, support, and financial traceability.

Suggested fields:

- `id`
- `org_id`
- `actor_user_id`
- `actor_type` - `user`, `system`, `integration`
- `event_type`
- `object_type`
- `object_id`
- `before`
- `after`
- `metadata`
- `created_at`

### 5.4 Integration Lifecycle

```text
Connect provider
  -> verify credentials
  -> create integration_connection
  -> schedule or run initial sync
  -> store raw events/source rows
  -> normalize into provider-specific domain tables
  -> link external objects to Label Suite objects
  -> create data-quality issues for unmatched records
  -> surface normalized data in release/campaign/finance workflows
  -> emit audit events for material changes
```

### 5.5 Connector Interface

Each connector should implement the same conceptual interface even if the first implementation is just server functions, not a formal class hierarchy.

```ts
type ConnectorCapability =
  | "assets"
  | "airplay"
  | "distribution"
  | "royalties"
  | "banking"
  | "accounting"
  | "crm"
  | "webhooks";

interface IntegrationConnector {
  providerKey: string;
  capabilities: ConnectorCapability[];
  verifyConnection(connectionId: string): Promise<ConnectionHealth>;
  sync(connectionId: string, options: SyncOptions): Promise<SyncResult>;
  processWebhook?(connectionId: string, payload: unknown): Promise<SyncResult>;
}
```

Avoid over-engineering the abstraction early. The important part is shared persistence, shared job tracking, shared object links, and shared data-quality handling.

---

## 6. WARM Reference Connector

### 6.1 Why WARM First

WARM is a strong V2 reference integration because public materials indicate:

- airplay monitoring is the core product;
- exportable reports are available in PDF, CSV, and XLS;
- API access is advertised on multiple plans;
- enterprise offerings include seamless data integration and 24-hour monitoring of selected stations.

Source: https://www.warmmusic.net/

This makes WARM a practical first test for the Label Suite integration substrate: it has remote songs, stations, detections, reports, and API/export paths that can map into canonical releases, tracks, campaigns, and royalty evidence.

### 6.2 Product Goal

Turn radio promotion from a manual status board into a measurable loop:

```text
Release
  -> campaign
  -> station outreach
  -> WARM-monitored song
  -> airplay detections
  -> campaign attribution
  -> artist/reporting insight
  -> royalty/admin evidence
  -> tasks and follow-ups
```

### 6.3 WARM MVP Scope

The first WARM integration should support both API sync and manual file import, because partner API details may not be available on day one.

MVP capabilities:

- Configure one WARM connection per org.
- Link a Label Suite track/work/release to a WARM monitored song.
- Import or sync airplay detections.
- Normalize station, territory, timestamp, and spin metadata.
- Attribute detections to releases, tracks, campaigns, and stations.
- Surface airplay in release detail and campaign detail.
- Create data-quality issues for unmatched songs, unknown stations, duplicate events, and missing ISRCs.
- Generate an evidence pack for reporting or royalty/admin follow-up.

### 6.4 WARM-Specific Tables

These tables sit on top of the shared integration substrate.

#### `warm_monitored_tracks`

Purpose: local representation of songs being monitored in WARM.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `external_object_link_id`
- `remote_song_id`
- `track_id`
- `work_id`
- `release_id`
- `artist_id`
- `title`
- `artist_name`
- `isrc`
- `monitoring_status` - `active`, `paused`, `ended`, `unknown`
- `monitoring_started_at`
- `monitoring_ended_at`
- `last_synced_at`
- `metadata`
- `created_at`
- `updated_at`

#### `airplay_events`

Purpose: normalized spin/detection records.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `raw_event_id`
- `warm_monitored_track_id`
- `track_id`
- `work_id`
- `release_id`
- `artist_id`
- `campaign_id`
- `radio_station_id`
- `remote_detection_id`
- `played_at`
- `detected_at`
- `duration_seconds`
- `confidence`
- `station_name`
- `station_remote_id`
- `country`
- `region`
- `city`
- `source_url`
- `metadata`
- `created_at`

Indexes:

- `(org_id, played_at)`
- `(org_id, release_id, played_at)`
- `(org_id, campaign_id, played_at)`
- `(org_id, radio_station_id, played_at)`
- unique `(org_id, connection_id, remote_detection_id)` where remote ID exists
- fallback unique hash on `(org_id, track_id, station_name, played_at)` for imports without remote IDs

#### `radio_station_sources`

Purpose: map WARM station identity to Label Suite radio station records.

Suggested fields:

- `id`
- `org_id`
- `connection_id`
- `radio_station_id`
- `provider_key`
- `remote_station_id`
- `station_name`
- `country`
- `city`
- `frequency`
- `website`
- `match_status` - `matched`, `needs_review`, `ignored`
- `match_confidence`
- `created_at`
- `updated_at`

#### `campaign_airplay_attributions`

Purpose: explain why an airplay event is attributed to a campaign.

Suggested fields:

- `id`
- `org_id`
- `campaign_id`
- `airplay_event_id`
- `attribution_method` - `date_window`, `station_targeted`, `manual`, `release_campaign_link`
- `confidence`
- `notes`
- `created_at`

#### `airplay_evidence_packs`

Purpose: durable bundles for artist reports, radio campaign wrap-ups, royalty/admin claims, or grant reporting.

Suggested fields:

- `id`
- `org_id`
- `title`
- `purpose` - `campaign_report`, `royalty_claim`, `artist_update`, `grant_report`, `internal_review`
- `release_id`
- `campaign_id`
- `artist_id`
- `period_start`
- `period_end`
- `status` - `draft`, `generated`, `sent`, `archived`
- `summary`
- `export_url`
- `created_by`
- `created_at`
- `updated_at`

### 6.5 WARM Matching Rules

Matching priority:

1. ISRC exact match to `tracks.isrc` or `works.isrc`.
2. Existing manual external object link.
3. Release UPC plus track title if provided.
4. Normalized title and artist match.
5. Manual review.

Data-quality issues:

- WARM song has no ISRC.
- WARM song ISRC matches multiple Label Suite tracks/works.
- WARM station is not linked to a Label Suite station.
- Detection is missing timestamp, territory, or station identity.
- Duplicate detection encountered across import/sync runs.

### 6.6 WARM UI Surfaces

#### Release Detail

Add an `Airplay` panel:

- total spins in selected period
- recent detections
- top countries
- top stations
- campaign-attributed spins
- unmatched or suspicious detections
- evidence pack action

#### Campaign Detail

Add an `Airplay Outcome` section:

- targeted stations versus detected stations
- first play date
- total spins during campaign window
- station follow-up recommendations
- report/export action

#### Promotion > WARM Airplay

Dedicated operational view:

- monitored tracks
- sync status
- unmatched songs
- unmatched stations
- recent airplay
- data-quality queue

#### Today

Create action cards:

- "New airplay detected on target station"
- "Airplay detected outside campaign target list"
- "Unmatched WARM song needs linking"
- "Generate campaign report"
- "Potential royalty/admin claim evidence ready"

### 6.7 WARM API Unknowns To Confirm

Ask WARM:

- API authentication type and token lifecycle.
- Whether the API can list monitored songs.
- Whether the API can create or update monitored songs.
- Whether detections have stable remote IDs.
- Whether station IDs are stable across reports/API.
- Whether historical backfill is available by plan.
- Rate limits.
- Webhook availability.
- Territory granularity.
- Whether detections include confidence, duration, audio snippet, or source URL.
- Data retention and redistribution rights.
- Whether Label Suite can show WARM data to artist/payee portal users.
- Whether Label Suite can generate branded reports using WARM data.

Until confirmed, implement the connector so CSV/XLS import can use the same normalization path as API sync.

---

## 7. Royalty Collection Automation

### 7.1 Goal

Move from flat royalty records to a full ingestion -> normalization -> statement -> balance -> payout workflow.

### 7.2 Proposed Tables

- `royalty_sources`
- `royalty_import_runs`
- `royalty_source_files`
- `royalty_raw_lines`
- `royalty_normalized_lines`
- `royalty_match_reviews`
- `statements`
- `statement_lines`
- `payees`
- `payee_accounts`
- `payee_balances`
- `payout_batches`
- `payout_lines`
- `exchange_rates`

### 7.3 Key Flows

1. Connect or import a royalty source.
2. Store the source file and raw rows.
3. Normalize line items into a canonical royalty line format.
4. Match to track, work, release, artist, territory, and payee.
5. Create data-quality issues for unmatched or ambiguous rows.
6. Close a statement period.
7. Generate payee statement lines.
8. Preview and approve payouts.
9. Reconcile payouts against bank transactions.

### 7.4 Data Requirements

Royalty lines must support:

- source/provider
- source account
- statement period
- sales/usage period
- currency
- gross amount
- deductions/costs
- net amount
- exchange rate
- territory
- platform
- units/streams/downloads if available
- ISRC/UPC
- track/work/release/payee links
- raw source row reference
- import run reference
- idempotency key

The existing `royalties_revenue` table can be kept temporarily as a compatibility view or migrated into the new model. Do not build substantial new V2 finance features directly on the flat table.

---

## 8. DSP Delivery And Patching

### 8.1 Goal

Separate manual DSP pitching from actual distribution delivery infrastructure.

The current `dsp_pitches` model is useful for promotion. V2 delivery needs its own objects.

### 8.2 Proposed Tables

- `delivery_partners`
- `dsp_accounts`
- `dsp_releases`
- `delivery_batches`
- `delivery_jobs`
- `delivery_payload_versions`
- `delivery_assets`
- `delivery_events`
- `delivery_errors`
- `metadata_patch_requests`

### 8.3 Key Flows

1. Release passes readiness gate.
2. Label Suite generates a delivery packet.
3. Operator reviews payload.
4. Packet is submitted to distributor/DSP partner.
5. Per-platform statuses sync back.
6. Errors create data-quality issues or delivery errors.
7. Metadata/audio/artwork patches are versioned and resubmitted.

### 8.4 Source Of Truth Rules

- Label Suite owns canonical release, track, work, rights, and metadata readiness.
- Samply/R2 owns reviewable or stored assets.
- DSP/distributor owns platform delivery state and remote IDs.
- Label Suite stores payload history and remote state, but does not pretend to be the distributor.

---

## 9. Accounting And Bank Integration

### 9.1 Goal

Connect royalties, budgets, payouts, and real bank/bookkeeping records without turning Label Suite into a full general ledger.

### 9.2 Proposed Tables

- `bank_connections`
- `bank_accounts`
- `bank_transactions`
- `bookkeeping_connections`
- `ledger_accounts`
- `counterparties`
- `reconciliation_matches`
- `payables`
- `receivables`
- `accounting_exports`

### 9.3 Key Flows

1. Connect bank or bookkeeping system.
2. Import transactions.
3. Match incoming royalty payments to royalty source/import periods.
4. Match outgoing payments to payout batches, budget line items, or vendor spend.
5. Export or post bookkeeping entries.
6. Keep unresolved transactions in an exception queue.

### 9.4 Boundaries

Label Suite should:

- record and reconcile money movement;
- prepare exports or accounting entries;
- show operational financial truth to label operators and payees.

Label Suite should not initially:

- initiate payouts directly;
- replace the general ledger;
- manage tax filing;
- hold customer funds.

---

## 10. Implementation Plan

### Phase V2.0 - Integration Substrate

Exit criteria:

- Shared integration tables exist.
- Connections can be listed, created, paused, and health-checked.
- Sync jobs are durable and visible.
- Raw integration events can be stored idempotently.
- External objects can be linked to Label Suite objects.
- Data-quality issues are visible in Operations.
- Audit events exist for integration changes.

Likely implementation files:

- `src/db/schema.ts`
- new migrations under `drizzle/`
- `src/server/integrations.ts`
- `src/server/integration-jobs.ts`
- `src/server/external-object-links.ts`
- `src/server/data-quality.ts`
- `src/pages/integrations.astro`
- `src/pages/data-quality.astro`
- `src/pages/api/integrations/*`
- `src/components/integrations/*`
- `src/components/data-quality/*`

### Phase V2.1 - WARM MVP

Exit criteria:

- WARM provider is registered.
- WARM connection can be configured.
- CSV/XLS import path works before API details are finalized.
- WARM API sync can be added without changing the normalized airplay model.
- Monitored tracks can be linked to tracks/works/releases.
- Airplay events are stored idempotently.
- Release detail shows airplay.
- Campaign detail shows attributed airplay.
- Unmatched songs/stations create data-quality issues.

Likely implementation files:

- `src/server/integrations/warm.ts`
- `src/server/airplay.ts`
- `src/pages/promotion/warm-airplay.astro`
- `src/pages/api/integrations/warm/*`
- `src/components/airplay/*`
- release workspace airplay panel
- campaign detail airplay panel

### Phase V2.2 - Promotion Outcome Loop

Exit criteria:

- Campaigns can define target station lists.
- Airplay can be attributed to campaigns by date window, station target, release link, or manual override.
- Today Hub surfaces airplay follow-ups.
- Evidence packs can be generated for campaign reports.

### Phase V2.3 - Royalty And Statement Foundation

Exit criteria:

- Royalty source/import run/raw line/normalized line tables exist.
- Existing STEM import is migrated onto the new import substrate.
- Statements and statement lines can be generated.
- Payees and balances exist.
- Payout batches can be recorded.

### Phase V2.4 - Distribution Delivery

Exit criteria:

- Delivery partners/accounts exist.
- Delivery payloads are versioned.
- Per-platform status exists.
- Delivery errors flow into data quality and Today.
- Manual export is possible even before a direct DSP/distributor API exists.

### Phase V2.5 - Bank And Bookkeeping Reconciliation

Exit criteria:

- Bank/accounting connections exist.
- Transactions import into a normalized table.
- Royalty receipts, payout batches, and budget spend can be matched to transactions.
- Unmatched transactions appear in an exception queue.

### Phase V2.6 - Artist / Payee Portal

Exit criteria:

- Payee role has isolated read-only routes.
- Payees can see approved statements, balances, payout history, and selected reports.
- WARM evidence or campaign summaries can be selectively exposed if the data license allows it.

---

## 11. First Implementation Tickets

### Ticket 1 - Add Integration Core Schema

Add:

- `integration_providers`
- `integration_connections`
- `external_object_links`
- `sync_jobs`
- `raw_integration_events`
- `integration_errors`
- `data_quality_issues`
- `audit_events`

Include:

- org indexes
- provider indexes
- idempotency indexes
- tenant-safe foreign keys
- Drizzle migration
- basic server CRUD/list helpers
- unit tests for object-link matching helpers

### Ticket 2 - Integration Console

Build `/integrations`:

- provider list
- connected accounts
- connection health
- last sync
- sync now action
- pause/resume
- recent errors

### Ticket 3 - Data Quality Queue

Build `/data-quality`:

- filter by source, priority, status, object type
- resolve/ignore actions
- link external object to existing release/track/work/station
- create task from issue

### Ticket 4 - WARM Import MVP

Build WARM CSV/XLS import:

- upload source report
- create sync job
- store raw rows
- normalize monitored tracks and airplay events
- match by ISRC first
- generate data-quality issues for unmatched rows
- show import summary

### Ticket 5 - WARM Release Panel

Add release-level airplay panel:

- total spins
- top stations
- top countries
- recent detections
- unmatched detections
- evidence pack action

### Ticket 6 - WARM Campaign Attribution

Add campaign outcome logic:

- match airplay events by linked release
- filter campaign window
- compare targeted stations to detected stations
- allow manual attribution override
- show campaign report summary

---

## 12. Technical Requirements

### 12.1 Tenant Safety

Every new table must include:

- `org_id`
- org-scoped indexes
- server-side org scoping
- same-org relationship validation

Before V2 external users, remove reliance on default `"true-nature"` org IDs in write paths.

### 12.2 Idempotency

Every import/sync path must be safely repeatable.

Required patterns:

- provider remote ID when available
- source row hash when no remote ID exists
- unique idempotency key per org/connection/event
- no duplicate airplay events on repeated WARM imports
- no duplicate royalty lines on repeated statement imports

### 12.3 Raw Evidence Retention

Financial and airplay workflows need evidence. Store raw provider payloads or source rows before normalization.

Do not only store aggregated summaries.

### 12.4 Background Jobs

V2 should introduce a real job runner or queue abstraction for:

- integration syncs
- imports
- validation sweeps
- statement generation
- report/evidence pack generation
- retries

Initial implementation may be Postgres-backed if that matches deployment simplicity.

### 12.5 Permissions

Suggested permission gates:

- owner: integrations, billing, members, all domain data
- operator: all day-to-day domain work and syncs
- member: limited domain work
- payee: portal-only read access

Integration credentials and raw payloads should be owner/operator only.

### 12.6 Observability

Add:

- sync job logs
- integration error dashboard
- structured server logs
- audit events for credential changes, imports, statement closes, payout approvals, and evidence pack generation

---

## 13. Acceptance Criteria For V2 Integration Foundation

V2 foundation is ready when:

- A new provider can be added without creating a bespoke sync/event/link/error system.
- WARM import and future WARM API sync use the same normalized airplay model.
- A release can show data from Label Suite, Samply, WARM, DSP delivery, and royalty imports without duplicating identity.
- A data-quality issue can connect an external mismatch to a user action.
- Every external row/event has raw evidence, normalized data, and an audit trail.
- Re-running an import or sync does not duplicate records.
- Tenant isolation is enforced at every integration read/write path.

---

## 14. Open Product Questions

1. Should WARM data be visible in the artist/payee portal, or only in label-operator reports?
2. Should Label Suite create/modify WARM monitored songs, or only read/import WARM results?
3. Which label workflow is more valuable first: campaign performance or royalty/admin evidence?
4. Should airplay evidence packs be branded Label Suite reports, WARM exports, or hybrid reports?
5. Should the first public V2 wedge be "radio promotion outcomes" or "all integrations in one label OS"?
6. How much data from partner systems can Label Suite retain and redistribute contractually?
7. Which finance integration should follow WARM: royalty source import, bank feed, or bookkeeping?

---

## 15. Recommended Next Step

Use WARM as a design-partner integration, but implement it through the reusable V2 integration substrate.

Immediate next implementation sequence:

1. Add integration core schema and migrations.
2. Build the integration console and data-quality queue.
3. Build WARM CSV/XLS import using shared raw event and sync job tables.
4. Add WARM release and campaign panels.
5. Confirm WARM API details and replace or supplement manual import with API sync.

This keeps the product from becoming a pile of integrations and turns it into a platform where every new integration compounds the value of the last one.
