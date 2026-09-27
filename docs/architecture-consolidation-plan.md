# Architecture Consolidation Plan

**Status:** `in_progress`  
**Baseline:** `b3f5900` (2026-07-26)  
**Scope:** Framework, API, data, security, background work, and repository maintenance  
**Execution source of truth:** GitHub Issues, as defined in `docs/project-management.md`

## Progress

| Phase | Status | Tracking |
|---|---|---|
| Phase 0 — Governance and reproducibility | `complete` | GitHub issue #42 |
| Phase 1 — API and authorization contracts | `complete` | GitHub issue #43 |
| Phase 2 — Split database schema | `complete` | GitHub issue #44 |
| Phase 3 — Decompose oversized modules | `complete` | GitHub issue #45 |
| Phase 4 — Durable background jobs | `in_progress` | GitHub issue #20 |
| Phase 5 — Operational readiness | `in_progress` | GitHub issue #46 |

## 1. Objective

Consolidate the current Label Suite modular monolith before adding another major
integration or product domain.

This plan does not replace product specifications. It defines the technical work
required to keep the existing system safe, understandable, and operable while the
grants, funding, release, catalog, royalty, and analytics domains continue to grow.

The target outcome is:

- one documented and enforced application architecture;
- smaller domain modules with explicit boundaries;
- consistent API authorization, validation, and error handling;
- a navigable, domain-split Drizzle schema without changing runtime behavior;
- one package manager and reproducible CI installs;
- a durable background-job execution model;
- clear separation between proposed, active, and shipped specifications;
- no regression in tenant isolation, tests, migrations, or production builds.

## 2. Current baseline

As of the baseline commit:

- Astro 7 provides SSR pages and file-based API routes.
- React 19 provides hydrated interactive islands.
- `src/server` contains application/domain services.
- Drizzle ORM accesses PostgreSQL through `src/lib/db.ts`.
- Better Auth stores users and sessions in PostgreSQL.
- Organization tenancy is carried through `Astro.locals.orgId`.
- Authorization uses membership roles and capability checks from
  `src/server/tenant.ts`.
- Cloudflare R2 stores private media and documents.
- Integrations include Airtable, Sisense, Samply, Gmail, and email delivery.
- `docs/integration-inventory.md` defines each provider's lifecycle, direction,
  canonical-data policy, execution path, configuration, and recovery behavior.
- Validation sweeps run through the PostgreSQL durable worker; other recurring
  provider work still uses scripts or host scheduling until migrated.
- CI runs tests, Drizzle validation, Astro checks, and the production build.

Baseline verification:

| Check | Result |
|---|---|
| Vitest | 444 passed, 16 skipped |
| Drizzle schema check | Passed |
| Astro check | 0 errors |
| Production build | Passed |
| Working tree | Clean |

Current scale indicators:

| Area | Current size |
|---|---:|
| API route files | 77 |
| Domain tables | 73 |
| Better Auth tables | 4 |
| Test files | 57 |
| `src/db/schema.ts` | 1,616 lines |
| `src/server/grants-workspace.ts` | 896 lines |
| `src/components/settings/SettingsShell.tsx` | 1,424 lines |
| `src/components/contacts/ContactsBook.tsx` | 1,452 lines |

## 3. Architectural decisions

These are constraints for the consolidation work.

### AD-1: Retain the modular monolith

Do not split Label Suite into deployable microservices. Astro pages, API routes,
domain services, and database access remain in one application and one deployment.

Reason: the current operational scale does not justify distributed deployment,
cross-service authentication, or network-level consistency problems.

### AD-2: Preserve the server-rendered page pattern

Authenticated Astro pages continue to load initial data directly from server
services and pass it into React islands. React components use `/api/*` for
subsequent reads and mutations.

### AD-3: PostgreSQL remains the operational source of truth

R2 remains object storage. Airtable, Sisense, Samply, Gmail, Discogs, and future
finance providers are external sources or projections, not parallel operational
databases.

### AD-4: Tenant and authorization checks stay server-side

Client capability maps control affordances only. Every mutation must independently
resolve the organization and enforce a server-side capability.

### AD-5: Prefer domain modules over generic infrastructure abstractions

Split code by business domain and use case. Do not introduce a generic repository,
dependency-injection, command-bus, or event-bus framework unless a concrete use case
requires it.

### AD-6: New integrations wait for consolidation gates

Do not start production Discogs or Revolut integration work until Phases 0–3 are
complete. Specification and research may continue.

## 4. Target module shape

Each substantial domain should converge on this structure where useful:

```text
src/
  db/
    schema/
      organizations.ts
      catalog.ts
      releases.ts
      grants.ts
      budgets.ts
      royalties.ts
      analytics.ts
      integrations.ts
      index.ts
  server/
    <domain>/
      queries.ts
      mutations.ts
      schemas.ts
      types.ts
      core.ts
      *.test.ts
  pages/
    api/
      <domain>/
  components/
    <domain>/
```

This is a target, not a requirement to create empty files. Small domains may remain
in one server file. Pure computations belong in `core.ts`; database access belongs
in queries or mutations.

## 5. Execution plan

### Phase 0 — Establish governance and reproducibility

**Priority:** P0  
**Estimated effort:** 1–2 days  
**Dependencies:** None

#### Work

1. Select npm or pnpm as the only package manager.
2. Remove the unused lockfile in a dedicated commit.
3. Make CI use the selected package manager's frozen/clean install command.
4. Add a `packageManager` field to `package.json`.
5. Add a status header to every active document under `docs/superpowers/specs`:
   `proposed`, `approved`, `in_progress`, `shipped`, or `superseded`.
6. Add a short architecture section to `README.md` linking to this plan and
   `INFRASTRUCTURE.md`.
7. Create one GitHub issue per phase. Product feature issues must link to, but not
   duplicate, these consolidation issues.

#### Acceptance criteria

- A fresh checkout installs reproducibly with one documented command.
- Exactly one root dependency lockfile is tracked.
- Local CI and GitHub CI use the same package manager.
- Every current specification has an explicit lifecycle status.
- `npm run ci` or its chosen-package-manager equivalent passes.

### Phase 1 — Harden API and authorization contracts

**Priority:** P0  
**Estimated effort:** 2–3 days  
**Dependencies:** Phase 0

#### Work

1. Change `handleApiError` so unexpected errors:
   - are logged server-side with request-safe context;
   - return `{ "error": "Internal server error" }`;
   - never return raw database, provider, path, or secret-bearing messages.
2. Add a request/correlation ID to error logs and API error responses.
3. Inventory all mutation routes and record:
   - HTTP method;
   - input schema;
   - required capability;
   - organization scoping;
   - audit/event behavior.
4. Replace broad `requireMutateRole` usage with the narrowest applicable
   `requireCapability` check.
5. Add contract tests covering unauthenticated, wrong-role, wrong-organization,
   invalid-input, conflict, and unexpected-error cases.
6. Document the internal API convention in `docs/api-conventions.md`.

#### Required route convention

Every mutation route must follow this order:

1. resolve authentication and active organization;
2. require a named capability;
3. parse and validate input with Zod;
4. invoke one domain mutation;
5. return a standard JSON response;
6. translate expected domain errors;
7. log and mask unexpected errors.

#### Acceptance criteria

- No API route exposes an unexpected exception message.
- Every mutation route declares a named capability.
- No mutation trusts a client-supplied `org_id`.
- Cross-organization access tests exist for storage, grants, budgets, catalog,
  members, invitations, releases, and royalties.
- All CI checks pass.

### Phase 2 — Split the database schema by domain

**Priority:** P1  
**Estimated effort:** 2–4 days  
**Dependencies:** Phase 1

#### Work

1. Move Drizzle table declarations from `src/db/schema.ts` into domain files under
   `src/db/schema/`.
2. Re-export the complete schema from `src/db/schema/index.ts`.
3. Preserve all table names, schemas, columns, defaults, indexes, constraints, and
   inferred TypeScript types.
4. Update imports mechanically.
5. Do not generate a database migration for a TypeScript-only reorganization.
6. Add an assertion that the exported table set before and after the split is
   identical.
7. Document ownership for tables that currently bridge domains, especially:
   - `funding_sources`;
   - `grant_application_funding_needs`;
   - `funding_need_budget_lines`;
   - `documents` and media tables;
   - `airtable_record_mappings`.

#### Acceptance criteria

- `src/db/schema.ts` is removed or becomes a compatibility re-export no longer than
  20 lines.
- `drizzle-kit check` passes.
- No migration is produced solely because files moved.
- Existing migration-order and schema-contract tests pass.
- A clean database can apply all committed migrations in order.

### Phase 3 — Decompose oversized application modules

**Priority:** P1  
**Estimated effort:** 5–8 days  
**Dependencies:** Phase 2

#### 3A. Grants workspace

Split `src/server/grants-workspace.ts` into:

- workspace queries and payload assembly;
- application queries;
- application mutations;
- requirements and evidence;
- deadlines/calendar;
- project funding profiles;
- shared Zod schemas and types.

Keep funding calculations in existing pure core modules rather than duplicating
them in payload assembly.

#### 3B. Settings

Split `SettingsShell.tsx` into workspace settings, members, invitations, ISRC, and
storage/integration panels. Each panel owns its request state and tests.

#### 3C. Contacts

Split `ContactsBook.tsx` into list/search, contact detail, contact editor,
organization links, and enrichment suggestions.

#### Module constraints

- Prefer files below 500 lines.
- A file above 700 lines requires a short justification in its module README or
  top-level comment.
- React components must not contain reusable financial, authorization, or workflow
  rules.
- Database mutations must remain server-side.
- Pure workflow calculations require direct unit tests.

#### Acceptance criteria

- The three named oversized modules are decomposed without behavior changes.
- Existing component and server tests remain green.
- New boundaries have focused tests.
- There is no circular import between domain modules.
- Page payload shapes and API response shapes remain backward-compatible unless a
  separately approved issue specifies a change.

#### Completion evidence

- `grants-workspace.ts` is a compatibility re-export over core, query, and
  mutation modules; its public imports remain unchanged.
- Settings are separated into workspace, member, operations, shared control, and
  shared type modules. `SettingsShell.tsx` retains the existing public exports.
- Contacts are separated into the directory shell, detail views, enrichment
  actions, shared controls, and shared types. `ContactsBook` remains the public
  component entry point.
- Every resulting implementation file is below the 700-line hard limit.
- `src/module-boundaries.test.ts` enforces the size limit and prevents child
  modules from importing their compatibility entry point.
- `npm run ci` passes, including 583 tests, schema checks, Astro checks, and the
  production build.

### Phase 4 — Introduce durable background jobs

**Priority:** P1  
**Estimated effort:** 5–8 days  
**Dependencies:** Phases 1–3

#### Initial job types

- readiness validation sweep;
- Sisense import/sync;
- royalty import processing;
- R2 image optimization/backfill;
- retryable email or provider synchronization.

#### Data model

Extend the existing `job_runs` model or add a compatible job table supporting:

- stable job ID and job type;
- organization scope;
- JSON payload and schema version;
- `queued`, `running`, `succeeded`, `failed`, and `cancelled` states;
- attempt count and maximum attempts;
- `available_at`, `started_at`, `heartbeat_at`, and `finished_at`;
- lease owner and lease expiration;
- deduplication/idempotency key;
- structured result and sanitized error metadata.

#### Worker behavior

- Claim work atomically using PostgreSQL locking.
- Recover expired leases.
- Retry with bounded exponential backoff.
- Make handlers idempotent.
- Emit a `job_runs`/audit record for every attempt.
- Support graceful shutdown.
- Expose health and queue-depth information without exposing payload secrets.

Redis is explicitly out of scope for the first implementation. Reconsider it only
after measured PostgreSQL contention or multi-replica coordination requires it.

#### Acceptance criteria

- Killing a worker during a job does not permanently lose the job.
- Two workers cannot successfully claim the same attempt.
- Replaying a completed idempotency key does not duplicate domain effects.
- Failed jobs retain sanitized diagnostic context and can be retried.
- At least the validation sweep runs through the worker in staging/production.
- Existing direct scripts remain available as controlled recovery tools.

#### Implementation status

The repository implementation is complete:

- migration `0050_durable_background_jobs` adds queue state, leases, bounded
  attempts, idempotency keys, sanitized errors, and per-attempt records;
- workers claim with `FOR UPDATE SKIP LOCKED`, heartbeat their lease, recover
  expired work, retry with bounded exponential backoff, and shut down on process
  signals;
- API, post-write, and scheduled validation sweeps enqueue durable jobs;
- Settings exposes workspace-scoped queue health and sanitized recent failures;
- the direct sweep script remains available for controlled recovery;
- `docs/runbooks/background-jobs.md` defines worker, scheduler, inspection, and
  recovery operations.

Phase 4 remains `in_progress` until deployment applies migration `0050`, starts
at least one `npm run jobs:work` process, schedules `npm run jobs:schedule`, and
verifies a validation sweep end to end in staging or production.

### Phase 5 — Operational readiness and observability

**Priority:** P2  
**Estimated effort:** 3–5 days  
**Dependencies:** Phase 4

#### Work

1. Define structured application log fields:
   - timestamp;
   - severity;
   - request ID or job ID;
   - route or job type;
   - organization ID where safe;
   - duration;
   - outcome;
   - sanitized error class.
2. Add database/query timing around the grants workspace, budget dashboard,
   catalog, Today view, and royalties dashboard.
3. Establish initial performance budgets:
   - normal API read p95 below 500 ms;
   - mutation p95 below 750 ms excluding external providers;
   - primary SSR workspace render below 1,000 ms server time;
   - background jobs emit progress or heartbeat at least once per minute.
4. Add a deployment checklist covering:
   - backup/restore confidence;
   - migration ordering;
   - health checks;
   - rollback;
   - worker compatibility;
   - secret rotation.
5. Test a migration and application rollback in a production-like environment.

#### Acceptance criteria

- Slow routes can be identified by route, organization, and request ID.
- Job failures can be traced from queue record to sanitized logs.
- A documented rollback exercise has been completed.
- Deployment does not report success before both web and worker health checks pass.

#### Implementation status

Repository instrumentation and runbooks are implemented. Request, high-value
query, and job logs use structured correlation fields; route budgets identify
slow work; worker heartbeats make combined health observable; and deployment,
backup, rotation, and rollback steps are documented.

Phase 5 remains `in_progress` until the production-like restore/migration,
worker, application rollback, and recovery exercise in
`docs/runbooks/deployment-and-rollback.md` is completed with evidence on issue
#46.

## 6. Future integration gate

Discogs, Revolut, and other new production integrations may begin after Phases 0–3
when all of the following are true:

- one package manager is enforced;
- unexpected API errors are masked and logged;
- every integration mutation has a named capability;
- database schema ownership is documented;
- the affected domain has no unresolved module over 700 lines;
- the integration has an explicit canonical-data and conflict-resolution policy;
- secrets, retries, idempotency, rate limits, and audit requirements are specified.

Any integration performing scheduled or retryable work must also wait for Phase 4.

## 7. Explicit non-goals

This plan does not authorize:

- replacing Astro or React;
- extracting microservices;
- replacing PostgreSQL or Drizzle;
- adding Redis without measurements;
- rewriting all REST endpoints as GraphQL;
- redesigning product interfaces;
- changing financial semantics already defined in the grants/funding specification;
- implementing proposed Discogs, Revolut, or Cloudflare SaaS products;
- changing production data without a separate migration issue and rollback plan.

## 8. Verification protocol

Every phase must finish with:

```sh
npm test
npm run db:check
npm run check
npm run build
```

If Phase 0 selects pnpm, update these commands and the `ci` script together.

For database-affecting phases, also verify:

1. migrations apply to an empty database;
2. migrations apply to a production-like snapshot;
3. tenant isolation tests pass;
4. migration rollback or forward-fix procedure is documented;
5. Airtable parity checks remain stable where imported records are affected.

## 9. Definition of complete

The consolidation initiative is complete when:

- Phases 0–5 meet their acceptance criteria;
- all phase issues contain verification evidence;
- CI is green on the final commit;
- production deploy and rollback procedures have been exercised;
- no critical domain file exceeds 700 lines without a recorded justification;
- all active specifications have lifecycle status;
- scheduled operational work uses the durable worker or is explicitly documented as
  a temporary recovery-only script;
- the architecture documentation matches the deployed system.

## 10. Recommended issue order

| Order | Issue | Priority | Dependency |
|---:|---|---|---|
| 1 | Choose package manager and enforce reproducible installs | P0 | — |
| 2 | Add specification lifecycle statuses | P0 | — |
| 3 | Mask unexpected API errors and add request IDs | P0 | 1 |
| 4 | Inventory mutation authorization and migrate to capabilities | P0 | 3 |
| 5 | Split Drizzle schema by domain | P1 | 4 |
| 6 | Decompose grants workspace server module | P1 | 5 |
| 7 | Decompose settings and contacts React modules | P1 | 5 |
| 8 | Implement PostgreSQL-backed durable worker | P1 | 6, 7 |
| 9 | Move validation sweep to durable worker | P1 | 8 |
| 10 | Add structured timing, job observability, and rollback exercise | P2 | 9 |
