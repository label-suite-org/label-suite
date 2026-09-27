# Label Suite Product Map

> Canonical product hierarchy for the current Label Suite. Historical specifications and handoffs remain useful reference material, but this map is the product-navigation and ownership contract.

## Intentional Backlog Order

The open GitHub backlog is deliberately sequenced below as of 2026-08-12. GitHub issue state and labels remain the live execution record; this section records product priority and dependency order rather than duplicating task status.

| Order | Product lane | Issues | Decision |
| --- | --- | --- | --- |
| 1 | Security and production integrity | [#177](https://github.com/label-suite-org/label-suite_neon_r2/issues/177), [#126](https://github.com/label-suite-org/label-suite_neon_r2/issues/126) | Restore narrowly scoped bootstrap paths first; retain or remove historical schema only after explicit data-owner approval. |
| 2 | Current product foundations | [#10](https://github.com/label-suite-org/label-suite_neon_r2/issues/10), [#21](https://github.com/label-suite-org/label-suite_neon_r2/issues/21) | Finish the provider/compliance boundary and the evidence-first royalty import foundation before expanding integrations or finance. |
| 3 | M0 release-operations sign-off | [#25](https://github.com/label-suite-org/label-suite_neon_r2/issues/25), [#84](https://github.com/label-suite-org/label-suite_neon_r2/issues/84), [#85](https://github.com/label-suite-org/label-suite_neon_r2/issues/85), [#86](https://github.com/label-suite-org/label-suite_neon_r2/issues/86) | Close source-backed relationship, rights, contact, and Airtable parity decisions without destructive source changes. |
| 4 | Integration V1 delivery | [#9](https://github.com/label-suite-org/label-suite_neon_r2/issues/9), [#15](https://github.com/label-suite-org/label-suite_neon_r2/issues/15), [#16](https://github.com/label-suite-org/label-suite_neon_r2/issues/16), [#17](https://github.com/label-suite-org/label-suite_neon_r2/issues/17), [#18](https://github.com/label-suite-org/label-suite_neon_r2/issues/18), [#19](https://github.com/label-suite-org/label-suite_neon_r2/issues/19) | Deliver conservative Spotify identity and WARM workflows after their shared integration/security dependencies are ready. |
| 5 | Product depth and V2 | [#22](https://github.com/label-suite-org/label-suite_neon_r2/issues/22), [#23](https://github.com/label-suite-org/label-suite_neon_r2/issues/23), [#24](https://github.com/label-suite-org/label-suite_neon_r2/issues/24), [#87](https://github.com/label-suite-org/label-suite_neon_r2/issues/87), [#88](https://github.com/label-suite-org/label-suite_neon_r2/issues/88), [#89](https://github.com/label-suite-org/label-suite_neon_r2/issues/89) | Continue delivery, reconciliation, portal, rich-text, ownership, and cross-object navigation only after the preceding foundations are verified. |

## Primary Workspaces

Dashboard, Today, Artists, Releases, Campaigns, Analytics

These workspaces are the operator's daily entry points. They summarize and act on canonical records; they do not become alternate stores for domain data.

### Native iOS composition

Native iOS presents the same canonical hierarchy through four stable navigation
roots: Today, Releases, Library, and Search. These roots are an iPhone
composition, not replacement domain ownership:

| Canonical workspace | Native iOS entry |
| --- | --- |
| Dashboard | Actionable modules enter through Today; remaining authorized summaries remain reachable through Library and their canonical records. |
| Today | Today |
| Artists | Library → Artists and Native Record Routes from related records |
| Releases | Releases |
| Campaigns | Library → Campaigns and Native Record Routes from Artists, Releases, Today, and Search |
| Analytics | Library → Analytics plus contextual Artist and Release Analytics routes |
| Command-K | Search |

Operational, directory, administration, and contextual domains remain owned by
the hierarchy below even when Library is their native index. The native shell
does not collapse or reclassify their canonical records.

## Operational Workspaces

Events, Tasks, Royalties, Grants & Funding

Operational records remain distinct: an Event is a happening, a Task is an actionable assignment, a Royalty is financial source/statement evidence, and a Grant is a funding opportunity/application workflow.

## Directory and Administration

Contacts, Settings, Command-K

Contacts preserve person and organization identity. Settings owns account and integration configuration. Command-K is a keyboard-first index into real records, not a second record store.

## Contextual Domains

Forecast, Works, Catalog, Radio, Assets, Documents, Budgets

These domains are reached from the object where work happens and remain deep-linkable for power users:

- Forecast is contextual to Analytics.
- Works, publishing/master rights, and tracks are contextual to a Release.
- Catalog entries and numbers belong to Release metadata, with a chronological index for lookup.
- Radio plugging and delivery belong to Campaign channels; radio stations remain distinct directory records.
- Assets and Documents can be linked to Artists, Releases, Campaigns, Events/Projects, and Contacts.
- Budgets can be linked to Releases, Campaigns, Events/Projects, and Grants.

## Canonical Object Boundaries

| Record | Canonical meaning | Allowed relationships |
| --- | --- | --- |
| Artist | A creative act/profile managed by the label | Contact identity, Releases, Works, Campaigns |
| Release | A planned or delivered product/release identity | Artist, Tracks, Works, Catalog, Campaigns, Assets, Documents, Budgets |
| Catalog entry | A release identifier/number and its metadata | One Release; never a replacement for the Release record |
| Track | A recording on a Release | Release and one Work; readiness evidence |
| Work | Rights/clearance identity backing a Track | Tracks, Roles; publishing and master scopes remain explicit |
| Contact / Person | A human directory identity with person-specific contact and credit attributes | Artists, Roles, Tasks, Campaigns; may link to an Organization but is never an organization itself |
| Organization | A non-person legal, business, publisher, label, or radio-station identity | Contact affiliations and campaign targeting; never a person-only credit |
| Role | A person's or eligible organization's credit or rights line on a Work | Work and explicit Contact/Organization link; `Credit` lines do not count as clearance |
| Campaign | A coordinated outreach/promotion effort | Artists, Releases, Audiences, Templates, Channels, Radio, Assets, Documents |
| Event | A single or duration-based happening with an optional operational timeline | Optional Artist/Release links, Tasks, Assets, Documents, Budgets |
| Project | A goal-oriented workstream, such as a grant or funding effort, distinct from any event dates | Tasks, Events, Artists, Documents, Assets, Budgets, Grants |
| Task | An actionable operational assignment | Artist, Release, Campaign, Event, Project, Contact, Grant |
| Asset | A stored media/file identity and provenance record | Owning Artist/Release/Campaign/Event/Project/Contact/Grant context |
| Document | A reusable legal/operational document identity | Same contextual owners as Assets; links do not imply deletion |
| Budget | Planned/actual spend evidence | Release, Campaign, Event, Project, Grant |
| Royalty | Imported earnings, statement, balance, or payout evidence | Canonical Release/Track/Artist/Payee and source import run |
| Grant | Funding opportunity, application, evidence, and reporting workflow | Project, Event, Artist, Documents, Assets, Budgets |

## Systems of Record

Label Suite's tenant-scoped Postgres schema is authoritative for normalized operational records. External systems and Airtable are reference or migration evidence unless an approved ADR explicitly grants a different boundary. Every domain follows the same contract:

| Domain | Authority | Write boundary | Provenance | Review gate | Rollback boundary |
| --- | --- | --- | --- | --- | --- |
| Navigation/workspaces | Versioned application code on `origin/main` | Feature branch → reviewed PR → merge | Git commit and CI artifact | Product/UX review plus responsive release gate | Revert the merged revision; do not deploy worktrees |
| Artists/releases/tracks/works/catalog | Tenant-scoped Label Suite Postgres | Authenticated capability-checked mutation with `org_id` | Actor, timestamps, source/import mapping, linked records | Readiness and identity review where applicable | Transaction rollback and migration rollback; retain source rows |
| Rights/roles/readiness | Label Suite Postgres cached from role evidence | Capability-checked role mutation; recompute caches | Role source, scope, ownership type, status, actor | Publishing/master completeness and release-readiness review | Transactional mutation plus recompute; preserve role history |
| Contacts/organizations/radio | Label Suite directory tables | Person/organization eligibility and tenant checks | Source identity and enrichment provider/run | Directory review; unresolved/stale states remain visible | Correct or unlink records; never collapse distinct identities |
| Campaigns/audiences/templates/channels | Label Suite Postgres | Capability-checked draft/review mutation | Template revision, provider, audience preview, channel delivery evidence | Reviewed content and complete send preview | Draft/version rollback; no silent provider resend |
| Events/projects/tasks | Label Suite Postgres | Tenant-scoped capability-checked mutation | Actor, dates, links, status history | Operator review of actionable state | Transaction rollback; preserve linked reusable records |
| Assets/documents | Label Suite metadata plus configured object storage | Owner context and capability checks; no ambient public access | Object key, source, checksum/metadata, uploader | Review for ownership, rights, and missing/orphaned records | Unlink/version/restore; do not destructively delete shared evidence |
| Budgets/grants | Label Suite Postgres | Capability-checked proposal/approval mutation | Source opportunity, line-item actor, evidence links | Finance/operator review before consequential decisions | Transaction rollback and versioned proposal history |
| Analytics/forecast | Label Suite normalized imports and derived views | Import jobs and tenant-scoped operator corrections | Raw source, import run, freshness, identity match, normalization | Data-health review; stale/invalid/partial states visible | Retain raw imports; quarantine or supersede derived rows |
| Royalties/payments | Normalized Label Suite ledger fed by source statements | Import/reconciliation with explicit approval for payouts | Raw line, source period/currency, split snapshot, actor | Reconciliation and payout approval | Immutable source/ledger evidence; reverse with compensating entry |
| External integrations | Provider-owned external objects; Label Suite link state | Approved connector sync or explicit operator action | Provider, external ID, request/response, run, timestamp | Data-quality and provider-boundary review | Disable/retry/supersede link; never overwrite canonical identity silently |

## Product Invariants

- Tenant isolation: every read and write is scoped by `org_id`, and every mutation uses the existing capability checks.
- Truthful missing states: missing, stale, partial, invalid, and unreviewed data stay visibly distinct; code presence is not live proof.
- Explicit external-send approval: campaigns and other consequential sends require a complete preview and explicit authenticated operator confirmation.
- No domain-table collapse: releases, catalog entries, tracks, works, contacts, organizations, roles, assets, documents, campaigns, projects, events, budgets, grants, and royalties remain distinct records with explicit links.
- Recommendations are proposal-only; they never mutate operational or financial data automatically.
- Airtable is read-only reference/migration evidence where an approved ADR permits it; no destructive Airtable operation is part of the product contract.
- `origin/main` is the production code authority. A dirty checkout, worktree, or unmerged branch is never a deployment source.
