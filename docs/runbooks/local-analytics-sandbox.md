> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Local analytics sandbox

Use this workflow only for a disposable local PostgreSQL database named `analytics_sandbox`. It seeds the real Analytics query path with `analytics-sandbox-v1` records, so the workspace is useful while provider ingestion is paused.

> **Fictional data only.** The artists, releases, tracks, metrics, import run, and values are deterministic fictional fixtures—not production analytics. Do not use them for reporting or decisions.

## Preconditions and boundaries

1. Use a local PostgreSQL service and an existing local Label Suite organization. The seeder will not create or rename the organization, and a signed-in user still needs membership in that organization to view its Analytics workspace.
2. Provider ingestion remains paused. The seed command and this Astro workflow do not contact Sisense or another provider, upload files, or start a provider job. Do not run a separate provider worker or ingestion command in this sandbox shell.
3. Use only an allowlisted local database host: `localhost`, `127.0.0.1`, `postgres`, `postgresql`, `database`, or `analytics-sandbox-postgres`. The decoded database name must be exactly `analytics_sandbox`.
4. Do not put any `ANALYTICS_SANDBOX*` value in Dokploy, CI, a shared environment, or production. The app rejects `ANALYTICS_SANDBOX=1` outside Astro development mode. The local Astro process must use the exact same `analytics_sandbox` URL for `DATABASE_URL` and `ANALYTICS_SANDBOX_DB_URL`, and the signed-in organization must equal `ANALYTICS_SANDBOX_ORG_ID`.

The seed command needs all four variables: `ANALYTICS_SANDBOX=1`, `ANALYTICS_SANDBOX_DISPOSABLE=1`, `ANALYTICS_SANDBOX_ORG_ID`, and `ANALYTICS_SANDBOX_DB_URL`. It reads only its dedicated `ANALYTICS_SANDBOX_DB_URL`; it never falls back to `DATABASE_URL`.

## Create, migrate, and seed

Run these commands from the repository root. Replace only the local username, local password, and existing local organization ID placeholders.

```bash
createdb analytics_sandbox
DATABASE_URL=postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox npm run db:migrate
ANALYTICS_SANDBOX=1 ANALYTICS_SANDBOX_DISPOSABLE=1 ANALYTICS_SANDBOX_ORG_ID=<local-org-id> ANALYTICS_SANDBOX_DB_URL=postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox npm run analytics:sandbox:seed
ANALYTICS_SANDBOX=1 ANALYTICS_SANDBOX_DISPOSABLE=1 ANALYTICS_SANDBOX_ORG_ID=<local-org-id> ANALYTICS_SANDBOX_DB_URL=postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox DATABASE_URL=postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox npm run astro -- dev --background
```

The seed command reports `artists=3`, `releases=3`, `tracks=5`, `metricRows=78`, and `importRuns=1`. A missing migration stops the transaction and tells you to run `npm run db:migrate` against `analytics_sandbox`.

Open `/analytics` while signed in to the specified organization. The page reads the seeded database through its normal server queries and displays the persistent status banner: `Sandbox data — fictional local fixtures, not production analytics.`

Manage the local server with:

```bash
astro dev status
astro dev logs
astro dev stop
```

## Verify the seed

Run this count query after seeding. It checks only the chosen organization's `analytics-sandbox-v1` records.

```bash
psql postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox -c "
  select
    (select count(*) from label_suite.artists where org_id = '<local-org-id>' and id like 'sandbox-v1-<local-org-id>:%') as artists,
    (select count(*) from label_suite.releases where org_id = '<local-org-id>' and id like 'sandbox-v1-<local-org-id>:%') as releases,
    (select count(*) from label_suite.tracks where org_id = '<local-org-id>' and id like 'sandbox-v1-<local-org-id>:%') as tracks,
    (select count(*) from label_suite.analytics_import_runs where org_id = '<local-org-id>' and id like 'sandbox-v1-<local-org-id>:%' and metadata ->> 'sandbox_fixture' = 'analytics-sandbox-v1') as import_runs,
    (select count(*) from label_suite.analytics_metric_rows where org_id = '<local-org-id>' and id like 'sandbox-v1-<local-org-id>:%' and dimensions ->> '_sandbox_fixture' = 'analytics-sandbox-v1') as metric_rows;
"
```

Expected counts are `3`, `3`, `5`, `1`, and `78` respectively. Then confirm the banner and seeded charts on `/analytics`; the banner is intentionally not dismissible.

For a confirmed disposable target, the optional live integration fixture checks first seed, idempotent reseed, organization isolation, shared Sisense advisory locking, and the real analytics query path after the second seed. It creates and removes only its own temporary fixture and sentinel organizations; it never drops the database. CI performs this live real-query probe in its disposable integration lane.

```bash
ANALYTICS_SANDBOX_DB_URL=postgresql://<local-user>:<local-password>@127.0.0.1/analytics_sandbox npm run test:analytics-sandbox-fixture
```

## Reset

Re-run the same deterministic seed command from **Create, migrate, and seed**. It replaces only sandbox-marked analytics rows and import runs for the specified organization, then upserts the same fictional catalog records. Do not drop a database or run broad delete commands as part of this workflow.

## Refusals and recovery

The command fails closed before opening a database connection when a marker is missing, the organization ID is malformed, the URL is not PostgreSQL, it has a query string or hash, its host is not allowlisted, or its database is not exactly `analytics_sandbox`. Each boundary failure begins with:

```text
Refusing analytics sandbox target:
```

Do not override a refusal by changing application code, repointing the seeder at another database, or substituting provider credentials. Create or select the correct disposable local target, confirm the organization already exists, correct the local variables, and rerun the command.

`ANALYTICS_SANDBOX=1` is evaluated from the server runtime environment on the Analytics page. It enables the banner only in development; it cannot be enabled by a URL parameter or cookie. If it is present in a production runtime, the page throws `Refusing analytics sandbox mode in production.` Remove the marker from that environment rather than bypassing the guard.
