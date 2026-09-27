# Database Schema Ownership

**Status:** `active`  
**Tracking:** GitHub issue #44

The `label_suite` PostgreSQL schema remains one relational model. The files
under `src/db/schema/` establish code ownership and navigation boundaries; they
do not create separate PostgreSQL schemas or services.

## Domain files

| File | Ownership |
|---|---|
| `foundation.ts` | Workspaces, memberships, invitations, personal dashboard preferences, contacts, external organizations, and Gmail enrichment records |
| `catalog.ts` | Artists, releases, chronological catalog, release reporting, works, tracks, credit roles, and side artists |
| `finance.ts` | Budget projects, lines, funding sources, variance requests, line-document links, and scheduled calls |
| `marketing.ts` | DSP pitches, validation bugs, ISRC sequences, campaigns, radio plugging, and email records |
| `assets.ts` | Media assets, copied asset files, and reusable documents |
| `grants.ts` | Grant catalog, applications, deadlines, requirements, evidence links, funding needs, and application events |
| `royalties.ts` | Revenue, imports, earnings, split snapshots, statements, payouts, and ledger entries |
| `operations.ts` | Operational tasks, job runs, and audit logs |
| `analytics.ts` | Analytics import runs/files, normalized metrics, and metric changes |
| `integrations.ts` | Samply projections/events and Airtable migration mappings |

`src/db/schema.ts` remains the public compatibility entrypoint. Application code
may continue importing tables from `src/db/schema`; new schema-domain code may
import directly from its owning file when that makes dependencies clearer.

## Bridge-table decisions

| Table | Owner | Boundary rule |
|---|---|---|
| `funding_sources` | Finance | Represents money available to a budget project. Grant application workflow stays in Grants. |
| `grant_application_funding_needs` | Grants | Represents how one application addresses project funding needs. |
| `funding_need_budget_lines` | Grants | Owned with funding-needs workflow even though it references Finance budget lines. |
| `budget_line_documents` | Finance | Represents evidence attached to a budget line; the reusable document record remains Assets-owned. |
| `grant_application_documents` | Grants | Represents application evidence; the reusable document record remains Assets-owned. |
| `documents` and `media_assets` | Assets | Store reusable asset metadata. Referencing domains own their link records and authorization. |
| `airtable_record_mappings` | Integrations | Records source-to-canonical migration identity and does not own the canonical record. |
| `samply_files` | Integrations | Stores remote projection/link state and does not own tracks, works, assets, or documents. |
| `calls` | Finance | Currently scheduled around budget projects and release work; Grants owns only `grant_application_calls`. |

## Change rules

- Moving a declaration between TypeScript files does not require a SQL migration.
- Changing a table, column, constraint, index, or default requires a committed
  Drizzle migration and migration contract coverage.
- Cross-domain foreign keys remain explicit imports; avoid duplicating IDs as
  unvalidated text solely to remove a module dependency.
- The schema export contract test must be updated intentionally whenever a table
  is added or removed.
