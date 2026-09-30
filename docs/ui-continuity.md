# UI continuity rollout

## Goal

Every signed-in route follows [DESIGN.md](../DESIGN.md), including its deeper tabs
and editing states. This is a workflow migration, not a replacement stylesheet.

## Why the current suite feels mixed

The global stylesheet forced every rounded component square, while Campaigns
had its own font and color theme. Several navigation/list controls also inherited
the filled, fixed-height action Button variant. Deeper pages combine large
summaries, metric cards and nested panels even when their landing page is calm.
Removing the style conflicts is the foundation; each workflow still needs a
layout pass and visual acceptance.

## Sequence and status

### 1. Shared foundation — implementation started

- [x] Consolidate Campaign styling into shared tokens; retain the shared Geist font.
- [x] Remove forced square overrides and use the existing component radius scale.
- [x] Use shared selection tokens in Catalog and line-tab controls.
- [x] Fix action-button styling used as Artist/Grants navigation and rights fix rows.
- [x] Remove the repeated visible Analytics workspace title.
- [ ] Make light the initial presentation while preserving explicit theme choice.
- [ ] Audit all remaining hardcoded palettes, radii and action variants.
- [ ] Visually accept the shared foundation across populated and empty workflows.

### 2. Catalog and recording workflow — implementation started

Routes: `/catalog`, `/releases`, `/releases/:id`, `/releases/:id/tracks`,
`/artists`, `/artists/:id`, `/works`, `/works/:id`.

- [x] Carry forward the simplified release overview and functional section navigation.
- [x] Replace overlapping track buttons with readable, selectable rows.
- [x] Keep immediate track readiness visible; move full checks into accordions.
- [x] Use one unboxed selected-track editor instead of competing dashboard panels.
- [ ] Apply the same rhythm to every release section: tracks/rights, timeline,
  campaigns, files, metadata and any section exposed by More.
- [x] Simplify artist identity and release rows; disclose biography and profile
  evidence and show distributor analytics only in the Analytics tab.
- [x] Separate work publishing, master, credits, recordings and activity with
  installed tabs; keep role drafts in parent state and preserve split tools.
- [x] Use installed dialogs for artist/work/release/track editing and confirmation,
  and DSP pitching; retain existing submission and authorization behavior.
- [x] Add a Catalog phone drawer with focus return and 300ms desktop collapse.
- [x] Disclose Samply setup and record authority evidence in release sections.
- [ ] Finish artist/release/work index layouts and the remaining nested forms.
- [ ] Finish collapse/restore and mobile contextual drawers throughout the flow.
- [ ] Verify audio, versions, upload, linking, splits, forms and deep links unchanged.

### 3. Campaign workflow — planned

Routes: `/campaigns`, `/campaigns/:id`, `/radio-plugging`,
`/radio-plugging/:campaignId`, `/radio-stations`.

- [ ] Bring campaign index and radio work into the same navigation/row language.
- [ ] Keep campaign identity exclusively in the context column and tabs high.
- [ ] Review Overview, Outreach, Content and every More destination, including
  drafting, review, contact selection, attachments and dialogs.
- [ ] Complete column Focus/Restore and mobile drawers without losing selection.

### 4. Analytics, royalties and tasks — planned

Routes: `/dashboard`, `/today`, `/analytics` (all section query values),
`/forecast`, `/royalties`, `/ops-tasks`, `/data-quality`, `/integrations`.

- [ ] Analytics first glance: selected scope, period, trustworthy result and
  source freshness. Put imports, diagnostics and provenance in Data Health.
- [ ] Royalties first glance: period, reconciliation state and next action.
  Statements, allocations, payees and transaction evidence remain accessible.
- [ ] Tasks first glance: actionable work and relevant blockers. Keep board/list
  options and editing available without showing every workflow simultaneously.
- [ ] Check empty, stale, failed import and permission states as real screens.

### 5. Remaining administration and artist-facing work — planned

Routes: `/grants`, `/budget`, `/contacts`, `/events`, `/events/:id`, `/projects`,
`/projects/:id`, `/documents`, `/media-assets`, `/settings`, `/help`,
`/artists/:id/portal`, `/artist-portal`, `/payee`.

- [ ] Reuse selected-object lists and inspectors for directories and assets.
- [ ] Move secondary grant/budget setup forms behind deliberate actions.
- [ ] Review every Settings tab and form with the same components and spacing.
- [ ] Give artist/payee portals a focused task flow while preserving rights,
  agreements, personal details and financial verification requirements.
- [ ] Align login/signup/reset/invitation/native-handoff presentation. Public press
  pages may retain artist editorial branding; shared controls stay accessible.

## Per-workflow acceptance gate

Complete a workflow only when all of these hold:

1. Its first glance follows the agreed hierarchy; no repeated section title or
   unrequested hero, no competing palette/font, no decorative KPI/card stacks.
2. Every tab and More item renders useful content; nested forms, sheets, dialogs,
   history and bulk work follow the same design language.
3. Columns restore selection, keyboard focus and scroll context; mobile has no
   clipped actions or page-wide overflow. Review at 1440, 1024, 390 and 320 pixels.
4. Populated, empty, loading, error and read-only/permission states are checked.
5. Deep links, filters, uploads, rights data and mutations retain their behavior.
6. Capture actual before/after screens, run focused behavior checks and the
   repository CI gate, then obtain visual acceptance before calling it finished.

Use one reviewable workflow per delivery rather than adding a new page-specific
theme. Keep unfinished items open. The public repository currently has Issues
disabled; this checklist and the implementation PR carry rollout status.

## Catalog continuation — 30 September 2026

The artist and work detail layouts now follow the shared first-glance hierarchy.
Artist navigation uses installed tabs; the work editor shows one rights scope at
once. Existing row edits survive scope changes. Release evidence and Samply
setup remain available through disclosures; editing and confirmation use the
installed Dialog. Catalog browsing becomes a Sheet on phones.

Browser review covers all seven artist tabs, all five work tabs, all eight release
sections, Catalog collapse/restore, phone drawer focus return, edit-dialog Escape
and the master-rights deep link. Artist and work detail fit at 320, 390, 1024 and
1440 pixels; release sections were checked at 390 pixels. Disposable fixture
screens include absent analytics and missing metadata; component regression
checks include read-only rights navigation and draft preservation.

Provider uploads, live audio/version playback, every permission/error variant,
index layouts and full-flow column restoration still need verification. Final
focused UI checks pass (34 tests), and schema/type/build checks pass. Full CI is
blocked by 12 timeouts in the unchanged Sisense browser-contract suite; one also
reproduced separately. Do not merge until the required checks are green. This is
a local review and draft delivery, not visual acceptance or production deployment.

## First delivery boundary

This delivery establishes common tokens and repairs the track editor. It does
not claim that all routes, column controls, forms or portals have been migrated.
The remaining workflow passes above are required for full-suite acceptance.
