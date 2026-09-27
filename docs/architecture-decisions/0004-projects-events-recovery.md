# ADR 0004: Projects & Events recovery boundary

**Status:** Recovery candidate identified; implementation deferred pending a schema-port gate

**Date:** 2026-07-27

## Context

The UI inspection found that Projects/Events and the Master Tour surface are absent from the current `origin/main` tree. Repository history contains a reviewed implementation on `codex/projects-events-master-tour`, including project/event routes, tour-specific workspaces, source-preserving import tables, and a production release contract.

That branch predates the current schema split, account-recovery/passkey work, durable jobs, and current grants/analytics boundaries. Merging it wholesale would remove or regress current product surfaces. Rebuilding an Events model from budget projects or release milestones would be an unverified domain mapping.

## Decision

Treat the historical implementation as a recovery candidate, not as a drop-in merge. Keep Events out of primary navigation until the implementation is ported to the current architecture and its data dependencies are verified.

The next implementation gate is:

1. Port the project/event/tour tables into an additive domain schema module without changing existing release, catalog, work, contact, or budget identities.
2. Reconcile the historical server/API contracts with current tenant capabilities, request-security helpers, and split-schema imports.
3. Verify the historical Projects & Events and Master Tour tests against the current full CI surface.
4. Confirm whether the existing production data/import snapshot is still authoritative before any write or re-import.
5. Add the required-route release contract only after the ported route tree is present.

Until those gates pass, `/events` is intentionally not advertised as an available product route. This is a recovery decision, not permission to create a replacement model.

## Evidence

- Historical recovery source: `codex/projects-events-master-tour` at `31555ef`.
- Historical required-surface contract: `scripts/production-release-contract.ts` in that branch.
- Historical migrations: `0047_projects_events_master_tour.sql` and `0048_projects_events_followup.sql` in that branch.
- Current architecture boundary: `src/db/schema/` split by domain and current tenant/capability enforcement.

## Consequences

- The current UI work can proceed without hiding or inventing Events.
- Contextual navigation may add Events only after the port and route contract are verified.
- Any future recovery must preserve source provenance, tenant isolation, rollback evidence, and the explicit no-reimport rule.
