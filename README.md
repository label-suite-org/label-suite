# Label Suite

> Fresh-history public verification candidate. See [publication status](PUBLIC_SOURCE.md).
> This repository is not yet the production deployment source.

Label Suite is the operations cockpit for independent labels: release pipeline, rights clearance, readiness validation, budgets, promo, assets, royalties, and eventually payee transparency.

The current stack is Astro SSR with React islands, Postgres/Drizzle, Better Auth, Tailwind, shadcn-style components, and R2/S3-compatible storage. See the [canonical product map](./docs/product/label-suite-product-map.md) for current product boundaries and recovery evidence. `GAP_ANALYSIS.md` is a historical PRD/spec/Airtable gap audit.

The canonical product hierarchy and object-ownership contract lives in
[`docs/product/label-suite-product-map.md`](./docs/product/label-suite-product-map.md).
Current execution status belongs to GitHub issues and pull requests; local specifications and
handoffs are historical/reference material.

## Architecture

Label Suite is a modular monolith: Astro renders authenticated pages on the
server, React islands provide interactive workspaces, Astro API routes expose
internal JSON endpoints, domain logic lives in `src/server`, and Drizzle persists
workspace-scoped data in PostgreSQL.

- [`docs/architecture-consolidation-plan.md`](./docs/architecture-consolidation-plan.md)
  defines the current consolidation sequence and acceptance criteria.
- [`docs/integration-inventory.md`](./docs/integration-inventory.md) is the
  authoritative registry for external services, data direction, canonical
  ownership, schedules, secrets, and recovery paths.
- [`INFRASTRUCTURE.md`](./INFRASTRUCTURE.md) documents the production topology,
  R2 delivery model, cache policy, and background-job direction.
- [`docs/project-management.md`](./docs/project-management.md) defines how
  implementation work is tracked.

## Setup

```sh
npm ci
```

Create `.env` with at least:

```sh
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=...
PUBLIC_SITE_URL=http://localhost:4321
```

For production, `BETTER_AUTH_SECRET` must be a random high-entropy value of at least 32 characters.

Storage-backed upload flows and Airtable asset copying also need:

```sh
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

Stable public object URLs additionally need:

```sh
R2_PUBLIC_BASE_URL=...
```

The Samply integration uses server-side environment variables:

```sh
SAMPLY_API_TOKEN=...
SAMPLY_BASE_URL=https://samply.app/api/v0
SAMPLY_ORG_ID=true-nature
```

Store the rotated Samply token in `.env` locally and in your deployment secret store for production. Do not expose it to client-side code or commit it to the repo.

## Development

Per `AGENTS.md`, start the dev server in background mode:

```sh
astro dev --background
```

Useful server commands:

```sh
astro dev status
astro dev logs
astro dev stop
```

## Verification

Run the same checks used by GitHub Actions:

```sh
npm run ci
```

Individual checks:

```sh
npm test
npm run db:check
npm run check
npm run build
```

## Validation Sweep

The readiness sweep recomputes clearance/readiness caches, upserts current auto-generated bugs, and closes resolved auto-bugs.

Normal API, post-write, and scheduled sweeps run through the durable PostgreSQL
job queue. In production, the `label-suite-worker` runs only through the
configured Dokploy-managed Compose service. Configure the scheduler as one
Dokploy scheduled task and run a reviewed one-off only through that service.
Do not run `docker compose` directly on the production host or keep a host
systemd timer, because either creates a second scheduling/deployment owner.
Sisense uses its separate Dokploy one-shot task after explicit approval; see
[`docs/runbooks/background-jobs.md`](./docs/runbooks/background-jobs.md).

For a direct command in a recovery shell:

```sh
npm run jobs:schedule
```

`jobs:schedule` enqueues one idempotent sweep per UTC date for each workspace
configured for scheduled validation.

The direct command remains available as a controlled recovery tool. In
production it requires explicit owner approval and recorded provenance:

```sh
npm run sweep -- --org true-nature
```

Check usage without touching the database:

```sh
npm run sweep -- --help
```

See [the background-jobs runbook](docs/runbooks/background-jobs.md) for health,
lease recovery, scheduler, and shutdown details.

## Sisense Distributor Analytics

True Nature distributor analytics can be imported from the shared Sisense/Periscope dashboard CSV exports. The dashboard has multiple chart widgets, so the worker loops through each configured widget and downloads one CSV per exportable chart. The pipeline is deliberately two-stage:

This is the current recurring analytics feed. Spotify, Apple, and Shazam
metrics arrive through these Sisense exports; Label Suite does not currently
call those providers directly.

1. Scrape/download raw CSV snapshots from Sisense with Playwright.
2. Parse, normalize, diff, and import changed metric rows into Neon analytics tables.

Raw CSVs are kept locally during the run and, when R2 is configured, uploaded under:

```txt
true-nature/distributor/sisense/<run-id>/<widget>.csv
```

For a disposable local development run, the first sync uses the full history
range by default:

```sh
npm run db:migrate
npm run sisense:sync -- --apply --initial
```

For a disposable local development run, the recent range is:

```sh
npm run sisense:sync -- --apply --recent
```

Defaults:

- initial range: `All Dates`
- recent range: `Yesterday`
- aggregation: `Daily`

`Yesterday` is the scheduled default because the job is expected to run more often than once per day after the first backfill. Sisense currently has no `Yesterday` preset: when that label is requested, the scraper selects the scoped `Custom Range`, submits the previous calendar day in `SISENSE_TIME_ZONE` (default `Europe/Copenhagen`), and verifies its `YYYY-MM-DD to YYYY-MM-DD` summary. Set `SISENSE_RECENT_DATE_RANGE` to another exact provider-supported label to use a preset instead. When artist/track scope is configured, the scraper now selects and visibly verifies the matching `True_Nature_Artists` and `True_Nature_Tracks` filters before export; track-scoped widgets require both values. `SISENSE_SKIP_FILTERS=true` is allowed only when all configured provider filters already match, otherwise the scraper fails rather than recording misleading provenance.

Analytics rows can be linked to the app's artist/release/track records. Prefer IDs when the dashboard link is dedicated to one artist or track:

```sh
SISENSE_SCOPE_ARTIST_ID=...
SISENSE_SCOPE_RELEASE_ID=...
SISENSE_SCOPE_TRACK_ID=...
```

Name/title resolution is also supported when `DATABASE_URL` is available:

```sh
SISENSE_SCOPE_ARTIST_NAME=True Blue
SISENSE_SCOPE_TRACK_TITLE=cherry-coloured funk
```

Rows with CSV-level track fields such as `track_title`, `primary_artist`, or `isrc` are resolved per row when possible. Aggregate widgets that only contain dimensions such as city/source/age inherit the configured run scope.

Useful disposable-local dry-runs:

```sh
npm run sisense:scrape -- --initial
npm run sisense:import -- --dir .data/sisense/true-nature/<run-id>
```

Required env for scraping:

```sh
SISENSE_DASHBOARD_URL=https://app.periscopedata.com/shared/...
SISENSE_DASHBOARD_PASSWORD=...
SISENSE_DOWNLOAD_TIMEOUT_MS=300000 # 5 minutes; maximum 1800000 (30 minutes)
SISENSE_ORG_ID=true-nature
SISENSE_SCOPE_ARTIST_NAME=True Blue
SISENSE_SCOPE_RELEASE_TITLE=Cherry-Coloured Funk
SISENSE_SCOPE_TRACK_TITLE=cherry-coloured funk
SISENSE_WIDGETS_JSON=[{"key":"tracks-by-growth-rate","title":"Tracks by Growth Rate"},{"key":"spotify-superfans-active-streams-city","title":"Spotify Superfans & Active Streams by City"},{"key":"spotify-demographics-passion-indicators","title":"Spotify Demographics by Passion Indicators"},{"key":"spotify-streams-source","title":"Spotify Streams by Source"},{"key":"apple-streams-source","title":"Apple Streams by Source"},{"key":"spotify-playlist-listings","title":"Spotify Playlist Listings"},{"key":"shazams-city","title":"Shazams by City"},{"key":"passion-indicator-benchmarks-genre","title":"Passion Indicator Benchmarks by Genre"}]
```

If `SISENSE_WIDGETS_JSON` is omitted, the script uses the True Nature widget list above. Every widget must resolve to one `.widget-container`; if Sisense markup changes, prefer updating `SISENSE_WIDGETS_JSON` with an explicit menu selector inside that container instead of changing code. The scraper opens that scoped menu, prefers a widget-local `Download Data` action, and accepts a provider-portal action only when exactly one page-level action becomes visible and remains the same action through a brief stabilization window. Stale, replaced, or ambiguous page-level actions remain skipped and make the run partial. The scraper records a widget as observed empty only when that scoped container explicitly says `Query returned no matching rows.`. A missing or disabled download action without that explicit state remains skipped and makes the run partial.

In production, use the Dokploy `label-suite-sisense-sync` one-shot/profile path
in the configured Compose service. After the first healthy web/worker promotion
and explicit importer approval, configure exactly one Dokploy scheduled task for
that service.

- First backfill: `npm run sisense:sync -- --apply --initial`
- Subsequent runs: `npm run sisense:sync -- --apply --recent`

Do not configure Coolify, a host cron, or a second worker/scheduler owner for
this integration.

### Manual dated Tracks by Growth Rate snapshot

Preview and import are separate actions. Preview reads the CSV and catalog;
Import writes dated evidence and archives the exact CSV in the private analytics
bucket.

**Interpretation:** Streams and views are cumulative provider totals. The entered
dates identify the Sisense snapshot and growth context, not streams or views earned
during that period. Never sum snapshot totals together.

1. In Sisense, visibly set the artist/filter, reporting range, and aggregation.
2. Export only the **Tracks by Growth Rate** widget as CSV.
3. In Label Suite, open **Analytics → Data Health**.
4. Select the same artist and enter the exact same start date, end date, and aggregation shown in Sisense.
5. Upload the CSV and choose **Preview file**.
6. Review matched, unmatched, duplicate, and total counts. Acknowledge unmatched rows only after reviewing them.
7. Choose **Import this snapshot**. This is the mutation step; it stores rows and private archive evidence.
8. Confirm the latest evidence shows the expected artist, exact dates, aggregation, file hash, counts, and current rows. Treat it as the current cumulative evidence; compare it with earlier snapshots, but never add snapshot totals together.

For an exact duplicate replay, the response `runId` identifies the completed run
matched by the uploaded file. Its `latest` object still identifies the newest
completed run for that artist, including a newer corrected snapshot when one exists.

Do not use a public-media URL for the source CSV. The production archive is
`R2_ANALYTICS_PRIVATE_BUCKET`; it must stay distinct from `R2_BUCKET` and have
no public development URL or custom domain.

### Spotify for Artists audience history

1. In Spotify for Artists, select the artist and export Audience timeline as CSV.
2. In Label Suite, open Analytics → Data Health → Spotify for Artists CSV.
3. Select the matching Label Suite artist and the downloaded CSV.
4. Review the recognized date range, row count, metrics, and SHA-256.
5. Choose Import this file; retain Spotify for Artists as the live operational source.

Supported columns: date, listeners, monthly listeners, monthly active listeners,
super listeners, streams, playlist adds, saves, followers.

The importer does not retrieve royalties, geography, demographics, stream sources,
editorial pitches, ad preferences, delivery, or release metadata.

## Samply Integration

Samply is a good fit for Label Suite as an external playback, review, share-link, and upload-portal layer. It is not a substitute for Label Suite's readiness, rights, metadata, or approval model.

The current implementation can:

1. Create or link a Samply project per release.
2. Create players and synchronize the remote file inventory.
3. Render review/playback information inside release workflows.
4. Resolve authorized downloads and read file comments.

Automatic webhook ingestion and durable scheduled Samply synchronization remain
future work, so the integration is classified as `partial`, not merely planned.

To confirm the server-side env is wired correctly:

```sh
npm run samply:smoke
```

See [`samply-integration-spec.md`](./samply-integration-spec.md) for the proposed architecture, surfaces, data model, and rollout order.

## Multi-Tenant Workspaces

Protected requests resolve an active workspace in middleware and store it on `Astro.locals`. Existing operational Airtable content belongs to the `true-nature` org. The first Better Auth user claims `true-nature` as owner if it has no members yet; later users without a membership get their own empty workspace.

Current tenant safety pieces:

- `orgs`, `org_memberships`, and `org_invitations` tables
- `org_id` on domain tables and Airtable mapping rows
- org-scoped page/API service calls for the main product domains
- org-prefixed storage upload keys
- tenant-scoped unique indexes for account-local values
- Postgres RLS enabled on tenant tables with `tenant_isolation` policies
- trigger-backed audit history for core operational and financial records

Still required before external customers: use a dedicated non-owner runtime database role, set request-scoped `app.current_org_id`/`app.current_user_id`, add tenant isolation tests, complete role permission checks, and finish same-org relationship validation.

## Airtable Parity Report

PostgreSQL is canonical. Airtable is a migration-only source used for controlled
parity checks, imports, and asset backfills; it is not an ongoing two-way feed.

The parity report reads Airtable and Postgres, then prints a Markdown migration report. It is read-only: Airtable calls are GET-only and Postgres calls are SELECT-only.

```sh
npm run airtable:parity
```

Useful options:

```sh
npm run airtable:parity -- --help
npm run airtable:parity -- --output AIRTABLE_PARITY_REPORT.md
npm run airtable:parity -- --counts-only
npm run airtable:parity -- --max-records 100
```

Required env:

```sh
AIRTABLE_API_KEY=your-airtable-personal-access-token
AIRTABLE_BASE_ID=your-airtable-base-id
DATABASE_URL=postgres://...
```

## Airtable Import

The importer is conservative by design:

- dry-run is the default
- Airtable calls are GET-only
- Postgres writes happen only with `--apply`
- `--apply` only inserts missing product rows and mapping rows
- no deletes, truncates, or product-row updates are performed
- imported rows are assigned to one org via `AIRTABLE_IMPORT_ORG_ID`, defaulting to `true-nature`
- media/document imports map metadata and file URLs only; copying file binaries to tenant-safe object storage is handled by `airtable:copy-assets`

List supported tables:

```sh
npm run airtable:import -- --list-tables
```

Dry-run all default mapped tables:

```sh
npm run airtable:import
```

Dry-run a small table subset:

```sh
npm run airtable:import -- --tables contacts,artists --max-records 10
```

Apply inserts after migrations have been run:

```sh
npm run airtable:import -- --apply
```

## Airtable Asset Copy

The asset-copy job copies Airtable attachment binaries into R2. It is also conservative by design: dry-run is the default, Airtable calls are GET-only, and `--apply` only uploads missing objects plus records copied files in Postgres.

Dry-run:

```sh
npm run airtable:copy-assets
```

Apply:

```sh
npm run airtable:copy-assets -- --apply
```

The importer preserves Airtable record IDs as Postgres IDs and writes a row to `airtable_record_mappings` for each imported record. Run migrations before using `--apply`.

## Royalty Sheet Import

The royalty migration importer copies transformed Airtable `Sheet` rows into `royalty_imports` and `royalty_earnings`, matches normalized ISRCs to works/tracks/releases, and preserves unresolved rows. It is a one-off backfill path, not the production distributor-file importer. Airtable access is GET-only and dry-run is the default.

```sh
npx tsx scripts/royalty-sheet-import.ts
npx tsx scripts/royalty-sheet-import.ts --apply
```

The schema also contains split snapshots, statements, statement lines, ledger entries, and recorded payouts, but this script does not generate or post them. The current implementation does not initiate money movement.

For SaaS migration work, treat Airtable content as True Nature account data, not global starter content. New customer orgs should receive empty workspaces or explicit templates, not the imported operational catalog.

Current Airtable import status:

- Airtable `Media Assets` and `Assets` metadata has been imported into `media_assets` under `true-nature`: 18 rows total.
- Airtable Artists and Releases have been imported into `true-nature`: 12 artists and 15 releases, with mappings preserved.
- Airtable Recordings and Release Tracks have been imported into `true-nature`: 47 works and 50 tracks, with mappings preserved. 49 tracks link to both an imported release and an imported work; 1 Airtable placeholder track has no release/work links in the source.
- Airtable Rights Lines have been imported into `true-nature`: 122 roles, with mappings preserved. All 122 roles link to works; 114 link to contacts. The 8 missing contact links point to one blocked duplicate-email Airtable contact.
- The validation sweep has been run after rights import: 4 tracks ready, 2 releases ready, and 88 logged validation issues across tracks/works/releases.
- Airtable Budget Categories, Budget Line Items, and DSP Pitches have been imported into `true-nature`: 2 categories, 2 budget items, and 3 DSP pitches. Budget rows link to releases and categories; DSP pitches use `dsp_pitch_releases`, with 4 release links so the multi-release Airtable pitch is preserved.
- Airtable `ISRC Sequences` currently has 3 empty source rows, so they are intentionally skipped instead of creating invented counters.
- Airtable grants/applications are mapped into `grants` and `grant_applications`, with upcoming deadlines surfaced in Today Hub.
- Airtable royalty `Sheet` rows are imported into `royalty_earnings`; unmatched ISRC rows remain visible for attribution instead of being dropped.
- Airtable release cover-art binaries have been copied for `true-nature`: 15 R2 objects under `true-nature/airtable-assets/...` and 15 rows in `media_asset_files`, all linked back to imported release rows.
- Airtable `Media Assets` had no attachment binaries at the last copy pass, so only metadata/file URL notes were imported for that table.
- The copied R2 objects are tenant-prefixed and private. The app still needs either a signed-download route or `R2_PUBLIC_BASE_URL` plus UI wiring before these files are browsable from product screens.
