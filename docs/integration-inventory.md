# Integration and Data-Feed Inventory

**Status:** Active reference

**Canonical application data:** Label Suite PostgreSQL

**Review trigger:** Any new provider, scheduled feed, credential, webhook, or
change in source-of-truth policy

This document is the authoritative service registry for Label Suite. Provider
setup details remain in the linked runbooks and source files.

## GitHub to Plane roadmap sync

| Field | Value |
| --- | --- |
| Status | `partial` — implementation and delivery contract exist; rollout remains approval-gated. |
| Direction | One-way GitHub implementation status into Plane roadmap projection. |
| Runtime | Separate Dokploy Compose application from canonical `main`; Node 24, port `8787`, persistent `plane-sync-data` volume. |
| Credentials | GitHub App and Plane token live only in Dokploy protected environment values. |
| Verification | GitHub Actions is secretless and verification-only; Dokploy deploys reviewed merges to `main`. |
| Operations | [GitHub to Plane sync runbook](runbooks/github-plane-sync.md) and [safe environment template](runbooks/github-plane-sync.env.example). |

## Status definitions

- `active` — implemented and used as an intended production path when configured;
- `partial` — useful implementation exists, but an intended automation or
  production capability is still missing;
- `migration_only` — controlled import/reconciliation tooling, not an ongoing
  operational source;
- `manual` — user-initiated file or API import;
- `planned` — design exists, but no production integration should be assumed.

## Inventory

| System | Status | Direction | Purpose | Execution |
|---|---|---|---|---|
| PostgreSQL/Neon | `active` | internal | Canonical operational and analytical state | Astro server and job worker |
| Sisense/Periscope | `active` | inbound | Distributor analytics containing Spotify, Apple, Shazam, city, source, playlist, and demographic metrics | Dedicated Playwright/CSV sync and host schedule |
| Samply | `partial` | bidirectional | Release audio review, projects, players, files, downloads, and comments | Authenticated API actions and explicit release sync |
| Airtable | `migration_only` | inbound | Legacy catalog, rights, grants, royalty, budget, asset, and mapping reconciliation | Dry-run-first CLI scripts |
| Gmail | `active` | inbound suggestions | Contact enrichment from message headers and signatures | User OAuth plus on-demand scans |
| YouTube Data API | `partial` | inbound observations | Campaign-scoped creator candidates with public video evidence | Authenticated, on-demand search; production credential pending |
| Codex Desktop campaign enrichment MCP | `active` | outbound bounded context; inbound pending proposals | Proposal-only campaign lead enrichment with cited `codex_mcp` provenance | Local stdio MCP or CLI through tenant-scoped Label Suite HTTPS routes |
| STEM royalty files | `manual` | inbound | Royalty revenue import and ISRC matching | Authenticated CSV/TSV upload |
| Brevo | `active` | outbound | Workspace invitations and operational email | Synchronous provider API call |
| Cloudflare R2 | `active` | bidirectional storage | Private media, artwork, documents, audio, and raw analytics snapshots | Presigned/browser or server upload and signed download |
| Better Auth | `active` | identity | Users, sessions, and authentication | Astro auth routes backed by PostgreSQL |
| Discogs | `planned` | undecided | Catalog metadata enrichment | No production implementation |
| Revolut | `planned` | undecided | Finance/payment workflows | No production implementation |

Configuration in a deployment cannot be inferred from code alone. An `active`
status means the path is production-capable when its secrets and process are
configured.

## Data ownership rules

1. PostgreSQL is the system of record for releases, tracks, works, rights,
   readiness, contacts, budgets, grants, royalties, tasks, and approvals.
2. External providers are inputs or projections. They do not silently overwrite
   canonical operational state.
3. Sisense metrics are provider observations. Raw snapshots may be retained in
   R2, while normalized rows and import history live in PostgreSQL.
4. Samply owns hosted playback and remote review resources. Label Suite owns the
   release/track identity, rights, readiness, internal approval, and the mapping
   to Samply objects.
5. Gmail extraction produces reviewable suggestions. A user action applies a
   suggestion to canonical contact data.
6. Airtable is a legacy migration source. Repeat imports use mapping and parity
   checks; normal product writes never synchronize back to Airtable.
7. R2 owns object bytes, not business metadata. PostgreSQL owns object keys,
   associations, access policy, and processing state.
8. Codex MCP proposals are non-canonical review inputs. Only a separate signed-in
   Accept action may apply an accepted value to a lead.

## Service details

### Sisense/Periscope

- **Flow:** shared dashboard → Playwright export → CSV snapshot → optional R2
  archive → `analytics_import_*` and `analytics_metric_*` tables → dashboards.
- **Staging contract:** `0063_sisense_staging_schema` adopts the seven
  importer-owned `staging_*` tables already present in production. It only
  creates missing relations; the importer continues to own refreshes and any
  explicit truncation, so migration deployment does not rewrite live imports.
- **Commands:** `npm run sisense:sync`, `sisense:scrape`, and `sisense:import`.
- **Schedule:** currently a separate Coolify/host schedule; it is not yet a
  handler in the PostgreSQL durable job runner.
- **Required configuration:** `SISENSE_DASHBOARD_URL`; optionally
  `SISENSE_DASHBOARD_PASSWORD`, widget/filter/scope variables, and R2 variables.
- **Failure/recovery:** inspect `analytics_import_runs`; rerun a recent sync or
  import a retained snapshot. A failure must not delete the last good metrics.
- **Important:** Spotify, Apple, and Shazam metrics currently arrive through
  Sisense. Label Suite does not call those provider APIs directly.

### Samply

- **Flow:** Label Suite release ↔ Samply project/player/file projections.
- **Implemented:** availability checks, project creation/linking, player
  creation, release synchronization, file inventory, downloads, and comment
  reads.
- **Still partial:** automatic webhook ingestion and durable scheduled/retryable
  synchronization are not wired as production job handlers.
- **Required configuration:** `SAMPLY_API_TOKEN`; optional `SAMPLY_BASE_URL` and
  workspace-scoping `SAMPLY_ORG_ID`.
- **Health/recovery:** `npm run samply:smoke`, `/api/samply/status`, then an
  explicit release sync. Provider data must not replace rights or approval state.
- **Persistence:** `samply_connections`, `samply_projects`, `samply_players`,
  `samply_files`, `samply_events`, and `samply_comment_links`.

### Airtable

- **Flow:** Airtable GET requests → dry-run plan/parity report → explicit
  PostgreSQL apply → `airtable_record_mappings`.
- **Commands:** `airtable:parity`, `airtable:import`,
  `airtable:grants:parity`, `airtable:grants:import`, and
  `airtable:copy-assets`.
- **Required configuration:** one of `AIRTABLE_API_KEY`, `AIRTABLE_PAT`, or
  `AIRTABLE_TOKEN`; normally `AIRTABLE_BASE_ID` and target organization.
- **Policy:** migration-only, GET-only against Airtable, dry-run by default, and
  never an automatic two-way synchronization service.

### Gmail

- **Flow:** OAuth read-only Gmail access → bounded message scan → enrichment
  suggestions → explicit accept/ignore action.
- **Required configuration:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  optional `GOOGLE_GMAIL_REDIRECT_URI`, and `GMAIL_TOKEN_SECRET` or
  `BETTER_AUTH_SECRET`.
- **Policy:** Gmail is evidence for contact suggestions, not a canonical contact
  database.

### YouTube Data API

- **Flow:** authenticated campaign search → YouTube public video results →
  channel-grouped creator candidates with evidence URLs and retrieval provenance.
- **Endpoint:** `GET /api/campaigns/:campaignId/creator-discovery/youtube` with
  `query` and optional `max_results` from 1 to 15.
- **Required configuration:** server-only `YOUTUBE_API_KEY` with YouTube Data
  API v3 enabled. OAuth is not required for this public-data search.
- **Authority:** read-only and non-persisting. Results do not become campaign
  leads, scores, contact data, approvals, or outreach without a later explicit
  operator action.
- **Failure policy:** missing configuration, quota exhaustion, and provider
  failures return bounded safe errors; provider bodies and credentials are not
  returned to the client.

### Codex Desktop campaign enrichment MCP

- **Flow:** Label Suite bounded queue/item context → local stdio MCP or CLI →
  operator-directed Codex research → cited pending proposals → signed-in human
  Accept/Reject review.
- **Credential boundary:** the local client reads a separate tenant-scoped Label
  Suite bearer token from macOS Keychain. Codex OAuth stays inside Codex. Label
  Suite, the MCP process, and its configuration hold no Codex, OpenAI, or
  OpenRouter credential.
- **Exact Label Suite scopes:** `campaign.enrichment.read`,
  `campaign.enrichment.claim`, and `campaign.enrichment.propose`.
- **Authority:** read bounded campaign context, create/renew/release an expiring
  work lease, and submit cited pending proposals. It has no Accept/Reject,
  canonical lead/contact, draft/task, page, approval, publication, email,
  delivery, or stage mutation authority.
- **Provider and delivery:** the MCP server is not an AI-provider client and has
  no external delivery credential. Codex supplies research through its own host
  session; proposal intake itself calls neither OpenRouter nor email providers.
- **Audit and telemetry:** token lifecycle, authentication categories, reads,
  lease outcomes, proposal submit/replay, and safe rejection categories emit a
  bounded allowlisted event. Resolved-tenant events are written best-effort to
  `audit_logs`; bearer/hash, proposal/evidence/fetched text, contact data, and
  raw errors are excluded.
- **Legacy route:** `/api/campaign-leads/:id/enrichment-runs` remains server code
  for the old in-app provider path, but the campaign UI does not call it and it
  is not an automatic fallback.
- **Operations:** [Campaign Enrichment MCP runbook](runbooks/campaign-enrichment-mcp.md).

### STEM and royalty files

- **Flow:** authenticated CSV/TSV upload → bounded parser → normalized royalty
  rows → ISRC matching → unmatched review queue.
- **Execution:** manual through `/api/royalties/import-stem` or the generic
  royalty import endpoint.
- **Policy:** preserve unmatched rows and import provenance; never discard a row
  because identity matching failed.

### Brevo

- **Flow:** Label Suite → Brevo transactional email API.
- **Required configuration:** `BREVO_API_KEY` and normally
  `BREVO_SENDER_EMAIL`.
- **Policy:** outbound delivery only. Delivery results are recorded in
  PostgreSQL; Brevo is not the source of application state.

### Cloudflare R2

- **Flow:** browser/server uploads and signed downloads; Sisense and Airtable
  tools may also archive/copy objects.
- **Required configuration:** `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, plus `R2_ACCOUNT_ID` or `R2_ENDPOINT`; optional
  `R2_PUBLIC_BASE_URL`.
- **Policy:** tenant-prefixed private keys by default. Public artwork must use a
  dedicated public origin/prefix that cannot expose private documents or audio.

## Durable-job migration order

The PostgreSQL worker currently executes validation sweeps. The next recurring
integration handlers should be introduced in this order:

1. `sisense_sync`;
2. `samply_sync`;
3. royalty import processing;
4. retryable email/provider synchronization.

Existing scripts remain controlled recovery tools after a handler is added.
Redis is not required unless measured PostgreSQL contention or multi-replica
coordination justifies it.

## Adding or changing a provider

Before production use:

1. update this inventory and identify the canonical source for every field;
2. define direction, idempotency, conflict, retry, and deletion behavior;
3. add a named capability for privileged actions;
4. store secrets only in the deployment secret manager;
5. add sanitized health/failure visibility;
6. use the durable worker for scheduled or retryable work;
7. document recovery and provider-offline behavior;
8. test tenant isolation and cross-workspace references.

Related references:

- [`README.md`](../README.md)
- [`api-mutation-inventory.md`](./api-mutation-inventory.md)
- [`database-schema-ownership.md`](./database-schema-ownership.md)
- [`runbooks/background-jobs.md`](./runbooks/background-jobs.md)
- [`../samply-integration-spec.md`](../samply-integration-spec.md)
