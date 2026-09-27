> Retained technical/historical reference. Current public candidate and production
> boundaries are defined in `PUBLIC_SOURCE.md`; this document does not authorize deployment.

# Native iOS Mobile Operational Parity

**Status:** Product specification under Forgejo review

**Parent:** [Forgejo issue #319](https://git.truenature.online/malthe/label-suite_neon_r2/issues/319)

**Baseline:** Forgejo `origin/main` at `cdc7291` (2026-08-17)

**Existing first slice:** [Forgejo issue #244](https://git.truenature.online/malthe/label-suite_neon_r2/issues/244)

## Product decision

Label Suite's native iPhone app will provide **Mobile Operational Parity**: every
recurring label workflow has a native path, while rare administration,
integration credentials, destructive bulk operations, complex imports, and
reconciliation may remain web-only only through an explicit product-owner-approved
Mobile Web Exception.

This is neither a read-only companion nor literal screen parity. The native app
uses the same canonical records and server authority as the web product, but
recomposes desktop density into task-oriented iPhone workflows.

The program serves authenticated Operators and Read-only Members. Artist,
partner, fan, and public portals are separate products.

## Product brief

| Field | Decision |
| --- | --- |
| User | A Workspace Member who understands their label context and needs to inspect or act away from a desktop. |
| Job | Find any important record, understand its current state and relationships, and complete the next authorized recurring action safely. |
| Current failure | Library Artists, Releases, and Campaigns show real data but do not navigate; Today frequently leaves the native app; campaign approval is the only deep native workflow. |
| Desired outcome | Today, Releases, Library, and Search form one coherent native product with canonical record routes and safe actions. |
| Success | Operators complete representative recurring work with real True Nature data on a physical iPhone; Read-only Members see the same permitted context without mutation authority. |
| Consequence | A successful write changes the same canonical record visible on web. A failed, stale, offline, or unauthorized write changes nothing. |
| Non-goals | Autonomous mutation, offline writes, outreach delivery, payment execution, literal desktop parity, or unapproved mobile omissions. |

## Non-negotiable boundaries

- The production client remains native SwiftUI with iOS 18 as its minimum
  supported system. Dedicated iPad composition remains deferred.
- Forgejo `origin/main` remains the sole code source of truth.
- The server resolves identity, Workspace, role, capability, tenant scope,
  validation, revision, and audit behavior.
- The client never treats a Workspace identifier or hidden control as authority.
- Canonical writes are explicit, online-only, revision-aware, and audited.
- Stale writes never overwrite, auto-merge, or silently discard canonical data.
- Failed validation and recoverable errors preserve entered values
  (`rule/preserve-user-input`).
- Protected Mobile Snapshots are read-only, bounded, visibly stale, isolated by
  user and Workspace, and erased on logout, session removal, or lost access.
- Campaign AI and enrichment remain cited proposal-only.
- The app does not send outreach, record delivery, or execute payments.
- No new production dependency is introduced without owner approval.
- A domain summary never becomes a second source of truth for its child records.
- Native API contracts remain versioned and client-neutral; they expose bounded
  domain projections instead of serialized web screens.
- Native Record Routes, Search, session/Workspace isolation, protected
  snapshots, transport, and revision-aware mutation coordination remain shared
  deep seams. Domain behavior stays inside the domain that owns it.

## Product-design decision traceability

| Decision | Governing rule or recorded coverage gap |
| --- | --- |
| Stable native roots and canonical record navigation | `rule/navigation-vs-action`, `rule/preserve-mental-model` |
| One task-oriented hierarchy rather than desktop panels | `rule/one-primary-action`, `rule/structure-before-containers`, `rule/smallest-intervention` |
| Pushed routes, bounded sheets, and no stacked overlays | `rule/inline-before-modal`, `rule/no-nested-modals` |
| Explicit mutation with legible object, scope, and consequence | `rule/name-object-scope-consequence`, `rule/destructive-proportional`, `rule/preserve-user-input` |
| Complete loading, stale, partial, permission, failure, and recovery behavior | `rule/cover-reachable-states`, `rule/empty-state-action`, `rule/error-states-recovery`, `rule/loading-stable-labels` |
| Task-complete accessibility | `rule/accessible-name-required`, `rule/keyboard-complete-flow`, `rule/no-custom-focus-bypass` |
| Every omitted native workflow requires explicit owner approval | **Coverage gap (proposed) `rule/explicit-parity-exception`:** every implemented workflow has a native path or a documented, approved exception with reason, risk, handoff, and reconsideration trigger. Category: Hierarchy and structure. |
| The server, not the client, remains mutation authority | **Coverage gap (proposed) `rule/server-authority-remains-canonical`:** interface affordances and client-supplied scope never substitute for server authorization and canonical validation. Category: Action naming and consequence. |
| Offline snapshots never become an implicit write queue | **Coverage gap (proposed) `rule/no-hidden-offline-mutation`:** visibly cached reading is distinct from canonical writes, and no write is implied or queued without an explicit approved offline contract. Category: State coverage. |
| Review does not silently broaden into send, publish, or payment authority | **Coverage gap (proposed) `rule/consequential-authority-is-explicit`:** exposing preparation or review cannot imply authority for a separate external consequence. Category: Action naming and consequence. |

## Native information architecture

The four native roots compose the canonical workspaces documented in the
[Label Suite Product Map](./label-suite-product-map.md); they do not supersede
domain ownership. Dashboard attention enters through Today while its remaining
authorized summaries stay reachable through Library and canonical record
routes. Artists, Campaigns, and Analytics retain their canonical workspace
meaning under Library. Native Search is the iPhone access path to Command-K's
real-record index.

### Today

Today is the signed-in member's attention surface. It orders assigned or
authorized review work by urgency and due state. Safe Task operations may happen
inline. Consequential work opens a dedicated review route with complete context.
Today uses Native Record Routes wherever coverage exists.

### Releases

Releases are the deepest operational spine. The root is a cover-led pipeline
showing Artist, date, phase, readiness, and blockers. Release detail leads with
identity and next action, then provides routes to metadata, timeline, Tracks,
Works and clearance, DSP pitches, Campaigns, Analytics, Royalties, Budget,
Assets, Documents, Tasks, and Activity.

Each child is a canonical record or bounded projection on a dedicated route.
Release detail must not become one unbounded scrolling desktop page.

### Library

Library is the complete canonical object index:

- Artists, Releases, Campaigns;
- Tracks, Works, and Catalog;
- Tasks, Contacts, Events, and Projects;
- Assets and Documents;
- Analytics, Royalties, Grants, and Budgets;
- authorized Settings and integration health.

Every row opens a native route or a labeled Mobile Web Exception. There are no
unexplained dead ends.

Each Library section has search and filters appropriate to its canonical record
type above a scannable list. The active scope and filter count remain visible,
and filtered-to-zero offers a clear reset without being confused with a
never-had-any empty state.

### Search

Search is a full-screen, Workspace-scoped index of canonical records. It shows
recent records and groups results by record type. Search navigates; it does not
mutate. Creation remains a separate visible action. Returning from a result
preserves the originating query and position.

## Shared interaction contract

### Navigation and hierarchy

- Stable root destinations are Today, Releases, Library, and Search.
- Navigation uses links and Native Record Routes; mutation uses explicit actions
  (`rule/navigation-vs-action`).
- Navigation preserves filters, scroll position, record identity, and predictable
  back behavior (`rule/preserve-mental-model`).
- Each surface has one unmistakable primary job and action
  (`rule/one-primary-action`).
- Hierarchy, typography, spacing, and alignment group information before cards or
  decorative containers (`rule/structure-before-containers`).
- Pushed routes own large or shareable tasks. Sheets own bounded focused tasks.
  Secondary context is inline when possible (`rule/inline-before-modal`).
- Sheets never stack (`rule/no-nested-modals`).
- Existing native patterns and better defaults precede new controls or settings
  (`rule/smallest-intervention`).

### Actions and consequences

Before a consequential action, the interface communicates the canonical object,
scope, affected Workspace or records, reversibility, and external consequence
(`rule/name-object-scope-consequence`).

Routine safe changes receive lightweight explicit confirmation through their
result. Irreversible or externally visible actions receive proportionate review
friction (`rule/destructive-proportional`). Primary and destructive controls name
the operation and object; they never use bare Confirm, OK, Yes, or Submit.

Canonical form state may survive local navigation, but it is not canonical until
an authenticated online save succeeds. Optimistic presentation is allowed only
when a complete failure and rollback state exists; consequential actions wait for
canonical confirmation.

### Reachable states

Each surface specifies only the states it can reach, including:

- initial and per-action loading;
- never-had-any and filtered-to-zero empty states;
- sparse and populated results;
- partial, stale, invalid, unreviewed, and provider-unavailable evidence;
- inline validation;
- recoverable load and save failures;
- permission-denied and capability-restricted behavior;
- disabled actions with an adjacent reason;
- stale revision and reload/retry;
- offline Protected Mobile Snapshot and online recovery;
- consequential review, pending, success, and failure;
- long names, long text, large values, Dynamic Type, narrow width, and
  localization pressure.

This is the implementation contract for `rule/cover-reachable-states`.
Empty states offer a truthful first action (`rule/empty-state-action`), errors
offer recovery (`rule/error-states-recovery`), and action labels remain stable
while busy (`rule/loading-stable-labels`).

### Accessibility

Accessibility is successful task completion, not label coverage alone:

- every control and chart value has an accessible name and meaning
  (`rule/accessible-name-required`);
- Dynamic Type reflows without hiding actions;
- VoiceOver announces record type, state, freshness, consequence, and recovery;
- status and priority never rely on color alone;
- forms remain usable with the software keyboard and hardware keyboard;
- focus moves into focused surfaces and returns to its trigger;
- primary tasks remain completable at narrow iPhone widths.

## Domain coverage

### Artists

Artist roster rows use imagery, identity, readiness, and current operational
context. Artist detail provides identity and relationships first, followed by
Releases, Campaigns, Works and rights, Analytics, team/Contacts, Assets,
Documents, Tasks, and Activity. Authorized recurring identity and relationship
edits use focused forms. Missing images or links remain truthful missing states.

### Releases, Tracks, Works, and Catalog

Release detail owns the operating context but not the child records. Operators
can create and edit ordinary Release metadata, resolve readiness through the
record causing the blocker, move efficiently between consecutive Tracks, and
manage Work roles, scopes, ownership, and evidence with explicit validation.

Track, Work, Release, and Catalog identity remain distinct. Catalog entries link
to Releases and never replace them. Provider-backed audio, DSP, and delivery
context names freshness and unavailable or manual states honestly.

### Campaigns

Campaign browse groups and filters Campaigns by status, Artist, and Release.
Current Campaigns remain the default and archived Campaigns remain reachable
through an explicit filter. Campaign detail is organized around next work,
content, audiences, channels, lead queues, discovery, radio, public-page review,
and Campaign Activity. The existing lead preparation, Plain Draft, approval,
revision, offline, capability, and audit behavior remains authoritative.

Discovery and enrichment suggestions remain cited proposals. Mobile may review
and explicitly accept or reject where existing authority permits. Existing rich
drafts remain readable without destructive flattening until a lossless supported
editor exists. Operators can write and approve supported drafts now, including
Plain Drafts, with the loaded revision. Completing Campaign parity requires
lossless authoring for every implemented rich-content operation unless the
product owner later approves a bounded Mobile Web Exception.

Public-page review and publication are an explicit program slice. The review
shows the exact revision and external consequence, and publication uses existing
server capability, revision, and audit authority. Outreach delivery remains
unavailable.

Campaign Activity loads incrementally through a stable cursor and preserves the
actor, action, time, evidence/provenance, and affected canonical record for each
entry. Every successful Campaign mutation refreshes the affected projection and
Activity without replacing already loaded history with an unexplained count.

### Tasks, Contacts, Events, and Projects

Tasks support authorized creation, completion, deferral, rescheduling,
assignment, and canonical relationships. Today may expose safe Task operations.

Contacts preserve Person and Organization identity and make affiliations and
reviewable enrichment evidence visible. Authorized Operators can create Contacts,
edit supported identity and affiliation fields, and explicitly accept or ignore
cited enrichment proposals.

Events remain happenings; Projects remain goal-oriented workstreams. Authorized
Operators can create each record type and edit its supported recurring identity,
schedule, status, people, and relationship fields. Their shared relationships do
not collapse their record boundaries.

### Assets and Documents

The iPhone may use Files, camera, and document scanning to create uploads with
visible progress, interruption recovery, provenance, ownership, and contextual
linking. Preview uses private signed access and never implies public access.
Unlinking evidence remains distinct from deleting its reusable canonical record.

### Analytics and Forecast

Analytics leads with the decision: KPIs, change, freshness, quality, and
Artist/Release scope. Charts provide accessible data views. Forecast separates
assumptions, range, and results so it does not imply false precision.

Large imports, source reconciliation, and administrative wide-table work begin
as labeled Mobile Web Exceptions.

### Rights, Royalties, Grants, and Budget

Rights views keep Work, Track, roles, contacts/organizations, scopes, ownership,
evidence, and blockers legible together. Truncated legal meaning is unacceptable.

Royalties expose balances, statements, periods, currencies, source evidence,
unmatched identity state, and payout previews. Budget exposes totals, funding,
cashflow, lines, evidence, and variances. Grants expose opportunities,
applications, requirements, evidence, deadlines, decisions, and reports.

Existing capability-checked proposals and approvals may become native only when
their complete evidence and consequence fit one review flow. Payment execution
does not become native authority.

The guarded Budget variance flow shows the exact Budget Line, current and
proposed amount, currency, reason, linked evidence, affected totals, decision
authority, and loaded revision together. Authorized Operators can explicitly
request, approve, or reject only the variance actions already supported by
canonical server behavior. Conflict, permission, validation, and failure change
no financial state, and no variance decision executes payment.

Authorized Operators can create and update supported Grant application fields,
requirements, deadlines, status, and reports, and attach existing or newly
captured evidence. Grant, Project, Event, Task, Asset, Document, and Budget
records remain distinct and canonically linked.

### Notifications and Settings

Notifications are a later opt-in slice for assignments, deadlines, requested
reviews, approval results, and relevant record changes. They are Workspace-aware,
privacy-conscious on the lock screen, and deep-link to exact native context.
Notification delivery never implies workflow completion.

Preferences are isolated by authenticated user and Workspace and control each
supported notification category independently. Changing the active Workspace
never displays, edits, or applies another Workspace's preferences.

Settings begins with account, Workspace, notification preferences, membership
visibility, and integration health. Credentials, token management, destructive
administration, and complex integration configuration remain candidate Mobile
Web Exceptions.

## Mobile Web Exception register

Every exception records its reason, risk, native handoff, and reconsideration
trigger. The initial approved candidates are:

| Operation | Reason | Native handoff | Reconsider when |
| --- | --- | --- | --- |
| Complex Analytics and royalty source imports | Dense source inspection and reconciliation are not yet safe on a narrow surface. | Open the exact authenticated web import workspace with explanatory copy. | A native prototype proves source, validation, reconciliation, and failure evidence together. |
| Integration credentials and local-tool tokens | High-sensitivity administration is rare and screenshot-prone. | Open the exact Settings web route. | A dedicated secure native credential flow is independently specified and reviewed. |
| Destructive bulk operations | Blast radius and selection density exceed the initial native review contract. | Open the scoped web workspace without preselecting an unsafe action. | Native selection, consequence review, recovery, and audit behavior are proven. |
| Payment execution | No approved native payment authority exists. | Show evidence and payout preview only. | A separate financial authority and provider decision explicitly approves execution. |

Technical difficulty, missing endpoints, or schedule pressure do not create new
exceptions.

Every approved fallback uses a visible **Open in Label Suite Web** action and
explains why the operation remains web-only before navigation. It opens the exact
authenticated Workspace and record context where safely supported and preserves
a predictable return path. An embedded web page is never presented as native
completion, and a handoff never claims that the web operation succeeded.

## Protected data and offline behavior

- Cache only bounded recently viewed projections and essential navigation
  summaries, never a full Workspace replica.
- Isolate every snapshot by authenticated user and Workspace.
- Mark age and freshness on every cached surface.
- Disable mutation while offline and explain how to retry.
- Do not create a mutation queue, background sync, or local conflict merge.
- Preserve the current visible route during refresh failure.
- Erase snapshots on logout, session removal, protected cleanup, or lost
  Workspace access.
- Keep credentials, private draft bodies, sensitive routes, and financial detail
  out of logs, test artifacts, and diagnostics.

## Delivery program

1. **Shared shell, Search, and Native Record Routes**

   Prove the four roots, native canonical navigation, deep links, preserved return
   context, and the shared state/design language.
2. **Artists and Release operations spine**

   Deliver Artist roster/detail and Release pipeline/detail through Tracks,
   Works, Catalog, readiness, and cross-links.
3. **Campaign operations and approvals**

   Extend the existing first slice through Campaign detail, discovery, proposal
   review, content, audiences, channels, radio, public-page review, and Activity
   while preserving no-send.
4. **Cross-object operations**

   Deliver Tasks, Contacts, Events, and Projects with canonical links and safe
   recurring mutations.
5. **Assets, Documents, and capture**

   Add viewing, signed access, camera/files/scanning upload, provenance, and
   contextual linking.
6. **Dense evidence and finance**

   Deliver Analytics, Forecast, rights evidence, Royalties, Grants, and Budget
   review with accessible data and bounded approvals.
7. **Notifications, Settings, and parity audit**

   Add opt-in attention delivery, approved Settings surfaces, explicit exception
   handling, and domain-by-domain physical-device acceptance.

Every implementation ticket is a thin, demoable tracer bullet crossing server
projection or mutation, SwiftUI, and focused tests only where the acceptance
behavior requires them. Shared seams deepen only after at least one real slice
needs them.

## Implementation issue graph

The approved tracer bullets are tracked under parent #319. `HITL` marks a
required human acceptance boundary; every other ticket is agent-implementable
after its declared blockers merge into freshly fetched `origin/main`.

| Issue | Type | Tracer bullet | Blocked by |
| --- | --- | --- | --- |
| [#320](https://git.truenature.online/malthe/label-suite_neon_r2/issues/320) | AFK | Open an Artist from Library and return safely | None |
| [#321](https://git.truenature.online/malthe/label-suite_neon_r2/issues/321) | AFK | Browse the Release pipeline and open native Release detail | #320 |
| [#322](https://git.truenature.online/malthe/label-suite_neon_r2/issues/322) | AFK | Search canonical records and preserve return context | #320, #321 |
| [#323](https://git.truenature.online/malthe/label-suite_neon_r2/issues/323) | AFK | Route Today work into native record context | #322 |
| [#324](https://git.truenature.online/malthe/label-suite_neon_r2/issues/324) | AFK | Create and edit Artist identity and relationships | #320 |
| [#325](https://git.truenature.online/malthe/label-suite_neon_r2/issues/325) | AFK | Edit Release metadata with readiness and revision protection | #321 |
| [#326](https://git.truenature.online/malthe/label-suite_neon_r2/issues/326) | AFK | Inspect and edit consecutive Tracks | #325 |
| [#327](https://git.truenature.online/malthe/label-suite_neon_r2/issues/327) | AFK | Inspect Works and edit clearance roles safely | #326 |
| [#328](https://git.truenature.online/malthe/label-suite_neon_r2/issues/328) | AFK | Navigate Catalog entries to canonical Releases | #321 |
| [#329](https://git.truenature.online/malthe/label-suite_neon_r2/issues/329) | AFK | Show truthful release audio and DSP provider context | #321 |
| [#330](https://git.truenature.online/malthe/label-suite_neon_r2/issues/330) | AFK | Open native Campaign detail with paginated Activity | #320, #321 |
| [#331](https://git.truenature.online/malthe/label-suite_neon_r2/issues/331) | AFK | Review Campaign discovery and cited proposals | #330 |
| [#332](https://git.truenature.online/malthe/label-suite_neon_r2/issues/332) | AFK | Review Campaign content, audiences, and channels | #330 |
| [#333](https://git.truenature.online/malthe/label-suite_neon_r2/issues/333) | AFK | Complete and reschedule Tasks from Today | #323 |
| [#334](https://git.truenature.online/malthe/label-suite_neon_r2/issues/334) | AFK | Browse and edit Contacts with enrichment review | #322 |
| [#335](https://git.truenature.online/malthe/label-suite_neon_r2/issues/335) | AFK | Create and navigate distinct Events and Projects | #333 |
| [#336](https://git.truenature.online/malthe/label-suite_neon_r2/issues/336) | AFK | Capture and link Assets and Documents | #322 |
| [#337](https://git.truenature.online/malthe/label-suite_neon_r2/issues/337) | AFK | Prepare radio work without send authority | #330, #334 |
| [#338](https://git.truenature.online/malthe/label-suite_neon_r2/issues/338) | HITL | Review and publish the current public-page revision | #332 |
| [#339](https://git.truenature.online/malthe/label-suite_neon_r2/issues/339) | AFK | Explore accessible Analytics and Forecast decisions | #321 |
| [#340](https://git.truenature.online/malthe/label-suite_neon_r2/issues/340) | AFK | Inspect Royalty evidence and payout previews | #326 |
| [#341](https://git.truenature.online/malthe/label-suite_neon_r2/issues/341) | AFK | Review Budget evidence and guarded variance decisions | #321, #336 |
| [#342](https://git.truenature.online/malthe/label-suite_neon_r2/issues/342) | AFK | Work Grant applications, deadlines, and evidence | #333, #335, #336 |
| [#343](https://git.truenature.online/malthe/label-suite_neon_r2/issues/343) | AFK | Deliver opt-in private notifications with native deep links | #322, #323, #333 |
| [#344](https://git.truenature.online/malthe/label-suite_neon_r2/issues/344) | AFK | Expose safe Settings and explicit web exceptions | #322 |
| [#345](https://git.truenature.online/malthe/label-suite_neon_r2/issues/345) | HITL | Run the physical-iPhone Mobile Operational Parity audit | #324–#344 |

## Verification contract

### Automated

- Native API tests cover request shape, response mapping, error translation,
  freshness, capability, and revision contracts.
- Database-backed server tests prove tenant context for each new projection or
  mutation.
- Session and snapshot tests cover user/Workspace isolation, access loss,
  logout, revocation, cleanup, and reauthentication.
- Mutation tests cover explicit success, validation, permission denial, offline
  blocking, stale conflict, input preservation, audit evidence, no-send, and
  no-payment behavior.
- Navigation tests cover root routes, deep links, canonical cross-links,
  preserved return context, Search, and labeled web fallback.
- Surface tests cover meaningful loading, empty, partial, stale, failure,
  permission, long-content, and accessibility states.
- Dense evidence tests cover accessible chart data, currency and source
  presentation, freshness, provenance, and full-context review.

Tests assert observable behavior rather than trivial styling or private
implementation detail.

### Delivery evidence

Repository guards, focused verification, Standards review, Spec review, Forgejo
CI, exact reviewed head, merged-main ancestry, deployed revision, signed-in
production behavior, and physical-device acceptance remain distinct gates.

### Physical iPhone

A domain is parity-ready only when representative True Nature records prove:

- complete native navigation and predictable return behavior;
- matching Operator and Read-only behavior;
- successful canonical writes visible on web;
- conflict, stale, offline, missing, partial, provider failure, and access loss;
- VoiceOver, Dynamic Type, Light/Dark Mode, keyboard, and one-handed use;
- absence of tenant leakage, silent writes, sends, payments, or hidden authority.

Free Personal Team builds are the continuous learning path. Private TestFlight
and public distribution remain separate later decisions. The human-led pilot in
#255 is not modified or closed by this specification.

## Definition of program completion

The program is complete when every recurring implemented web workflow has either:

1. a production-verified native path meeting the domain completion contract; or
2. a product-owner-approved Mobile Web Exception with a working explicit handoff.

Completion is not inferred from responsive web routes, endpoint existence, CI,
merge, deployment health, or simulator screenshots alone.

## Deferred platform work

- dedicated iPad composition;
- Danish translation beyond localization readiness;
- widgets, Live Activities, Siri, Shortcuts, Share extensions, and watchOS;
- public App Store distribution;
- product renaming;
- third-party diagnostics or analytics dependencies.

These do not block iPhone Mobile Operational Parity.
