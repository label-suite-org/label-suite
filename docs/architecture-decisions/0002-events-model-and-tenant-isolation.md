# ADR 0002: Restore Event and Tour functionality as a unified Events model

**Status:** Accepted  
**Date:** Monday, July 27, 2026  
**Tracking:** GitHub issue #53

## Context

Earlier implementations for project/event/tour tracking were removed from the top-level
navigation and partially merged elsewhere. Key historical restoration points with file
provenance include:

- `61a414e` feat: add projects events and tour schema (`drizzle/0046_projects_events_master_tour.sql`)
  - Created `project_events`, `tour_details`, `tour_show_details`, `tour_travel_legs`, `tour_lodging`, and `tour_deal_terms`.
  - `project_events.project_id` is nullable and references `label_suite.budget_projects(id) on delete set null`.
  - `artist_id` and `release_id` were also optional, matching standalone event capability.
- `188f097` feat: add projects events workspace (`src/pages/projects/index.astro`)
  - Mounts `ProjectsEventsWorkspace` and loads `listProjects(orgId)` and `listProjectEvents(orgId, {})`.
- `6e1dfea` feat: add project and standalone event services (`src/server/projects.ts`)
  - Added API services under `src/pages/api/projects/[id].ts`, `src/pages/api/projects/index.ts`,
    `src/pages/api/events/[id].ts`, and `src/pages/api/events/index.ts`.
- `6c46a0e` feat: add project and event detail workspaces (`src/pages/events/[id].astro`)
  - Event detail consumed optional project, artist, release, and contact associations.
- `16f14aa` feat: add master tour workspace (`src/components/projects/master-tour/*`, `src/server/master-tour.ts`, `src/server/master-tour-core.ts`)
- `f743121` fix: reconcile tour import references and deal text (`drizzle/0048_projects_events_followup.sql`)
- `9762b35` fix: enforce projects event capabilities
- `6ec3735` fix: keep tour warning labels within layout

Current evidence shows shared domain models still reference `project_id` under
`finance`, `grants`, and `operations` schema paths (`src/db/schema/finance.ts`,
`src/db/schema/grants.ts`, `src/db/schema/operations.ts`), while dedicated top-level
projects/events routes and components are no longer present.

Current reporting and budget query surfaces still join through project IDs:
`src/server/budget-dashboard.ts`, `src/server/grants-workspace-query.ts`, and
`src/server/today.ts`.

## Decision

We will restore the previously built Events domain as an intentional **combined
Events workspace/menu model** (not a one-off project reconstruction), with a
single event-centric canonical model used across scheduling, budget, grants,
operations, and reporting surfaces.

- The implementation baseline is the historical Projects/Events/Master Tour work,
  merged into the new combined Events concept described above.
- **Project and Event relationship:**
  - Project remains the operational/funding container rooted in existing `budget_projects`
    and tenant-owned budget workflows.
  - Event is a dated, duration-based happening layer (concert, tour, release party, shoot,
    music video production, etc.).
  - Event may exist without a Project, Artist, or Release.
  - When present, Event→Project is optional via `project_events.project_id` and is non-destructive (`ON DELETE SET NULL`).
  - A Project does not require Events to exist and does not become a strict child of Event.
- **Product surface:** the top-level menu is unified `Events`; `projects` and
  `events` legacy routes/components are treated as internals supporting the unified model,
  not as independent long-lived product areas.
- No automatic derivation of Events from Budget Projects or Release Milestones is
  allowed unless an approved mapping is explicitly documented and executed.

## Approved relationships and ownership

- **Events ←→ Project/Budget**: Project remains `budget_projects` in finance.
  - Events are tenant-owned first-class entities and can hold a nullable `project_id` when attached.
  - Events can have budgeted spend surfaced through existing project budget joins.
  - Budget data remains authoritative for costs and planning within Event scope.
- **Internal Ownership and Assignment:** Internal ownership, assignees, and approvals for
  Events reuse the existing identity model in `src/db/auth-schema.ts` (`users`, `accounts`)
  and tenant membership model in `src/db/schema/foundation.ts` (`org_memberships`).
  External `contacts` remain for non-user stakeholders and legacy partner/venue records.
- **Events ←→ Grants**: Grants may fund one or more Events when the grant
  records support campaign/event-linked expenditures and approvals.
- **Events ←→ Tasks**: Tasks may be attached to Events for execution tracking and
  scheduling. Completion status remains on task records, with Events serving as the
  shared activity container.
- **Events ←→ Contacts**: Contacts are linked to Events where workflow requires
  external parties (venues, producers, suppliers, legal contacts, etc.).
- **Events ←→ Documents**: Documents can be attached at the Event level for legal,
  promotional, and operational needs.
- **Events ←→ Media Assets**: Media Assets can be attached at the Event level; the
  Events menu provides discovery and management of those assets within event context.
- **Events ←→ Campaigns**: Campaigns can be associated with Events for launch/marketing
  alignment, with explicit linking from campaign records.
- **Events ←→ Today**: “Today” views should surface upcoming and active Event tasks,
  dates, and readiness checks from the Event domain.
- **Events ←→ Artists**: Existing Artists are reused and can be associated as
  performers, participants, crew, or collaborators through approved relation types.
- **Events ←→ Releases**: Existing Releases can be associated without requiring a
  strict one-to-one constraint.

## Tenant isolation

- Every Event record is scoped by tenant via the existing multi-tenant boundaries.
- Any read/write against Event, Budget, Grants, Tasks, Contacts, Documents,
  Media Assets, Campaigns, Today, Artists, and Releases must continue to enforce
  tenant filtering through existing policy and query layers.
- Cross-tenant linking between these domains is prohibited in this ADR.
  Any future admin/support bypass would require a separate explicit, time-bounded,
  auditable design outside this ADR.

## Migration and rollback strategy

- New Events migration path:
  1. Re-introduce the unified Events model and routes using the historical files in
     this ADR as source-of-record evidence.
  2. Preserve all existing `project_id` joins while reusing existing tables:
     - `src/db/schema/finance.ts` (`budget_projects`),
     - `src/db/schema/grants.ts` (`project_id` links),
     - `src/db/schema/operations.ts` (`ops_tasks.project_id`),
     and current query layers (`src/server/budget-dashboard.ts`, `src/server/grants-workspace-query.ts`,
     `src/server/today.ts`).
  3. Only create or update Event→Project associations through explicit migration scripts plus
     an approved mapping artifact.
  4. Expose Events through the combined menu model only, with optional legacy routing
     aliases only when explicitly needed for internal migration continuity.
- Rollback path:
  1. Remove new navigation entry points to avoid user-facing exposure.
  2. Preserve data by keeping existing domain records and join tables intact.
  3. Keep all tenant isolation checks and domain constraints active so no data is
     deleted or repurposed.

## Reconciliation and integrity constraints

- Reconstructing Events from Budget Projects, Deal/Release Milestones, or other
  legacy domain artifacts is not allowed by default.
- Reconciliation requires an approved mapping artifact (e.g., ticketed migration checklist
  in Issue #53) before any Event backfill or normalization can create/overwrite Events.
- Migration/backfill may only set `project_events.project_id` when the source
  mapping confirms tenant-safe equivalence; otherwise, leave it null.
- Preserve all existing `project_id` joins in finance/grants/operations when no mapping
  exists, and never delete or repurpose historical `budget_projects` records.
- Reconciliation tasks must preserve Event identities and avoid creating duplicates
  for the same tenant activity unless explicitly permitted.

## Consequences

- A single Event model is now the canonical surface for all duration-based
  happening types.
- Implementation work for issue #53 must prioritize Events domain restoration and
  tenant-safe integration rather than a piecemeal project-only fallback.
- Future proposals that depend on a pure Projects-only or Projects-based reconstruction
  path are out of scope for this ADR.
