> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Label Suite production deployment

Production is a Dokploy Docker Compose application. GitHub is the source and
review authority, GitHub Actions performs verification only, and Dokploy is the
only production runtime owner. The delivery path is:

pull request -> GitHub Actions verification -> merged `main` -> Dokploy GitHub
App observes merge push and auto-deploys -> migration -> worker -> web ->
exact-SHA health check.

Neither a local checkout nor a feature branch may deploy production.

## Authority and secret boundaries

| Store | Purpose |
| --- | --- |
| GitHub repository | Source, pull requests, GitHub Actions workflow, and non-secret examples |
| GitHub Actions | Disposable verification database, test fixtures, build/release-gate evidence; no production deployment or runtime secrets |
| Dokploy Project/Environment | All production runtime values and the production Docker Compose service |
| Dokploy GitHub App | Repository access to track `main` and initiate Dokploy's native deployment |

GitHub Actions must not receive Dokploy credentials, production runtime
credentials, or a deployment token. Dokploy Project/Environment variables are
the sole home for real production values. Do not copy literal values into the
service-level Environment tab, GitHub Actions, or the repository.

`compose.prod.yml` uses Dokploy's generated project environment file through
`env_file`; the contract is the variable names in
`docs/runbooks/dokploy-production.env.example`, populated once in the Dokploy
Project/Environment. The Compose service Environment tab contains the 42
`${{project.NAME}}` references, never their real values and never
`APP_COMMIT_SHA`. This is the project-reference contract: Compose consumes the
generated environment, while the values remain owned by Dokploy.

## Dokploy project setup

Create or select the Label Suite production Project/Environment and a Docker
Compose service with:

- source provider: the installed Dokploy GitHub App;
- repository: `label-suite-org/label-suite_neon_r2`;
- branch: `main`;
- Compose path: `compose.prod.yml`;
- Compose type: Docker Compose, not Docker Stack;
- auto deploy: **on**;
- one Dokploy-owned deployment lane, so Compose deployments remain serialized.

The GitHub provider must show an active installation with access to the
repository. “Action Required” is not deploy-ready. Preview the converted Compose
before the first deployment and verify that it has no fixed container names or
legacy external network.

### GitHub App webhook ingress

The Label Suite repository owns only its exact shared-Caddy site fragment at
`ops/dokploy-webhook-ingress/Caddyfile`. The reconciliation, fail-closed public
probe, reload, rollback, signed-delivery evidence, and retired-hook inventory
are maintained in `docs/runbooks/dokploy-webhook-ingress.md`. Keep the rule
restricted to exact `POST /api/deploy/github`; do not expose the Dokploy UI or
restore the retired `/github` deployment hook on that host.

Dokploy builds from the checked-out source itself. The Docker build runs
`scripts/write-build-revision.sh` while `.git` is present and embeds the
validated 40-character checkout SHA in `.release-revision` for the web and
worker images. Operators must not configure `APP_COMMIT_SHA` in Dokploy; the
runtime reads the embedded revision file instead. A missing or malformed
revision fails the image/runtime contract.

## Private native Assets and Documents

Before enabling native capture or private previews, configure
`R2_ASSETS_PRIVATE_BUCKET` in Dokploy. It must be a dedicated private bucket,
different from the public-media `R2_BUCKET`. Missing or equal configuration
fails closed. Configuration alone does not prove privacy: record a readback
that the bucket's public development URL is disabled and it has no custom
public domains. Use the same public-access verification described below.

Provider activation and credential-scope changes require their own owner
approval. Preserve the existing private rollback configuration before any
change; keep credentials in Dokploy only. Extend existing object permissions
only to the approved bucket; do not introduce account-wide access.

On a disposable acceptance workspace, verify an operator can upload from
Files, interrupt and retry the same intent without duplicating the resource,
preview with fresh signed access, and link/unlink its context. Verify read-only
members cannot upload and another workspace cannot read the record or bytes.
Signed previews expire after 60 seconds and must never be recorded in public
logs or evidence. Physical camera/scanner acceptance is separate from simulator
checks. Uploads are limited to 25 MB; scans to 20 pages at 1024 pixels per page.

Migration `0095_private_resource_uploads.sql` adds recoverable upload
intent tracking. Database failure after object upload may leave a private
object for retry; do not delete it as deployment cleanup. A rollback must retain
these objects and the intent table, and use the existing exact-SHA Dokploy
rollback lane. Signing out or losing workspace access removes local drafts;
warn operators to finish uploads or keep originals before doing so.

## Private Spotify and Sisense analytics archive

Provision the CSV evidence boundary before enabling either Spotify or dated
Sisense apply in production. Preview is read-only; the final import is the
mutation that uploads the exact source CSV and writes database evidence.

1. In Cloudflare R2, create a dedicated private bucket named by
   `R2_ANALYTICS_PRIVATE_BUCKET`; it must differ from the public-media
   `R2_BUCKET`.
2. Create S3 credentials with **Object Read & Write**, scoped to only
   `R2_BUCKET` and `R2_ANALYTICS_PRIVATE_BUCKET`. Do not grant Admin access or
   account-wide bucket access. Store the access key and secret only in Dokploy
   Project/Environment. See [Cloudflare's R2 token
   permissions](https://developers.cloudflare.com/r2/api/tokens/).
3. Add `R2_ANALYTICS_PRIVATE_BUCKET` from
   `docs/runbooks/dokploy-production.env.example` to Dokploy and confirm the
   application value is not equal to `R2_BUCKET`.
4. In R2, open the private bucket's **Settings**. Record that **Public Access**
   is disabled, **Public Development URL shows Disabled**, and **Custom Domains
   has no entries**. If either access path is present, stop; do not import a
   file. Cloudflare documents both independent public paths in its [public
   bucket controls](https://developers.cloudflare.com/r2/buckets/public-buckets/).
5. Re-open the token summary and record that its permission is **Object Read &
   Write** and its bucket scope lists only the two named application buckets.
   This readback is the provisioning gate; it does not upload a CSV or change
   Cloudflare/Dokploy state.
6. Confirm the application never stores or displays a public URL for analytics
   source files. Evidence may contain only the private bucket name and object
   key. Stop if a public development URL, custom domain, or public-media bucket
   appears in the Sisense import evidence.

Before each production Sisense import window, complete this 60-second readback:

1. `R2_ANALYTICS_PRIVATE_BUCKET` is present and is not equal to `R2_BUCKET`.
2. R2 shows **Public Access: Disabled**, **Public Development URL: Disabled**, and no custom domains.
3. The S3 token has **Object Read & Write**, not Admin, and is scoped only to the two named application buckets.
4. The operator has completed preview and reviewed identity quality; no file has been uploaded by preview.
5. Final import remains an explicit operator mutation. Record the resulting private bucket/key, hash, counts, and latest evidence—never a public URL.

## Compose lifecycle and scheduler boundary

Dokploy runs the production Compose lifecycle in this order:

1. `label-suite-migrate` first verifies the restricted `DATABASE_URL` runtime
   principal is neither `SUPERUSER` nor `BYPASSRLS`, applies migrations through
   the separate elevated `MIGRATION_DATABASE_URL`, then reconnects through
   `DATABASE_URL` to verify every Phase 1 financial table uses
   `FORCE ROW LEVEL SECURITY`, and exits.
2. `label-suite-worker` starts from the same checkout-derived revision and
   becomes healthy.
3. `label-suite` starts only after the migration and worker gates succeed.
4. Dokploy routes `suite.truenature.online` to the web container on port 4321.

`DATABASE_URL` is the restricted runtime connection and must be
`LOGIN NOSUPERUSER NOBYPASSRLS`. `MIGRATION_DATABASE_URL` is available only to
the one-shot migration service; Compose explicitly blanks it in web, worker,
scheduler, and Sisense services even though Dokploy materializes both values in
the shared environment file. The orchestrator also removes the elevated value
from each child process and substitutes it as `DATABASE_URL` only while
`drizzle-kit migrate` runs. No database role or credential is created by
repository migrations.

The complete postflight table set is centralized in
`scripts/royalty-runtime-db-posture.ts` as `REQUIRED_FORCE_RLS_TABLES`; the SQL
migration contract cross-checks every entry so the verifier and migration
cannot silently diverge.

The normal scheduler is a profile-based one-shot service, off by default. The
Sisense Playwright runner is supervised but idle by default so Dokploy can run
explicit reviewed commands inside it; credentials alone never activate
scraping. Configure either operational command as a Dokploy scheduled task
only after its enqueue or importer behavior has been explicitly reviewed. Do
not add a host timer, systemd unit, or second scheduler owner.

## Cutover from the retired delivery path

Perform this rollout only after a reviewed pull request has merged and its
GitHub Actions verification is green:

1. Record the exact merged `main` SHA and the current known-good deployment.
2. In the existing Dokploy service, change the source from the legacy branch or
   source setting to the installed GitHub App tracking `main`.
3. Enable Dokploy auto-deploy and let Dokploy serialize the resulting Compose
   deployment. Do not trigger deployment from a local checkout.
4. Verify that the migration completes, then the worker and web services become
   healthy at the checkout-derived SHA.
5. Verify `GET /api/health` returns HTTP 200 with `web`, `database`, and
   `worker` all `ok` and `revision` exactly equal to the merged SHA. Record any
   ancillary `degraded` aggregate status separately.
6. Run the affected signed-in browser workflow. Health and authenticated browser
   evidence are distinct gates.
7. Record the Dokploy deployment, exact revision, health response, browser
   result, and rollback point on the issue or pull request.
8. Only after these gates pass, merge dependent work such as issue #114.

## Rollback and recovery

The normal rollback path is a reviewed revert or forward-fix pull request to
`main`; GitHub Actions verifies it and Dokploy auto-deploys that merged SHA.
Prefer additive/forward migrations over destructive schema rollback.

If production needs an emergency recovery before Git can be restored, use a
known-good entry in Dokploy deployment history only with explicit owner
approval. Record the selected SHA, operator, reason, database compatibility,
health result, and signed-in evidence; then promptly reconcile the exact change
through GitHub with a pull request. Emergency Dokploy history is a recovery
record, not a second source of truth.

## Verification and evidence

Before a pull request, run the focused checks plus:

```sh
npm run deploy:check
npm run ci
bash scripts/repository-flow-check.sh pr
```

After merge, retain the pull-request verification and post-merge GitHub Actions
re-verification evidence, then record the Dokploy deployment, exact
`/api/health` revision, migration/worker state, and signed-in browser evidence.
A green GitHub Actions run, a queued Dokploy deployment, or a healthy container
alone is not production acceptance.

## Historical note

Woodpecker was retired from the active Label Suite delivery path. There are no
Woodpecker workflows, secrets, immutable deploy tags, or manual deployment
triggers in the current contract.
