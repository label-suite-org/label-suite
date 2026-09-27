# ADR 0006: Artist relationship and contact-link source-of-record policy

**Status:** Accepted

**Date:** Monday, July 27, 2026

**Tracking:** GitHub issue #50

## Context

Issue #50 clarified that artist authority and contact affiliation must be managed in
Label Suite and that the historical confusion around “roster vs collaborator” and
contact ownership needed a concrete source-of-truth policy.

Observed current state (Issue #50 evidence):

- `origin/main` has already merged issue #60 and supports `artists.relationship`
  with allowed values `roster`/`collaborator` plus optional `artists.contact_id`.
- We do **not** track multiple concurrent relationship versions or effective-date
  history in `artists.relationship`; this is a single-current-value field with no
  history table.
- Airtable migration base is configured as `Label Suite v3`
  (`appoKM3ylTDhR60LY`).

## Decision

We define a single, explicit source-of-truth policy for Issue #50 domain:

1. **Roster authority comes from `artists` rows in Label Suite.**

   `artists.relationship` is the canonical current relationship for an identity in
   the product.

2. **Allowed values are exactly `roster` and `collaborator` (or null).**

   The constraint is enforced by schema check
   (`artists_relationship_check` in `drizzle/0055_artist_relationships.sql` and
   `src/db/schema/catalog.ts`).

3. **`collaborator` is also an artist profile**, and differs from `roster` only
   by semantics and placement in filtering/search surfaces.

4. **`artists.contact_id` is the canonical relationship link from artist identity to operational contact identity.**

   Contacts can still hold arbitrary roles/types, but this field is what determines
   the identity-link for roster/collaborator behavior in product surfaces.

5. **PRO/IPI authority boundaries:**

   For artist identity records, `artists.pro` and `artists.ipi` are the authoritative
   rights fields in Label Suite. Contact-side and Airtable-side `PRO` / `IPI` values are
   treated as migration/reference data until a human owner reconciles differences.

6. **Contacts may represent three states:**
   - linked to an Artist (`artists.contact_id` points to that Contact)
   - not linked to any Artist
   - linked to no recognized in-scope identity (e.g., manager, label, org contact)

   Only the first state implies a production artist/collaborator identity.

7. **No automatic classification.**

   Reconciliation between Airtable and production must be surfaced as unresolved
   review items unless a deterministic mapping and explicit edit action determines
   the result.

## API / UI / schema behavior

Current behavior at this boundary is as follows:

- `src/server/artists.ts` accepts and validates relationship values only as
  `roster`/`collaborator` (or null), and current product behavior already allows
  direct Label Suite UI/API edits to both `relationship` and `contact_id`.
- `src/db/schema/catalog.ts` stores a single relationship string on `artists`.
  No automatic reclassification is enabled or approved in this ADR.
- `contact_organizations`, `roles`, and task/release workflows continue using
  `contacts` and artist-level roles independently from `artists.relationship`.
- `artists` has a single active relationship value per row (no effective-dated
  history table or multiple concurrent relationship states).

## Cutover and migration authority

- During migration, the authoritative current product state already lives in
  Label Suite:

  - `artists.relationship` is the active roster/collaborator classification.
  - `artists.contact_id` is the active artist-to-contact identity link.
  - `artists.pro` and `artists.ipi` are the active artist-rights identifiers.

- During that same migration window, Airtable `Artists` rows and related contact
  metadata are comparison input only. They are used to reconcile unresolved
  identities and historical import gaps, not to override current Label Suite
  state automatically.

- After cutover, the same Label Suite artist fields remain the sole operational
  source for active writes and operator decisions. Airtable becomes historical
  migration/reference evidence only.

- The parity script is read-only and only for unresolved-item evidence.
- This ADR does **not** authorize automatic reclassification or backfill.
  The user-approved workflow is direct human-editing in Label Suite with review of
  unresolved items.
- Production history for existing identities is preserved. This ADR does not
  authorize mass updates or destructive migration without review.

## Validation and parity plan

- Run `npm run issue50:parity` to produce a reproducible unresolved-review artifact.
  Optionally use `--output <path>` to override the destination.
- Keep unresolved items visible in backlog/review; resolve only via explicit owner
  actions in the UI or planned migration scripts.

## Rollback boundary

- If parity review discovers severe inconsistency, pause new direct writes to
  `artists.relationship` and `artists.contact_id` until manual owner review confirms a safe
  correction path.
- No data is deleted by this ADR. The boundary is operational,
  not destructive.

## Approval provenance

- Decision approved for Issue #50 via user direction in the current workflow:
  roster originates from Artists, collaborator is artist-by-semantics, and
  Contact-to-artist linkage is maintained directly in Label Suite.
