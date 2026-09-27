# API Mutation Inventory

Provider lifecycle and data-ownership policy are maintained in
[`integration-inventory.md`](./integration-inventory.md).

**Status:** `active`  
**Reviewed:** 2026-08-10
**Tracking:** GitHub issues #43 and #165

This inventory covers unsafe method exports (`POST`, `PUT`, `PATCH`, and
`DELETE`) under `src/pages/api` and `src/pages/invite`.

`src/server/api-route-policy.test.ts` enforces that every listed route uses a
named capability or remains in the explicit exception allowlist. Browser-authenticated unsafe
`/api/*` requests also pass the same-origin check in `src/middleware.ts`.
Native bearer routes follow the exception documented in `api-conventions.md`.

## Named capability routes

| Capability | Routes and methods |
|---|---|
| `workspace.manage_members` | `invitations/index.ts` POST; `invitations/[id]/resend.ts` POST; `invitations/[id]/revoke.ts` POST; `members/[userId].ts` PATCH/DELETE |
| `workspace.manage_settings` | `settings/workspace.ts` PATCH |
| `projects.mutate` | `budget-projects/index.ts` POST/PATCH |
| `budgets.mutate` | `budget-items.ts` POST/PUT; `budget-line-items/index.ts` POST/PATCH; `budget-line-items/[id].ts` DELETE; `budget-line-items/[id]/variance.ts` POST; `funding-sources/index.ts` POST/PATCH; `funding-sources/[id].ts` DELETE; `funding-sources/[id]/status.ts` PATCH |
| `fundraising.mutate` | `funding-needs.ts` POST/PUT; `funding-profiles.ts` POST/PUT; `grant-deadlines.ts` POST; `grants.ts` POST/PUT/DELETE; `grant-applications.ts` POST/PUT/DELETE; `grant-applications/[id]/funding-needs.ts` PUT; `grant-applications/[id]/requirements.ts` PUT |
| `contacts.mutate` | `contacts.ts` POST/PUT/DELETE; `organizations.ts` POST/PUT/DELETE; `contact-organizations.ts` POST/PUT/DELETE; `contact-enrichment-suggestions.ts` PUT |
| `grant_documents.mutate` | `budget-line-items/[id]/documents.ts` POST; `grant-applications/[id]/documents.ts` POST/PUT/DELETE; context mode in `storage/upload.ts` and `storage/optimize-image.ts` |
| `integrations.manage` | `gmail/connect.ts` POST; `gmail/enrich.ts` POST; `releases/[id]/samply.ts` POST; `releases/[id]/samply/link.ts` POST; `releases/[id]/samply/sync.ts` POST; `samply/projects.ts` POST |
| `royalties.mutate` | `royalties.ts` POST/PUT/DELETE; `royalties/import.ts` POST; `royalties/import-stem.ts` POST |
| `variance.decide` | `variance-requests/[id]/approve.ts` POST; `variance-requests/[id]/reject.ts` POST |
| `operations.mutate` | `native/artists.ts` POST; `native/artists/[id].ts` PATCH; `native/tasks/[id].ts` POST (canonical Task complete, defer, reschedule, or reassign only); `artists.ts` POST/PUT/DELETE; `bugs.ts` PUT; `campaigns.ts` POST/PUT/DELETE; `campaigns/[id]/communicator-prompt.ts` PUT; `campaigns/[id]/public-page.ts` POST; `campaigns/[id]/public-page/review.ts` POST; `campaigns/[id]/radio-update-drafts.ts` POST; `campaigns/[id]/radio-update-drafts/manual.ts` POST; `campaign-leads/[id]/enrichment-runs.ts` POST; `campaign-enrichment-suggestions/[id].ts` PATCH; `campaign-leads/[id]/drafts.ts` POST; `campaign-outreach-drafts/[id].ts` PATCH; `campaign-outreach-drafts/[id]/approve.ts` POST; `campaign-leads/[id]/record-sent.ts` POST; `campaign-leads/[id]/stage-override.ts` POST; `campaign-leads/[id]/preparation.ts` PATCH; `campaign-stations.ts` POST/PATCH/DELETE; `catalog.ts` POST/PUT/DELETE; `documents.ts` POST/PUT/DELETE; `dsp-pitches.ts` POST/PUT; `email/send.ts` POST; `email/templates.ts` POST/PUT/DELETE; `media-assets.ts` POST/PUT/DELETE; `ops-tasks.ts` POST/PUT/DELETE; `radio-stations.ts` POST/PUT/DELETE; `release-milestones.ts` POST/PUT; `releases.ts` POST/PUT/DELETE; `releases/[id]/isrc.ts` POST; `roles.ts` POST/PUT/DELETE; `settings/isrc/generate.ts` POST; `settings/local-tool-tokens.ts` POST; `settings/local-tool-tokens/[id].ts` DELETE; legacy mode in `storage/upload.ts`, `storage/upload-url.ts`, and `storage/optimize-image.ts`; `sweep.ts` POST; `tracks.ts` POST/PUT/DELETE; `works.ts` POST/PUT/DELETE |

## Local-tool bearer routes

These routes do not accept a browser session as authority. They authenticate a
hashed, revocable, tenant-scoped local-tool bearer token; resolve its current
organization membership and `operations.mutate` capability; and require the
exact scope below. The token never grants Accept/Reject, canonical lead, draft,
task, page, stage, publication, delivery, or email authority.

| Route and method | Required bearer scope | Mutation boundary |
|---|---|---|
| `local-tools/v1/campaign-enrichment/queue.ts` GET | `campaign.enrichment.read` | Read-only prioritized queue. |
| `local-tools/v1/campaign-enrichment/items/[id].ts` GET | `campaign.enrichment.read` | Read-only bounded item context. |
| `local-tools/v1/campaign-enrichment/items/[id]/claim.ts` POST | `campaign.enrichment.claim` | Creates or renews an expiring work lease; does not update the lead. |
| `local-tools/v1/campaign-enrichment/items/[id]/claim/[claimId].ts` DELETE | `campaign.enrichment.claim` | Releases the token owner's lease; does not update the lead. |
| `local-tools/v1/campaign-enrichment/items/[id]/proposals.ts` POST | `campaign.enrichment.propose` | Atomically creates one `codex_mcp` run and cited pending suggestions; no decision or canonical mutation. |
| `local-tools/v1/operator/jobs/health.ts` GET | `operator.diagnostics.read` | Read-only, tenant-scoped queue counts and worker health; excludes payloads, lease owners, and idempotency keys. |
| `local-tools/v1/operator/operations-brief.ts` GET | `operator.diagnostics.read` | Read-only, tenant-scoped release or campaign readiness projection with bounded record identifiers and links. |

The two local-tool POST bodies use the shared 512 KiB streaming reader before
schema parsing, with bounded JSON depth/node checks. All listed operations emit
strictly allowlisted structured telemetry; resolved-tenant events are also
written best-effort to the existing `audit_logs`. Audit payloads exclude bearer
and hash material, proposal/evidence/fetched text, contact data, and raw errors.

## Owner-only publication boundary

| Guard | Route and method | Reason |
|---|---|---|
| `owner` | `campaigns/[id]/public-page/publish.ts` POST | Explicit publish or unpublish confirmation; no content mutation or send authority. |

## Justified exceptions

| Route | Guard | Reason |
|---|---|---|
| `invitations/accept.ts` POST | authenticated user, same-origin request, continuation cookie, one-time invitation token | The destination workspace is established by the verified invitation; the user is not a member before acceptance. |
| `storage/download-url.ts` POST | active organization membership plus storage-key authorization | This POST creates a signed read URL and does not mutate domain state. |
| `storage/download-urls.ts` POST | active organization membership plus storage-key authorization | This batched POST creates signed read URLs and does not mutate domain state. |
| `invite/exchange.ts` POST | same-origin request and verified invitation token | Establishes an invitation continuation before authentication/workspace membership. |

## Non-unsafe routes with elevated access

The following `GET` routes are not mutation handlers but intentionally require
more than ordinary membership:

| Route | Guard | Reason |
|---|---|---|
| `gmail/callback.ts` GET | `integrations.manage` | OAuth callback persists integration credentials. |
| `royalties/payouts.ts` GET | `royalties.mutate` | Payout preview contains finance-sensitive data. |
| `royalties/payouts/export.ts` GET | `royalties.mutate` | Export contains finance-sensitive data. |
| `samply/status.ts` GET | owner role | May verify provider credentials and expose integration configuration. |
| `jobs/index.ts` GET | `operations.mutate` | Exposes sanitized workspace job status and failure summaries. |
| `jobs/health.ts` GET | `operations.mutate` | Exposes workspace queue-depth and expired-lease metrics. |
| `settings/local-tool-tokens.ts` GET | `operations.mutate` | Lists safe metadata for the signed-in organization; never returns a token secret or secret hash. |

## Validation exceptions

Most JSON mutation routes use `parseJson` with a Zod schema. The routes below
use another bounded input form or have no JSON body:

- `storage/upload.ts` uses bounded multipart parsing and attachment schemas.
- `releases/[id]/isrc.ts`, Samply ensure/sync routes, and `sweep.ts` derive their
  input from authenticated context or validated route parameters.
- DELETE routes for budget lines and funding sources validate the route ID in
  their domain mutation.
- invitation resend/revoke routes validate the route ID and use no JSON body.

These exceptions must not be expanded without updating both this inventory and
`api-route-policy.test.ts`.
