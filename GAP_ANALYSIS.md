> Retained technical/historical reference. Current public candidate and production
> boundaries are defined in `PUBLIC_SOURCE.md`; this document does not authorize deployment.

# Label Suite - PRD / Spec / Airtable Gap Plan

> Historical/reference document. Current product hierarchy lives in
> `docs/product/label-suite-product-map.md`; current execution state lives in GitHub Issues.

Date: 2026-06-27

This document reconciles three sources:

- Product target: `label-suite-PRD.md`
- Technical target: `label-suite-technical-spec.md`
- Prototype/source model: Airtable base `appoKM3ylTDhR60LY`

The Airtable base was inspected through the Airtable API. The base currently has 33 tables. Older docs mention 34 tables; the live metadata returned 33.

## Executive Summary

The stack is right for the product: Astro SSR, React islands, Drizzle/Postgres, Better Auth, Tailwind, shadcn-style components, and R2-compatible object storage are a good fit for a fast, self-hostable label-operations cockpit.

The main gap is not stack choice. The main gap is product architecture maturity:

1. The app has a tenant foundation, but it is not fully multi-tenant SaaS yet. SaaS still needs memberships, active-org scoping through every query, RLS, invitations, roles, onboarding, billing, and isolation tests.
2. The readiness/clearance engine exists, but it needs exhaustive tests and a few Airtable semantic mappings before it can be trusted as the product promise.
3. The royalty side is only a flat revenue table today. Airtable has a large raw royalty import table (`Sheet`, at least 10,000 records), so the app needs a real ingestion -> attribution -> statements -> balances -> payouts pipeline.
4. Airtable domains exist that are not yet represented or are only shallowly represented: grants/projects/applications, reporting weeks, artist metrics history, payee portal, audit/admin/support, and background jobs.
5. Several built domains need deeper UI integration in the daily cockpit and release detail pages.

## Stack And Architecture Verdict

The current stack should be kept. Rewriting to another full-stack framework would not solve the product gaps. The app's risks are mostly missing product infrastructure, not wrong technology choices.

| Layer | Current choice | Verdict | What is missing |
|---|---|---|---|
| Web app | Astro SSR with React islands | Good fit | Keep server-rendered pages; reserve React for forms/managers that need interactivity. Add Playwright smoke coverage before external users. |
| UI system | Tailwind/shadcn-style components | Good fit | Tighten responsive QA and keep operational screens dense rather than marketing-like. |
| Database | Postgres | Correct system of record | `org_id` exists as a foundation; add RLS, audit log, job runs, royalty ledger tables, tenant-scoped uniqueness, and stronger FK/on-delete policy. |
| ORM/migrations | Drizzle | Good fit | Keep every schema change in migrations; add a backfill runbook before tenant migration. |
| Auth | Better Auth | Good foundation | Custom org/membership foundation exists; add invitation flows, server-side permission helpers, and payee role isolation. |
| Storage | R2/S3-compatible helpers | Good fit | Upload keys are org-prefixed; wire full upload/download flows into media/doc workflows and enforce access checks. |
| Business logic | `src/server/*` services plus `src/lib/*` core logic | Improving | Continue moving domain rules out of UI/API handlers into tested pure/service layers. |
| Background work | None, plus interim `npm run sweep` | Not enough | Add a real runner for imports, statements, metrics fetches, reconciliation, and retries. |
| Money pipeline | Flat `royalties_revenue` records | Underbuilt | Add raw imports, normalized earnings, split snapshots, statements, balances, payouts, and payee portal. |
| Observability | `/api/health`, logs | Internal-tool level | Add structured errors, error tracking, job run logs, audit log, backup/restore runbook. |

Recommended architecture direction:

- Keep the single shared Postgres schema, finish `org_id` query scoping everywhere, and enable Postgres RLS before design partners.
- Keep readiness/clearance as the product core: pure tested rules, persisted caches, idempotent sweep, and scheduled reconciliation.
- Add one background-job layer instead of scattering long-running work across request handlers.
- Treat Airtable as migration input only; do not rebuild Airtable automation tables as product tables.
- Build the royalty system as a ledger/statement pipeline, not as more fields on `royalties_revenue`.

## Current Implementation Snapshot

The current worktree has moved beyond the old gap analysis. The app now includes these domain tables in `src/db/schema.ts`:

- `contacts`
- `artists`
- `releases`
- `works`
- `tracks`
- `roles`
- `budget_categories`
- `budget_line_items`
- `calls`
- `dsp_pitches`
- `bugs`
- `isrc_sequences`
- `campaigns`
- `radio_stations`
- `campaign_stations`
- `media_assets`
- `documents`
- `side_artists`
- `royalties_revenue`
- `ops_tasks`

Auth tables exist separately in `src/db/auth-schema.ts`.

The current app also has a service layer under `src/server/*`, Zod request validation for most API routes, and transactional writes for the critical readiness paths.

Read-only Airtable/Postgres parity tooling now exists in `scripts/airtable-parity.ts`. It uses GET-only Airtable requests and SELECT-only Postgres queries. The generated `AIRTABLE_PARITY_REPORT.md` is intentionally ignored because it can include Airtable sample contact data.

Safe Airtable import tooling now exists in `scripts/airtable-import.ts`. It is dry-run by default, uses GET-only Airtable requests, and only writes to Postgres when `--apply` is explicit. Apply mode only inserts missing product rows plus mapping rows; it performs no deletes, truncates, or product-row updates. Imported rows are assigned to one explicit org, currently `true-nature` by default.

## Airtable Prototype Snapshot

Live Airtable metadata and record counts:

| Airtable table | Records | Current app status | Notes |
|---|---:|---|---|
| Contacts | 184 | Partial | Core contact info exists; missing richer contact/org/legal/publisher model. |
| Artists | 12 | Imported/Partial | Imported under `true-nature`; missing metrics history, image, priority, team, YouTube/Soundcharts fields. |
| Releases (And Artist Events) | 15 | Imported/Partial | Imported under `true-nature`; cover-art binaries copied to R2 and linked to release rows. Missing event/reporting depth, catalog number, focus track, explicit blocked owner/reason. |
| Release Tracks | 50 | Imported/Partial | Imported under `true-nature`; 49 tracks link to release and work rows, 1 Airtable placeholder has no source release/work links. Missing curation, label-copy depth, catalog suffix, some Airtable readiness fields. |
| Recordings (Masters) | 47 | Imported/Partial | Imported under `true-nature` as `works`; deliberate non-split from compositions for now. |
| Rights Lines (Roles) | 122 | Imported/Partial | Imported under `true-nature`; all roles link to works, 114/122 link to contacts. Missing neighboring scope, fee/attachments, entered-vs-confirmed fidelity, and contact cleanup for the blocked duplicate-email source contact. |
| ISRC Sequences | 3 | Covered/Source Empty | Implemented as `isrc_sequences`; live Airtable rows currently return no field values, so migration skips them rather than inventing counters. |
| Reporting | 10 | Missing | Needed for reporting cadence and release workflow. |
| Budget Line Items | 2 | Imported/Partial | Imported under `true-nature`; both rows link to releases and categories. Release-level bucket rollups exist; deeper targets/actuals still need work. |
| Budget Categories | 2 | Imported | Imported under `true-nature`. |
| DSP Pitches | 3 | Imported/Partial | Imported under `true-nature`; `dsp_pitch_releases` preserves 4 pitch-release links for 3 pitch rows, including the multi-release Airtable pitch. Missing recipient/contact joins, email copy depth, and campaign/task links. |
| Projects | 3 | Missing | Required for grants/funding pipeline. |
| Grants | 28 | Missing | Required by PRD local moat. |
| Applications | 1 | Missing | Required by grants/funding pipeline. |
| Assets | 17 | Imported/Replace Later | Imported as `media_assets` metadata under `true-nature`; still should be replaced by code/git/storage where appropriate. |
| Bugs | 131 | Covered/Partial | Bug inbox exists; needs fuller sweep coverage and audit/reporting. |
| Calls | 1 | Partial | Calls exist; missing status/type/project links and better date buckets. |
| Implementation Log | 104 | Skip/Replace | Do not port as product data; use git/audit logs. |
| Schema Snapshots | 5 | Skip/Replace | Do not port as product data; migrations replace this. |
| RUNS | 1 | Skip/Replace | Replace with job run logs once background jobs exist. |
| Personal Writings | 1 | Skip | Not core product scope. |
| Ops Tasks | 1 | Partial | Schema/UI exist; missing Today Hub integration, campaign link, owner-as-contact. |
| Campaigns | 1 | Partial | Basic campaign fields exist; missing AI fields if desired and deeper workflow. |
| Royalties / Revenue | 0 | Partial | Flat table exists; not enough for PRD money requirements. |
| Media Assets | 1 | Imported/Partial | Imported as `media_assets` metadata under `true-nature`; the live table had no attachment binaries during copy, so rights/usage UI depth remains the main gap. |
| Compositions (Works) | 4 | Deferred/Missing | Current architecture intentionally keeps one `works` table; split later if needed. |
| Sheet | 28096 | Missing | Raw royalty import data. This is a major architecture gap. |
| Documents | 0 | Partial | Basic table exists; needs file storage and legal workflow depth. |
| Side Artists | 12 | Partial | Schema exists; needs UI/workflow integration. |
| Artist Metrics | 6 | Missing | Need time-series table and scheduled fetch. |
| Radio Stations | 507 | Partial | Radio CRM exists; missing several Airtable fields and import polish. |
| Campaign Stations | 0 | Covered/Partial | Join table exists; needs campaign workflow UI depth. |
| Reporting Weeks | 53 | Missing | Needed for reporting cadence and release/event timeline. |

## Critical Gaps By Area

### 1. Multi-Tenant SaaS Foundation

Status: Foundation started, not SaaS-complete.

Important product rule:

- SaaS users should share the same UX and product workflows, adjusted by plan/role.
- SaaS users should not share the same real content unless they are members of the same org/workspace.
- Imported Airtable content is True Nature account data, not global seed/demo data.
- New external accounts should start empty or with template/sample records that are clearly separate from True Nature's operational catalog.

What exists:

- `orgs` exists in Drizzle and Neon.
- A first internal org exists: `true-nature`.
- `org_memberships` and `org_invitations` exist in Drizzle and Neon.
- `org_id` exists on the current product domain tables and on `airtable_record_mappings`.
- Account-local unique constraints now include `org_id` for contacts, artists, releases, works, radio stations, campaign stations, bugs, and ISRC sequences.
- Middleware resolves an active org for protected requests and stores it in `Astro.locals`.
- The first Better Auth user claims `true-nature` as owner if it has no members yet; later users without memberships get their own empty workspace instead of inheriting True Nature data.
- Main page/API service calls now pass `orgId` through reads/writes, and storage upload keys are prefixed by org.
- The Airtable importer assigns imported content to `AIRTABLE_IMPORT_ORG_ID`, defaulting to `true-nature`.

Required before external design partners:

- Add a workspace switcher for users with multiple orgs.
- Build invitation send/accept UI and flows.
- Add server-side permission checks for `owner`, `operator`, `member`, and `payee`.
- Finish same-org relationship checks across all optional linked records.
- Enable Postgres RLS on domain tables with policies based on a session GUC such as `app.current_org`.
- Add isolation tests proving org A cannot read or mutate org B data.
- Decide whether to use Better Auth's organization plugin directly or keep a custom org/membership model next to Better Auth users.

Definition of done:

- Every domain query is org-scoped.
- Every mutation checks role permissions server-side.
- Another org can use the same contact email, UPC, ISRC, call sign, or other account-local unique values when the business rules allow it.
- RLS is enabled and tested.
- A new signup can create an org and land in an empty/onboarded workspace.

### 2. Clearance And Readiness Trust

Status: Built core, not fully hardened.

What exists:

- `works`, `tracks`, and `roles` model the readiness spine.
- `computeClearanceProgress()` splits Publishing and Master and rolls Mechanical into Publishing.
- Track and release readiness caches are persisted.
- Role and track mutations trigger recomputation.
- Unit tests now cover the pure clearance rules.
- The sweep now emits track, release, role, and work-level blockers for the main M0 readiness gaps, including under/over-allocated Publishing and Master scopes.
- Release, track, and role API mutations now trigger a best-effort validation sweep after successful writes.

Gaps:

- Airtable includes `Neighboring` scope; current code only recognizes Publishing, Master, Mechanical.
- Airtable clearance statuses include Contacted and Negotiating; current code only recognizes Signed, Confirmed, Pending, Unknown.
- Airtable distinguishes entered vs confirmed shares explicitly; current app encodes confidence through status weighting.
- Role fees and attachments are not modeled.
- `runValidationSweep()` is still request-driven; it is post-write triggered for readiness-critical API writes, but not scheduled.
- Readiness cache correctness depends on application code; stronger reconciliation and test coverage are needed.

Required work:

- Continue expanding tests around DB-facing persistence and sweep behavior.
- Decide explicit Airtable mappings:
  - `Neighboring` -> new neighboring/related-rights scope, Master, or excluded from readiness.
  - `Contacted` and `Negotiating` -> Pending weight or distinct weights.
- Add optional `entered_share` / `confirmed_share` columns only if the manager view genuinely needs both; otherwise document the status-weighting decision.
- Add role fee and attachment/document links if they are part of label-copy/legal workflows.
- Add stale-cache detection and DB-backed sweep idempotency tests.
- Add a scheduled sweep/background job.

Definition of done:

- The readiness engine has exhaustive tests.
- A release marked Ready can be explained by stored data.
- Sweep is idempotent, scheduled, and broad enough to catch the known Airtable formula failure cases.

### 3. Royalty / Money Pipeline

Status: Implemented foundation / workflow partial.

What exists:

- `royalties_revenue` stores flat records with statement period, source, gross/cost/net, paid_out, payment date/method, artist/release links.
- The normalized ledger now includes imports, attributed earnings, immutable split snapshots, statements/lines, ledger entries, and recorded payouts.
- Airtable `Sheet` has been imported with ISRC attribution and an explicit unmatched queue.

Why this is not enough:

- PRD requires ingestion, statements, balances, payouts, and payee transparency.
- Airtable has `Sheet` with at least 10,000 raw earning rows.
- Flat revenue records cannot support reliable payee balances or statement close.

Required data model:

- `royalty_imports`
  - org, source, filename, statement period, status, row counts, errors.
- `raw_earnings`
  - source row payload, period, ISRC/UPC, territory, platform, revenue stream, units/count, gross/net, currency.
- `earnings`
  - normalized and attributed rows linked to work/track/release/artist where possible.
- `payees`
  - usually contacts/users with payout identity metadata.
- `payout_splits` or `resolved_splits`
  - snapshot of payout split basis at statement close; do not rely on mutable roles forever.
- `statements`
  - payee, org, period, status, opening/closing balance.
- `statement_lines`
  - earning line allocations and adjustments.
- `balances`
  - running payee balance by org/currency.
- `payouts`
  - recorded payout events; do not initiate money movement in early versions.

Required workflows:

- AWAL/distributor CSV/XLSX importer first.
- Import preview and validation.
- Matching by ISRC/UPC/title with unresolved match queue.
- Period close that snapshots splits.
- Statement generation.
- Payee portal read-only statement/balance view.
- Payout recording and balance settlement.

Definition of done:

- The 10,000+ Airtable `Sheet` rows can be imported as raw earnings.
- A closed period produces stable statements.
- Payees can see their own statements and balances without admin data exposure.

### 4. Payee Portal

Status: Missing.

Required work:

- Add `payee` membership role.
- Add separate payee-facing layout/routes.
- Scope portal reads to the payee's contact/user identity plus org.
- Show releases, statements, balances, payout history.
- Prevent access to admin domain CRUD.
- Add tests for payee isolation.

Definition of done:

- A payee invite can be accepted.
- The payee only sees their own statements and related releases.

### 5. Billing And Entitlements

Status: Missing.

Required work:

- Add Stripe customer/subscription linkage to orgs.
- Add plan/feature/limit map independent of pricing strategy.
- Add webhook endpoint and idempotent event handling.
- Gate features server-side, not only in UI.
- Track usage: releases, artists, imports, payees, storage.
- Add billing settings page for owners.

Definition of done:

- A self-serve org can subscribe, change plan, cancel, and have limits enforced server-side.

### 6. Background Jobs

Status: Missing.

What exists:

- `npm run sweep` runs the validation sweep once and can be called by cron/systemd while a fuller job runner is deferred.
- `README.md` documents cron and systemd timer examples for host-level scheduling.

Required work:

- Choose job runner:
  - Recommended: Postgres-backed queue such as `pg-boss` or Graphile Worker.
  - Acceptable early option: cron plus idempotent endpoints, but import/statement jobs will outgrow this.
- Add jobs for:
  - scheduled validation sweep beyond the interim `npm run sweep` command
  - royalty import processing
  - statement generation
  - artist metrics fetch
  - stale-cache reconciliation
  - optional notification digests
- Add job run logging to replace Airtable `RUNS`.

Definition of done:

- Long-running imports and scheduled maintenance do not depend on a user request staying open.
- Failed jobs are visible and retryable.

### 7. Grants / Funding

Status: Implemented foundation / UI partial.

Airtable has:

- `Projects`: 3 records
- `Grants`: 48 records
- `Applications`: 1 record

Required data model:

- `projects`
  - name, status, total budget needed, target date.
- `grants`
  - funding body, program/category, URL, description, deadline/application date, requested/awarded amount, decision status/date.
- `grant_applications`
  - project, grant, status, amount applied, submission deadline, notes, attachments/documents.

Required UI:

- Funding pipeline page.
- Upcoming deadlines in Today Hub.
- Project detail with linked releases/calls/documents/tasks.

Implemented:

- `budget_projects`, `grants`, `grant_applications`, and application-document links.
- Airtable grant/application migration.
- Upcoming funding deadlines in Today Hub.

Definition of done:

- The Airtable grant/application data can be migrated.
- The Today Hub surfaces upcoming funding deadlines.

### 8. Artist Metrics History

Status: Missing.

What exists:

- Artists have current Spotify fields.

Airtable has:

- `Artist Metrics`: 6 records
- historical fields for TikTok, Instagram, Spotify, YouTube
- artist fields for Soundcharts URL/UUID, YouTube URL, image, priority, team, last/next metrics check

Required work:

- Add `artist_metrics` table:
  - org, artist, date, spotify followers/popularity, Instagram followers, TikTok followers, YouTube subscribers, source, fetched_at, error.
- Add missing artist profile fields:
  - YouTube URL, Soundcharts URL/UUID, image URL, genres, priority, mission statement, team members, last/next metrics check.
- Add scheduled fetch job.
- Add artist detail charts.

Definition of done:

- Current snapshots are separated from historical metric rows.
- Metrics can be graphed per artist over time.

### 9. Reporting Cadence

Status: Missing.

Airtable has:

- `Reporting`: 10 records
- `Reporting Weeks`: 53 records

Required work:

- Add `reporting_weeks` with start/end dates and label.
- Add `release_reporting` or link releases/events to reporting weeks.
- Add calendar/timeline view.
- Add dashboard filters by week.

Definition of done:

- Releases/events can be planned and reviewed by reporting week.
- Today Hub can show this week and next week context.

### 10. Daily Cockpit / Today Hub

Status: Partial.

What exists:

- Today Hub shows calls, blocked releases, and bugs.
- Today Hub now also shows open ops tasks with priority, due date, owner, and context.

Gaps:

- Grant deadlines are absent.
- Campaign milestones are absent.
- Reporting-week context is absent.
- Calls lack richer Airtable status/type/date buckets.
- Blocked release cards do not show next action/owner/reason deeply enough.

Required work:

- Add upcoming grant/application deadlines.
- Add campaign milestones.
- Add reporting week band.
- Add `release_next_action` / `why_blocked` / blocker owner semantics.

Definition of done:

- An operator can open Today Hub and know what to do next without checking Airtable.

### 11. Release Detail And Budget Workflow

Status: Partial.

What exists:

- Releases, tracks, readiness, and basic budget item pages.
- Release detail now shows release-scoped budget line items grouped by budget category/bucket.

Gaps:

- Airtable has Marketing, A&R, Digital, Publicity budgets and actual rollups.
- Catalog number, focus track, pitch notes, URI, genre, priority pitch, Samply link/date, event type, and blocked reason are missing or shallow.
- Side artists exist in schema but need release workflow integration.

Required work:

- Add release-level budget targets by bucket or derive targets from category config.
- Add catalog/focus/pitch/Samply fields if still operationally relevant.
- Add side artist manager on release detail.
- Add release activity/timeline section.

Definition of done:

- Release detail replaces Airtable Manager Release Overview and Clearance Audit views for daily use.

### 12. Campaigns And Radio Promo

Status: Partial.

What exists:

- `campaigns`, `radio_stations`, and `campaign_stations` exist.

Gaps from Airtable:

- Radio stations are missing fields such as school, address, role, radio type, support level, charting info.
- Campaigns have no deep task/pitch integration yet.
- Campaign station workflow needs a richer status/update surface.

Required work:

- Add missing radio fields or decide which are intentionally dropped.
- Add import/migration for 507 station records.
- Add campaign station outreach UI.
- Link campaigns to ops tasks and DSP pitches.
- Add campaign dashboard with status, platform, budget, KPIs.

Definition of done:

- Radio promo can run without Airtable.

### 13. Assets, Documents, And Storage

Status: Partial.

What exists:

- `media_assets` and `documents` tables exist.
- Storage helpers and upload-url endpoint exist.
- Storage keys are org-prefixed.
- `media_asset_files` records copied Airtable attachment binaries in Postgres.
- `scripts/airtable-copy-assets.ts` copied 15 Airtable release cover-art attachments to R2 for `true-nature`.

Gaps:

- File upload flow is not fully integrated across forms.
- File download/browse flow is not wired into product screens.
- `R2_PUBLIC_BASE_URL` is not configured in the current environment, so copied files are private R2 objects until a signed-download route or public base URL is added.
- Documents need legal/contract workflow depth.
- Media assets need rights/clearance status and usage/placement notes from Airtable.
- Release cover-art file rows are preserved by Airtable source IDs, but cannot be backlinked to release rows until release import/backfill runs.

Required work:

- Attach uploaded files to media/doc records.
- Backfill copied file rows to imported releases/media assets once those product rows exist.
- Add a signed-download endpoint or configure `R2_PUBLIC_BASE_URL`, then wire file links/previews into release/media/document screens.
- Add document file links/attachments and status workflow.
- Add media rights/usage fields or document why they are dropped.
- Add role/permission checks for upload/download endpoints.

Definition of done:

- Contracts, artwork, audio references, and campaign assets can live in the app with tenant-safe storage paths.

### 14. API, Validation, Errors, And Pagination

Status: Partial.

What exists:

- Zod validation helpers exist.
- Most API routes use service functions.
- Critical writes often use transactions.

Gaps:

- Error envelope is still `{ error: string }`; spec wants `{ error: { code, message } }`.
- 500 responses may leak raw error messages.
- List endpoints mostly lack real pagination/filter/sort.
- Some domain invariants live only in UI or permissive text fields.
- No global rate limiting or abuse protection.
- No API-level permission abstraction yet.

Required work:

- Standardize error envelope.
- Map known Postgres/validation/auth errors to stable codes.
- Hide raw server errors in production responses.
- Add pagination and filters to list endpoints.
- Add permission middleware/helpers.
- Add server-side enum validation and/or DB check constraints for key statuses.

Definition of done:

- API behavior is predictable enough for external customers and future integrations.

### 15. Database Integrity And Migrations

Status: Partial.

What exists:

- Drizzle schema and migrations exist.
- Indexes exist for many FKs and list fields.
- `org_id` indexes exist on current domain tables.
- Account-local unique indexes are tenant-scoped where identified so far.

Gaps:

- RLS policies are enabled; production still needs a dedicated non-owner runtime role with request-scoped tenant settings and isolation tests.
- FK `onDelete` behavior is not consistently declared in schema.
- Some delete behavior is manually implemented in handlers.
- Audit triggers cover core operational and financial tables; actor/request context requires the dedicated runtime transaction context.
- Several date fields are strings instead of `date`/`timestamp`.

Required work:

- Add explicit FK policies: cascade, restrict, or set null per relationship.
- Add more composite indexes for common org-scoped queries as usage patterns settle.
- Convert operational dates from text to date/timestamp where safe.
- Add audit log table:
  - org, actor, action, table, record id, before/after, timestamp.
- Add migration/backfill runbook.
- Add restore-tested backup runbook.

Definition of done:

- Referential integrity is enforced by the DB, not only by route code.
- Tenant isolation is backed by RLS.
- Mutations are auditable.

### 16. Security And Auth

Status: Internal-tool level, not SaaS-ready.

Gaps:

- No organization-aware auth context.
- No role/permission enforcement.
- No payee-specific isolation.
- Production secret strength must be verified.
- No audit log.
- No admin/support access model.
- No CSRF/session hardening review documented.

Required work:

- Add org and role context to `Astro.locals`.
- Add server permission helpers.
- Add support/admin access policy.
- Add audit log.
- Verify Better Auth secret, trusted origins, secure cookie behavior, and CSRF behavior for production.
- Add isolation/security tests.

Definition of done:

- A security review can show where every request gets user, org, and permission context.

### 17. Testing And CI

Status: Partial.

What exists:

- `npm run check` passes with 0 errors, 0 warnings, and 0 hints.
- `npm run build` passes.
- Vitest is configured through `npm test`.
- Pure readiness tests cover the core clearance rules.
- Pure sweep tests cover the main validation blocker collectors.
- `npm run ci` runs tests, Drizzle migration checks, Astro checks, and production build.
- GitHub Actions verification is configured to run the repository and release gates on pull requests and pushes to `main`.

Gaps:

- No API/service tests.
- No tenant isolation tests.
- No importer tests.
- No E2E smoke tests.
- No DB-backed readiness persistence tests yet.

Required work:

- Keep expanding pure readiness and sweep fixtures as Airtable edge cases are found.
- Add DB-backed service tests for persistence and recomputation.
- Add service tests for track/role/release mutations.
- Add sweep idempotency tests.
- Add tenant isolation tests after org work.
- Add importer fixture tests for AWAL/raw royalty data.
- Add Playwright smoke tests for login, Today Hub, release readiness, and critical CRUD.
- Keep the CI gate current as DB-backed tests, importer tests, and E2E smoke tests are added.

Definition of done:

- The core product promise is guarded by automated tests.

### 18. Data Migration

Status: Partial.

What exists:

- `scripts/airtable-parity.ts` can produce a read-only Airtable/Postgres parity report with table counts, key overlap checks, source-ID preservation checks, rights semantic tallies, Postgres orphan checks, and readiness cache risk checks.
- The latest local parity run confirmed Airtable has 33 tables and the `Sheet` royalty table has 28,096 records.
- `airtable_record_mappings` is now modeled in Drizzle with migration `0007_rare_mercury.sql`.
- `orgs` plus `org_id` on product/mapping tables are now modeled in Drizzle with migration `0008_mean_zaran.sql`.
- Tenant-scoped unique indexes are modeled in Drizzle and applied with migration `0009_steady_blue_shield.sql`.
- `org_memberships` and `org_invitations` are modeled in Drizzle and applied with migration `0010_illegal_morg.sql`; existing users are backfilled into `true-nature` when present.
- `media_asset_files` is modeled in Drizzle and applied with migrations `0011_eager_mikhail_rasputin.sql` and `0012_great_bulldozer.sql` to record tenant-scoped copied Airtable attachments.
- `dsp_pitch_releases` is modeled in Drizzle and applied with migration `0013_melodic_scorpion.sql` so DSP pitches can belong to multiple releases.
- `scripts/airtable-import.ts` supports dry-run planning and guarded insert-only `--apply` imports for the mapped M0 domains.
- `scripts/airtable-copy-assets.ts` supports dry-run planning and guarded `--apply` uploads for selected Airtable attachment fields. Airtable remains GET-only.
- Contacts have been imported to Neon under org `true-nature`: 183 contact rows and 183 Airtable mapping rows. Airtable has 184 Contact records; 1 record is intentionally blocked by a duplicate email constraint and is reported by dry-run as blocked, not pending.
- Artists and Releases have been imported to Neon under org `true-nature`: 12 artist rows, 15 release rows, and matching Airtable mapping rows. Three artists currently have no linked contact; this includes the artist tied to the blocked duplicate-email contact plus any Airtable artist rows without a mapped contact.
- Recordings and Release Tracks have been imported to Neon under org `true-nature`: 47 `works` rows, 50 `tracks` rows, and matching Airtable mapping rows. 49 tracks link to imported releases and works; 1 Airtable placeholder track has no source release/work links.
- Rights Lines have been imported to Neon under org `true-nature`: 122 `roles` rows and 122 Airtable mapping rows. All 122 roles link to works; 114 link to contacts. The 8 missing contact links all point to blocked Airtable contact `recsorOjyNwVzAX7y` (`Yunus Rosenzweig`, duplicate email `y@myracph.com`), which conflicts with imported contact `recclChC2GhDbIjAh` (`The Bird`).
- The validation sweep has been run after roles import: 15 releases and 50 tracks reevaluated, 4 tracks ready, 2 releases ready, and 88 logged validation issues across tracks/works/releases.
- Budget Categories, Budget Line Items, and DSP Pitches have been imported to Neon under org `true-nature`: 2 budget categories, 2 budget line items, and 3 DSP pitches with matching Airtable mapping rows. Budget items link to releases/categories; DSP pitches have 4 `dsp_pitch_releases` join rows, preserving the Airtable pitch linked to both `Star Witness` and `Cherry-Coloured Funk`.
- Airtable `ISRC Sequences` currently has 3 empty source rows; the importer skips them instead of creating guessed counters.
- Airtable asset metadata has been imported to Neon under org `true-nature`: 1 `Media Assets` row plus 17 `Assets` rows mapped into `media_assets`.
- Airtable release cover-art binaries have been copied to R2 under `true-nature/airtable-assets/...`: 15 objects and 15 `media_asset_files` rows, all linked to imported release rows. Airtable `Media Assets` had no attachment binaries during the latest copy pass, so that table remains metadata/file URL only.

Required work:

- Apply migrations `0007_rare_mercury.sql` through `0013_melodic_scorpion.sql` to any target database before using `npm run airtable:import -- --apply` or `npm run airtable:copy-assets -- --apply`.
- Dry-run and then apply Airtable migration for:
  - contacts reconciliation for the 1 blocked duplicate
  - release/event field parity beyond the imported core release rows
  - ISRC sequences once source rows contain counter values
  - DSP pitch recipient/campaign/task relationship parity
  - calls
  - bugs if useful
  - ops tasks
  - campaigns/radio stations/campaign stations
  - media assets/documents/side artists
  - grants/projects/applications
  - reporting weeks/reporting
  - artist metrics
  - royalty `Sheet` raw earnings
- Preserve Airtable record IDs in migration mapping tables or source ID columns.
- Re-run `npm run airtable:import -- --tables ... --max-records ...` for small subsets first, then full default mapped domains.
- Run `npm run airtable:parity -- --output AIRTABLE_PARITY_REPORT.md` against the populated target after migration.
- Add unresolved royalty match reporting once the raw earnings importer exists.
- Add readiness parity spot checks against selected Airtable release examples.
- Keep Airtable read-only during migration; all import writes go only to Postgres.

Definition of done:

- Airtable can be frozen as read-only without losing operational ability.

## PRD Milestone Gap Checklist

### M0 - Internal Trustworthy

Missing or incomplete:

- [ ] Finish Airtable core migration.
- [x] Import Contacts into the `true-nature` org, with 1 duplicate-email conflict documented as blocked.
- [x] Add readiness/clearance unit tests.
- [x] Expand sweep coverage for core M0 blockers.
- [x] Trigger sweep after readiness-critical API writes.
- [x] Add read-only Airtable/Postgres parity report tooling.
- [x] Add source mapping table and guarded dry-run Airtable importer.
- [x] Run tiny importer apply smoke test for 2 Contacts.
- [x] Import Airtable Artists and Releases into `true-nature`.
- [x] Import Airtable Recordings and Release Tracks into `true-nature`, with 1 placeholder track documented as missing source release/work links.
- [x] Import Airtable Rights Lines into `true-nature`, with 8 contact links documented against the blocked duplicate-email contact.
- [x] Run validation sweep after rights import and record readiness baseline.
- [x] Import Airtable Budget Categories, Budget Line Items, and DSP Pitches into `true-nature`.
- [x] Add and backfill multi-release DSP pitch join table.
- [x] Skip empty Airtable ISRC Sequence rows and document source-data gap.
- [x] Import Airtable `Media Assets` and `Assets` metadata into `true-nature`.
- [x] Copy Airtable release cover-art binaries to R2 for `true-nature` and link them to release rows in `media_asset_files`.
- [ ] Install the documented `npm run sweep` schedule on the host or replace it with a background-job runner.
- [x] Surface ops tasks in Today Hub.
- [x] Surface bucketed release budgets on release detail.
- [x] Apply migration `0007_rare_mercury.sql` on Neon before importer `--apply`.
- [x] Apply migration `0008_mean_zaran.sql` on Neon to add `orgs` and `org_id` foundations.
- [x] Apply migration `0009_steady_blue_shield.sql` on Neon for tenant-scoped unique indexes.
- [x] Apply migration `0010_illegal_morg.sql` on Neon for memberships and invitations.
- [x] Apply migrations `0011_eager_mikhail_rasputin.sql` and `0012_great_bulldozer.sql` on Neon for copied Airtable file records.
- [x] Apply migration `0013_melodic_scorpion.sql` on Neon for multi-release DSP pitch links.
- [ ] Run Airtable parity against the populated target database after migration.
- [ ] Verify release readiness parity against Airtable examples.

### M1 - Design Partners

Missing:

- RLS and isolation tests.
- Workspace switcher.
- Onboarding wizard.
- Invitation UI/acceptance flow.
- Role/permission checks.
- Same-org relationship checks.
- Pagination and safer API errors.

### M2 - Money Parity

Missing:

- Royalty imports.
- Raw earnings.
- Normalized earnings.
- Attribution/matching.
- Statements and statement lines.
- Balances.
- Payout records.
- Payee portal.
- Importer tests.

### M3 - Public Beta

Missing:

- Stripe billing.
- Entitlements.
- Pricing enforcement.
- Grants/funding pipeline.
- Audit log.
- Error tracking/observability.
- Support/admin tooling.
- Backup and restore runbook.

### M4 - Differentiators

Missing or partial:

- Artist metrics history and scheduled fetch.
- Reporting cadence.
- Campaign/radio depth.
- Self-hosted/open-core packaging decisions.
- Advanced dashboards and reporting.

## Recommended Build Order

1. Freeze and test the readiness engine.
2. Finish M0 UI gaps: Today Hub ops tasks and release budget buckets.
3. Add org model, `org_id`, scoping helpers, and RLS.
4. Add tenant isolation tests and migrate current data into one org.
5. Build Airtable migration coverage for all non-skipped tables.
6. Add background job runner.
7. Build royalty import pipeline from Airtable `Sheet` shape.
8. Build statements/balances/payouts/payee portal.
9. Add billing/entitlements.
10. Add grants/reporting/artist metrics and deeper campaign/radio workflows.

## Do Not Port As Product Tables

These Airtable tables should generally be replaced by app infrastructure, not copied as first-class product domains:

- `Implementation Log` -> git history plus audit log
- `Schema Snapshots` -> Drizzle migrations
- `RUNS` -> job run logs
- `Assets` -> object storage plus media/documents, unless specific records are operational assets
- `Personal Writings` -> out of product scope unless explicitly desired

## Open Decisions

- Should Better Auth's organization plugin be used, or should orgs/memberships remain custom tables?
- Should `Neighboring` rights become a first-class clearance scope?
- Should entered-vs-confirmed shares become explicit columns, or is status weighting enough?
- When should `works` split into master/composition? Current recommendation remains: defer until covers/re-recordings force it.
- Which royalty source gets first importer support: AWAL, Stem/FUGA export, or the current Airtable `Sheet` shape?
- What pricing model should billing enforce: flat label tiers, revenue tiers, or ops-free/money-paid?
- Which Airtable AI fields should be rebuilt, ignored, or replaced by deterministic logic?
