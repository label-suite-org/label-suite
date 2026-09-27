# ADR 0007: Share the Analytics Source Import lifecycle behind source-specific interfaces

**Status:** Accepted
**Date:** 2026-08-12

Spotify and Sisense retain source-specific interfaces while sharing one internal Analytics Source Import lifecycle for private archiving, tenant/source locking, duplicate-check timing, import-run and file evidence, completion, failed evidence, and latest-import lifecycle. The two existing source adapters make this seam real; each adapter still owns parsing, validation, preview and identity rules, duplicate identity, normalized-row persistence, evidence fields, final projection, and caller-visible error mapping. We reject both continued lifecycle duplication and a generic CSV/provider framework because the former disperses high-risk provenance invariants while the latter exposes source variation that callers do not need to learn.

The refactor is behavior- and schema-preserving. Sisense preview remains outside the shared interface, existing source exports and results stay compatible, archive/database reconciliation is a separate decision, and delivery proceeds through ordered characterization, Spotify migration, Sisense migration, and duplication-deletion slices.

The shared module exposes one lifecycle operation rather than phase-shaped persistence methods. PostgreSQL remains internal and is verified against a disposable database; R2 remains behind an internal injected adapter because it is truly external. Intermediate revisions may contain explicitly tracked duplication, but completion requires both source adapters to cross the seam and the obsolete lifecycle implementation and tests to be deleted rather than layered beneath new tests.
