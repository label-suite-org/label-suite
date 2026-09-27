> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Observability

Server logs are newline-delimited JSON. The stable correlation fields are:

- `requestId`, `route`, `orgId`, `durationMs`, `outcome`, and `status` for web
  requests;
- `operation`, `orgId`, `durationMs`, and inherited `requestId` for observed
  database reads;
- `jobId`, `jobType`, `orgId`, `attempt`, `durationMs`, and `outcome` for jobs.

Errors include only a sanitized error class in logs and sanitized metadata in
the queue record. Payloads, results, cookies, authorization headers, and stack
traces are not structured log fields.

## Initial performance budgets

| Work | Budget |
|---|---:|
| API read p95 | 500 ms |
| API mutation p95, excluding provider latency | 750 ms |
| Primary SSR workspace render | 1,000 ms |
| Worker heartbeat interval | at most 60 seconds |

Request logs set `overBudget: true` and use warning severity whenever the
applicable per-request budget is exceeded. Initial query operations are:

- `grants.workspace`
- `budget.dashboard`
- `catalog.workspace`
- `today.workspace`
- `royalties.dashboard`

Compute p95 in the log platform by route or operation over a representative
window. Treat low-traffic p95 as directional until at least 100 samples exist.

## Analytics ingestion evidence

The Analytics → Data Health view computes tenant-safe summary fields:
`stale`, `failedRuns`, `unreviewedDuplicateCandidates`, `lastSuccessfulRunAt`,
and source-derived `reportingThrough`. It does not emit raw source rows,
downloaded CSV contents, or dashboard credentials. Investigate stale or failed
imports there; dispositions are review evidence and never merge or delete rows.
