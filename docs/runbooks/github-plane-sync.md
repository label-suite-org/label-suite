> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Historical GitHub to Plane sync operator runbook

> **Archived, non-executable historical context.** This document preserves
> evidence for the retired GitHub-to-Plane transport only. Do not create a
> GitHub repository/App, webhook, deployment, recovery, or rollback path from
> these procedures. Current operators must follow the Forgejo and Dokploy
> [repository source-of-truth runbook](repository-source-of-truth.md); its
> delivery and recovery rules supersede every imperative below.

## Authority and safety boundary

The `plane-sync` service is a separate, one-replica Dokploy Compose application
from canonical `origin/main`. Forgejo issues and pull requests are the current
implementation source of truth. This runbook retains the former GitHub transport
as historical migration context only. Plane remains the roadmap projection and
may retain manual planning fields that the sync does not manage.

GitHub Actions is verification-only: it has `contents: read`, no runtime
environment, no Plane credentials, and no deployment authority. Woodpecker is
retired and must not be reintroduced. Dokploy's installed GitHub App observes a
reviewed merge to `main`, builds that checkout, and deploys the resulting
service. Do not build from a local worktree, copy files to a host, or deploy by
calling Dokploy from CI.

The image is a pinned Node 24 image, runs as UID/GID `10001` (`plane-sync`),
uses `/app` as a read-only-friendly runtime directory, and persists only
`/data/plane-sync.sqlite` on the `plane-sync-data` volume. It exposes internal
port `8787`; it has no fixed container name, host port, or network.

## Dokploy configuration

Create one separate Dokploy application after the pull request is merged:

- repository: `label-suite-org/label-suite_neon_r2`;
- branch: `main` with Dokploy GitHub App auto-deploy enabled;
- Compose path: `ops/plane-sync/compose.yml`;
- one replica and persistent volume `plane-sync-data`;
- internal service port `8787` and domain `plane-sync.truenature.online`.

Copy only names and placeholders from
[`github-plane-sync.env.example`](github-plane-sync.env.example). Store actual
values only in Dokploy's protected environment; never in Git, CI, shell history,
logs, issue comments, or this runbook. Keep `SYNC_WRITE_MODE=dry-run` until all
dry-run gates below are recorded.

The Compose file does not require a materialized `.env` file. Dokploy's protected
environment values are interpolated directly into the service's explicit
`environment` mapping at deploy time. Credentials and identity values use
fail-closed required interpolation; deployment stops before container creation
when one is missing. Safe runtime defaults (such as the internal bind address,
port, database path, and queue timing) are fixed or explicitly defaulted in the
Compose contract. Never commit or materialize a runtime `.env` file in the
checkout.

Dokploy preprocesses its tracked Compose control file with protected runtime
values before starting the build. Alongside standard local/runtime ignores, the
root `.dockerignore` excludes both Dokploy controller paths:
`ops/plane-sync/compose.yml` and its materialized sibling
`ops/plane-sync/.env`. Dokploy can still use those files to create the service,
but their rendered values cannot enter a Docker layer, image, or image history.
Tracked `.env.example` documentation remains in the verified build context. The
build verifies every other tracked file in the effective context against the
checkout's exact `HEAD`, and fails when Git metadata is absent, another tracked
file is dirty, or the legacy `PLANE_SYNC_REVISION` build argument is supplied.
Git metadata is deleted before the runtime stage and never enters the runtime
image.

Cloudflare must route `plane-sync.truenature.online` to this Dokploy service.
GitHub needs unauthenticated transport access to `POST /github`; do not put an
interactive Cloudflare Access login in front of that path. The webhook itself
is protected by HMAC verification and the repository allowlist. Keep `GET
/health` deliberately minimal and do not expose the SQLite volume.

## GitHub App and key handling

Create a dedicated GitHub App owned by `label-suite-org`, install it only on
`label-suite_neon_r2`, and grant only Metadata read, Issues read, and Pull
requests read. Subscribe only to `issues`, `issue_comment`, `pull_request`,
`pull_request_review`, `pull_request_review_comment`, `installation`, and
`ping`.

The installation ID is the stable identifier for this repository installation;
it is not a credential to rotate. The service uses the App private key to mint
and cache GitHub's automatic short-lived installation access tokens. Reinstall
the App only if the installation itself is removed or its repository scope or
permissions cannot be repaired in place.

Use an independent webhook secret. Convert the PEM to a single base64 line
locally and paste it directly into Dokploy; do not echo the output in a shell or
save it in the repository. For example, use a command that sends its output
directly to a protected clipboard, then clear the clipboard after pasting. The
key's exact value must never appear in terminal capture, CI output, or support
material.

## First deployment: dry run first

After GitHub Actions has verified the merged revision, let Dokploy deploy the
matching `main` checkout. Do not claim completion from a green CI run alone.

1. Confirm Dokploy's deployed checkout SHA equals the merged SHA and the
   service is healthy.
2. Request `https://plane-sync.truenature.online/health`; require HTTP 200 and
   a `revision` exactly equal to that 40-character merged SHA.
3. Confirm `GET /github` returns 404, unsigned or modified `POST /github`
   returns 401, and a wrong-repository signed delivery returns 422. Do not
   place a production signature or payload in an issue, CI log, or shell
   history.
4. In the Dokploy service console, run `node dist/cli.js bootstrap --dry-run`
   and `node dist/cli.js reconcile --dry-run`. Review every planned object,
   mapping, state, and comment before applying anything.
5. With `SYNC_WRITE_MODE` still `dry-run`, test one signed delivery and confirm
   it is durable but produces no Plane mutation.

Only an approved controller may then run `bootstrap --apply` and
`reconcile --apply`, inspect the dedicated `[System] GitHub to Plane sync
health` item, and later authorize changing just `SYNC_WRITE_MODE=active` for a
controlled lifecycle. Those are rollout gates, not part of this repository
delivery task.

## Health and failure operations

`GET /health` reports `ok`, `degraded`, or `failed` plus sanitized queue
counts, timestamps, error code, and revision. A retry backlog or stale
reconciliation is `degraded`; a bad credential, unavailable persistent store,
ambiguous mapping, or permanent delivery failure is `failed`. HTTP readiness is
non-200 only when the service cannot safely accept and persist a new delivery.

For `degraded`, retain the durable queue, inspect sanitized Dokploy logs and
the most recent reconciliation result, then rerun reconciliation only after
the upstream cause is understood. For `failed`, stop changing Plane state,
preserve the SQLite volume, and correct the scoped credential, mapping, or
storage fault before a dry-run reconciliation. Never delete deliveries to make
health appear green; retry and permanent-failure evidence is part of recovery.

### Permanently failed delivery recovery

Use recovery only after the failure cause has been corrected and an approved
operator has reviewed the exact delivery IDs. Do not edit the SQLite database
or replay a webhook manually. From the stopped or otherwise controlled service
console, first run the same explicit command in dry-run mode for every intended
delivery:

```text
node dist/cli.js recover-failed --dry-run --delivery-id <exact-id> [--delivery-id <exact-id> ...] --reason <reviewed-reason> --operator <operator-id>
```

The report contains only requested, eligible, and requeued counts. It never
prints delivery envelopes, actors, payloads, keys, or tokens. Treat the reason
and operator flags as durable audit metadata: use concise operational text and
never place a secret or webhook body in either value.

If the dry run reports the expected eligible count, repeat it with `--apply`.
The apply operation is all-or-nothing: duplicate, unknown, non-failed, or
pruned-envelope IDs fail the entire request without requeuing any target. A
successful apply preserves the retained compact envelope, creates an immutable
local audit record with the prior error and attempt count, clears the terminal
outcome and lease, and resets the delivery to a fresh pending attempt. Confirm
the next worker cycle and health state before resuming normal operations.

## Rotation, backup, restore, and rollback

Rotate GitHub App private keys, the webhook secret, and the Plane API token one
at a time. Add the replacement value in Dokploy, recreate the service, prove
health and a dry-run reconciliation with the new credential, then revoke the
old credential. GitHub installation access tokens are short-lived and renewed
automatically; the installation ID is not rotated. Reinstall the App only when
the installation itself must be recovered. Record only the rotation time and
operator, never values or fingerprints that disclose a secret.

Before any manual storage operation, stop the `plane-sync` service through
Dokploy so SQLite has no writer. Take a volume-level backup containing
`plane-sync.sqlite` and, when present, its `-wal` and `-shm` companions. Store
the backup in the approved encrypted location with its timestamp and merged
SHA. Rehearse restore into an isolated, disposable Dokploy volume with
`SYNC_WRITE_MODE=dry-run`, no public webhook route, and approved non-production
credentials; verify migrations, `/health`, and a dry-run reconciliation before
considering a backup usable. Do not overwrite the production volume during a
rehearsal.

To roll back, identify the last verified merged `main` SHA, submit a reviewed
revert pull request, require GitHub Actions, merge it to `main`, and let
Dokploy's GitHub App auto-deploy that exact merge. Verify Dokploy's SHA and
`/health` again. A local image, direct `main` push, or manual host copy is not
a rollback path.
