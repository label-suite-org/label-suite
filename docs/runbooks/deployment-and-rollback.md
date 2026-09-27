> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Deployment and Rollback

This checklist applies to every Label Suite production deployment. Record the
commands, timestamps, merged SHA, Dokploy deployment, operator, and evidence
links in the tracking issue.

## Before deployment

- Confirm the pull-request GitHub verification is green before the
  intended commit merges on `main`; post-merge verification is evidence, not the
  Dokploy trigger.
- Confirm Dokploy's installed GitHub App tracks the canonical repository's `main` with
  auto-deploy enabled; GitHub Actions does not deploy production.
- Review every unapplied migration in journal order.
- Verify a recent database backup and its non-production restore procedure.
- Record current health revision, database migration level, and relevant feature
  flags.
- Confirm production values are present only in the Dokploy Project/Environment.

## Deployment order

1. Pause scheduled enqueues if the release changes job payload contracts.
2. Let Dokploy build from the merged checkout and derive the image revision; do
   not configure `APP_COMMIT_SHA` or another mutable runtime revision.
3. Let `label-suite-migrate` apply migrations and exit successfully.
4. Start and health-check `label-suite-worker` at the embedded SHA.
5. Start and health-check `label-suite` at the same embedded SHA.
6. Require `GET /api/health` to return HTTP 200 with web, database, and worker
   all `ok`, and require `revision` to exactly match the approved merged SHA.
   Record/remediate an ancillary aggregate `degraded` status separately.
7. Run authenticated smoke checks for the affected workspace; this is not
   replaced by the health endpoint.
8. Resume scheduled runs only through the Dokploy scheduler (or a reviewed
   one-shot profile) and confirm a safe job can enqueue and finish.
9. Watch structured logs for errors, expired leases, and retry growth.

The deployment is not successful until health and affected signed-in flows pass.

## Application rollback

1. Prefer a reviewed revert or forward-fix pull request to `main`; GitHub
   verifies it and Dokploy auto-deploys the resulting merged SHA.
2. Pause scheduled enqueues and confirm queued payload compatibility before
   changing worker code.
3. If an emergency rollback must use existing Dokploy deployment history, obtain
   explicit owner approval and record the selected SHA, operator, reason,
   database compatibility, health result, and signed-in evidence.
4. Reconcile an emergency Dokploy rollback immediately through GitHub so
   `origin/main` remains source of truth.
5. Resume scheduling only after worker compatibility is confirmed.

If a worker dies on a final attempt, verify that lease expiry moves the job to
`failed` with `LEASE_EXPIRED` rather than leaving a forever-running record.

Migrations `0050` and `0051` are additive and retain previous inline job
tracker columns, so application rollback does not require dropping them. Prefer
a forward-fix migration over destructive schema rollback.

## Database recovery

Never restore over production as the first diagnostic action. Restore the chosen
backup into an isolated database, verify migration journal state and core row
counts, then choose an application rollback against compatible current schema, a
reviewed forward-fix migration, or a controlled production restore with an
explicit maintenance window.

## Secret rotation

Rotate one credential class at a time in Dokploy Project/Environment variables,
restart affected services, run the smallest safe provider check, and revoke the
old credential only after success. Record the credential name and rotation time,
never its value.
