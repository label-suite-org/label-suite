# Label Suite interface contract

This is the design target for the signed-in suite. It records the established
layout rules; it does not certify that every existing screen already follows them.
See [the rollout checklist](docs/ui-continuity.md) for implementation status.

## Character

A calm, light artist administration workspace, with the clarity of a music
player. Artwork and the selected artist/release give the page its identity.
Operations remain available without filling the screen with every field.

## Binding layout rules

- Show the section name once in navigation. Breadcrumbs may repeat it. Keep an
  accessible page heading, visually hidden when it duplicates navigation.
- The object name is meaningful: artist, release, campaign, work or selected
  track. It may identify the current record. Avoid repeated hero summaries.
- Catalog exposes the selected artist → release → track branch. Other branches
  stay available through deliberate browsing.
- Campaign context belongs in the second column: artwork, name, artist and
  purpose. Main content starts with Overview, Outreach, Content and More; no
  second large artwork or campaign hero above those tabs.
- At first glance show identity, current work, the next useful action and
  blockers relevant to it. Evidence, history, setup, imports and advanced fields
  belong in their tab, inspector, accordion or sheet. Do not remove information
  to make the layout look simpler.
- Lists use rows and quiet dividers. Reserve cards for independently meaningful
  content; avoid a card inside a card inside a card.
- Context columns must collapse and restore smoothly. On phones use accessible
  drawers with sensible focus return. Respect reduced motion; ordinary column
  transitions should take approximately 300–350 ms.

## Shared visual language

Use the installed shadcn/ui components in `src/components/ui`. Use semantic
tokens from `src/styles/global.css`; no page-owned font, palette or radius theme.
Geist is the incumbent shared font. Use normal readable text sizes and restrained
headings, not oversize dashboard slogans or pervasive uppercase labels.

The working baseline is white surfaces, quiet neutral dividers, modest component
corners and a restrained blue selection/focus accent from the existing Catalog
and Campaign studies. The exact accent and corner scale remain reviewable;
these details are not newly owner-approved. Artwork supplies personality.
Dark mode, where explicitly selected, must keep the same structure and semantics.

Use `Button` default for the principal action, outline/secondary for supporting
actions and ghost for navigation/row controls. A multiline selectable row needs
an automatic height; it must not inherit a compact action button's height.
Use Tabs for views, Accordion for optional evidence, Sheet for contextual mobile
work, Dialog for a focused confirmation/form, Table for comparable records and
Badge for quiet state. Preserve keyboard behavior, labels and focus indicators.

Keep the primary sidebar compact. Secondary work stays in collapsible groups;
show child destinations when their parent is active. Artist Overview shows a
short release selection with a route to the full catalog. Images follows the
core catalog and collaboration tabs. Spotify followers and popularity are
provider-owned, read-only observations, never profile inputs or readiness tasks.

Review shared components and meaningful states in Storybook using the same
tokens and fictional records. Follow `docs/storybook.md`, then check the actual
route: an isolated story does not establish integrated workflow correctness.

## Evidence and truth

Start visual proposals from screenshots of shipped interfaces and the accepted
prototypes. Record the source and capture date alongside private design evidence.
Samply informs audio/version clarity; light music players inform record identity
and track rows; Infinite Catalog informs relational/royalty needs. Their themes
and information density are not automatically part of this contract.

Use ImageGen with those screenshots to explore proposals. Never hand-author SVG
UI mockups. State whether Google Stitch actually generated a proposal; an older
stored Stitch theme does not override later user decisions. Generated concepts
are directional, and must be checked against these rules before implementation.

Keep empty, loading, error, permission and populated states honest. Missing data
is not a zero result. Readiness details, rights, audio versions, timestamps,
provenance and financial controls must survive progressive disclosure.

## Acceptance

Check each tab, nested editor, modal, drawer and empty state, not just landing
pages. Compare real rendered screens at desktop and phone sizes against this
contract. Preserve deep links and mutations; verify targeted behavior tests.
Local preview, CI, owner acceptance, merge and deployment are separate states.
