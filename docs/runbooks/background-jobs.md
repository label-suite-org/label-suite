> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Background Jobs

Label Suite uses PostgreSQL as its durable queue. The web process enqueues work;
the worker process claims it with `FOR UPDATE SKIP LOCKED`, renews a lease while a
handler runs, and retries failures with bounded exponential backoff.

Workers and the validation scheduler run for one workspace, selected by
`LABEL_SUITE_WORKER_ORG_ID` (default `true-nature`). Compose sets PostgreSQL
`PGOPTIONS` on these services so every connection carries that workspace
context, including queue claims, heartbeats, and Calendar updates. RLS remains
enabled; web requests keep their authenticated transaction context.
For another workspace, run a separate worker with its own workspace and worker IDs.

## Production processes

Dokploy owns all production worker, scheduler, and Sisense operations. Do not
run `docker compose` directly on the production host: use the configured Dokploy
Compose service and its scheduled or one-shot task controls instead.

The `label-suite-worker` is the supervised service from the production image.
Configure normal validation scheduling as exactly one Dokploy scheduled task for
the `label-suite-scheduler` profile. A reviewed one-off run also starts from the
same Dokploy Compose service; it does not use a local checkout or host command.

Sisense ingestion has a separate checkout-derived-revision Playwright runner,
`label-suite-sisense-sync`. It stays idle under Dokploy supervision so a
Dokploy Compose schedule can execute a reviewed command inside the running
Playwright-capable container. It must not be added to the validation scheduler.
The Compose default is deliberately inert: it never scrapes, imports, uploads,
or applies by itself.

After the first healthy web/worker promotion and explicit importer approval,
configure exactly one Dokploy scheduled task for that service with this
explicit command:

```sh
npm run sisense:sync -- --recent --apply
```

Keep the task disabled until the initial promotion is healthy, then schedule
it from Dokploy. Do not create a host systemd unit or timer. Existing importer
advisory locking prevents a second overlapping sync from publishing a run.
Sisense credentials remain in Dokploy's project environment; never add them to
Compose arguments or logs.

The scheduled environment must include the exact provider artist/track names
for track-scoped widgets. The runner selects and verifies those dashboard
filters before export, waits up to `SISENSE_DOWNLOAD_TIMEOUT_MS` for slow CSV
materialization (maximum 30 minutes), and refuses to publish a partial widget
set or replay a partial scrape manifest.

For an approved Phase A diagnostic, use an explicit scrape-only command such
as `npm run sisense:scrape -- --date-range "7 Days" --aggregation Daily`.
`--mode scrape` rejects `--apply`, takes the same advisory lock when
`DATABASE_URL` is available, and writes no analytics database rows or R2
objects. It emits one `SISENSE_DIAGNOSTIC_SUMMARY` JSON log line and writes a
matching `diagnostic-summary.json` beside its local raw artifacts. That summary
contains only run/filter/widget/file counts, CSV row counts, and SHA-256 hashes;
it excludes URLs, credentials, source rows, CSV bodies, and screenshots.

If a scrape exits through its top-level error path, it emits one separate
`SISENSE_DIAGNOSTIC_FAILURE` JSON log line with exactly
`{"version":1,"code":"..."}`. The only version-1 codes are
`configuration`, `database_setup`, `browser_launch`,
`provider_navigation_authentication`, `provider_filters`,
`widget_export_resolution`, `diagnostic_artifact_writing`,
`diagnostic_summary_writing`, and `unexpected`.
The controller accepts exactly one bounded, schema-valid failure marker only
when there is no valid success summary; it strips all other input, persists the
version and code before cleanup, and reports that allowlisted code to the
operator. Duplicate, malformed, oversized, unknown-code, or conflicting
success/failure evidence fails closed.

This marker classifies the runner lifecycle stage only. It does not retain raw
logs, exception text, URLs, credentials, provider content, selectors, CSV data,
or screenshots, and it does not prove a provider root cause.

### Transport-proof mode before Phase A

With separate explicit owner approval, an operator may prove only the Dokploy
schedule transport and the deployed revision before requesting a Phase A
diagnostic. Add `--transport-proof` to the controlled controller invocation;
without that explicit flag, `npm run sisense:diagnostic` retains the normal
Phase A scrape command and result gate.

Transport-proof mode creates the same disabled, one-attempt schedule and uses
the same reservation, sanitized ledger, reconciliation, inventory checks, and
cleanup. Its deployed command is intentionally harmless: it reads only
`/app/.release-revision`, compares it with the supplied 40-hex expected
revision, and writes one bounded `LABEL_SUITE_TRANSPORT_PROOF` JSON marker with
the expected and observed revisions. It does not run `sisense:scrape`, contact
a provider, use provider credentials, write database/application data, or
apply analytics.

Transport success is not Phase A success. It requires terminal Dokploy status
`done`, exactly one schema-valid bounded proof marker, and exact equality of
the marker's expected and observed revisions with `--expected-revision`. A
successful result reports `transportProofSuccess: true` and
`phaseASuccess: false`; it does not validate widgets, source data, or
analytics readiness. Missing, duplicate, malformed, oversized, or
revision-mismatched proof evidence fails closed. Once reconciliation establishes
one attributable terminal deployment, that evidence failure remains safe to
clean up; the controller still restores the exact preflight schedule inventory.
An invalid release artifact is represented by the bounded literal `invalid`,
then fails the same exact-revision gate without exposing the artifact contents.
The ledger retains only the bounded validated proof fields and operational
fingerprints—never raw logs, commands, credentials, provider data, or error
payloads.

Dokploy's manual schedule result supplies terminal status, deployment ID, and
log path; its authenticated deployment-log stream can retrieve the bounded
marker. For an explicitly approved one-off, use `npm run sisense:diagnostic`
with an absolute `--evidence-file`, unique `--attempt-id`, the deployed
revision, and the current Dokploy identifiers. The command requires
`DOKPLOY_URL` plus `DOKPLOY_API_KEY` (or `DOKPLOY_AUTH_TOKEN`) in the approved
operator environment; do not put those values in arguments, shell history,
the evidence file, or a ticket. It atomically reserves
`~/.local/state/label-suite/sisense-diagnostic-controller.lock` (`0600`) before
inventory or schedule creation. The production CLI does not allow overriding
that global path. An existing lock is authoritative even if its recorded
process is no longer running; a second controller must stop before inventory.

The controller persists a `0600` sanitized ledger before it creates a disabled
temporary schedule and commits `manualInvocationCount: 1` before dispatch. It
snapshots the entire Compose schedule inventory, the complete Sisense schedule
subset, the Daily scheduler fingerprint, and the prior deployment history.
Whether the manual request succeeds, times out, exits non-zero, or returns a
malformed response, it reconciles bounded deployment history before cleanup.
It accepts exactly one attributable terminal deployment. Zero, multiple, or
non-terminal candidates remain unresolved and the disabled schedule is left in
place for review; a rerun using that ledger refuses to dispatch again.

For a known terminal deployment, the controller records the deployment
identifier, status, approved log path/server identifier, and a sanitized probe
outcome before deleting the temporary schedule. Phase A succeeds only when the
terminal result is `done`, the exact marker has a valid schema, coverage is
complete with no skipped widgets, total downloaded rows are positive, and the
effective-widget/filter evidence matches the requested seven-day Daily scrape.
It then verifies the exact Daily fingerprint and that no temporary or Sisense
schedules remain. Raw deployment logs and transport errors are never stored in
the ledger.

### Bounded manual recovery for a retained diagnostic lock

A retained lock means automation cannot prove the attempt is clean. Do not run
the controller again, do not invoke the schedule manually, and do not remove
the lock or ledger merely because no process is running. Recovery requires the
owner's explicit approval and this single bounded inspection:

1. Read only the lock and its referenced ledger. Record `attemptId`, `state`,
   `manualInvocationCount`, `scheduleRequest.name`,
   `scheduleRequest.fingerprint`, any saved `schedule.scheduleId`, the four
   preflight fingerprints, deployment evidence, and cleanup state. The
   deterministic name is the ledger value; never select by a partial prefix.
2. Capture the complete current Compose inventory with
   `dokploy schedule list --id <compose-id> --scheduleType compose --json`.
   Preserve its sanitized fingerprint and the exact Daily scheduler readback.
   Select zero or one candidate by exact `scheduleId` when recorded, otherwise
   by exact `scheduleRequest.name`. More than one candidate is unresolved and
   ends recovery without mutation.
3. Read the one candidate with
   `dokploy schedule one --scheduleId <schedule-id> --json`. It must be disabled
   and its request fingerprint must equal the ledger fingerprint. The request
   fingerprint is SHA-256 of `JSON.stringify` over this ordered object:
   `name`, `enabled`, `scheduleType`, `composeId`, `appName`, `serviceName`,
   `shellType`, `timezone`, `commandSha256`, `cronExpression`, `description`.
   `commandSha256` is SHA-256 of the candidate's exact readback command. A mismatch ends
   recovery without invocation or deletion.
4. List only that schedule's deployments with
   `dokploy deployment all-by-type --id <schedule-id> --type schedule --json`.
   Because the schedule is unique and temporary, every entry is attributable.
   Never increment or reset `manualInvocationCount`, and never call
   `run-manually` during recovery:

   - When the count is `1`, require exactly one deployment. Poll at most 120
     times at ten-second intervals. Zero, multiple, or still-nonterminal
     deployments remain unresolved and retain both files.
   - When the count is `0`, no invocation is permitted. The schedule may be
     deleted only when its exact readback matches and its deployment list is
     empty. Any deployment is reconciled with the count-`1` terminal rules and
     is never re-run.
   - Any other count is invalid and ends recovery without mutation.

5. A schedule with a deployment may be deleted only after exactly one
   attributable deployment reaches a known terminal status. First persist its
   deployment ID, status, log path, server ID, and sanitized probe outcome in a
   separate recovery record beside the immutable ledger. Probe failure is not
   Phase A success, but a known terminal deployment is cleanup-safe. Then run
   `dokploy schedule delete --scheduleId <schedule-id> --json` exactly once.
6. Capture the complete post-delete inventory. Require the temporary schedule
   to be absent, no schedule with the diagnostic prefix or Sisense service to
   remain, the full Daily scheduler fingerprint to equal the preflight Daily
   fingerprint, and the complete inventory fingerprint to equal the preflight
   inventory fingerprint. Any failed check retains the lock and ledger.
7. Only after the recovery record proves either (a) count `0`, exact disabled
   schedule, zero deployments, and verified deletion, or (b) one known terminal
   deployment and verified deletion, may the owner approve retirement. Archive
   the ledger and recovery record together, then remove the one exact lock
   path. Without that approval, both files remain in place.

The scheduler enqueues one `validation_sweep` per UTC date for every workspace
whose validation mode is `scheduled`. Its idempotency key makes repeated
deployment-level scheduling safe.

## Health and inspection

Owners and operators can inspect operator-safe job records through:

- `GET /api/jobs?limit=50`
- `GET /api/jobs/health`

These responses never include job payloads or results. Queue health includes
active-worker, queued, running, failed, expired-lease, and oldest-queued metrics.

Each worker updates `job_workers` while idle or busy and marks itself stopped
during graceful shutdown. A heartbeat older than 45 seconds is unhealthy.

Set `REQUIRE_WORKER_HEALTH=true` only after worker supervision is in place:

- Dokploy reports at least one `label-suite-worker` container running and healthy;
- Dokploy restart policy is active; and
- scheduler runs are controlled by one Dokploy scheduled task in production.

`/api/health` then returns HTTP 503 unless web, database, and at least one worker
are healthy.

## Recovery

An interrupted worker leaves its job in `running` until the lease expires. A
healthy worker then claims a new attempt. If the lease expires on the final
allowed attempt, the job transitions to `failed` with `LEASE_EXPIRED` as an
actionable non-retryable error. Do not manually rewrite running rows.

For a controlled one-off validation sweep that bypasses the queue:

```sh
npm run sweep -- --org <workspace-id>
```

This direct script remains available only for controlled recovery. On production,
it requires explicit owner approval and recorded provenance; normal API,
post-write, and scheduled sweeps use the durable queue through Dokploy.

Relevant optional settings:

- `LABEL_SUITE_WORKER_ID`
- `LABEL_SUITE_JOB_LEASE_MS` (default `60000`)
- `LABEL_SUITE_JOB_HEARTBEAT_MS` (default `20000`)
- `LABEL_SUITE_JOB_POLL_MS` (default `1000`)
