# Label Suite design language

This is an extraction of the current signed-in website, extending `DESIGN.md`
and the component baseline. Use it to keep new and existing screens related.
It is not a replacement theme or a claim that every route is already consistent.

## Baseline and source of truth

On 5 November 2026, the signed-in site at `https://suite.truenature.online`
and the read-only operator health endpoint were checked. Deployed revision
`047c178674f4f67be17b86a769decfac438b9ea0` matches public `origin/main` in
`label-suite-org/label-suite`. The feedback tooling branch adds Storybook and
development feedback work on that baseline. The historical `label-suite_neon_r2`
checkout is not the source for this reference.

Visual samples: Dashboard, artist and release indices, artist Overview, and
release Overview on desktop; release Overview at a measured 390px viewport.
The sampled release had no horizontal overflow. Screenshots containing private
workspace records remain outside Git. Other routes, dark-mode product screens,
and all interactive states are not certified by this sample.

| Authority | Existing source |
| --- | --- |
| Colour and theme values | `src/styles/global.css`, `:root` and `.dark` |
| Components and interaction behaviour | `src/components/ui/` |
| Shell and navigation | `AppShell.tsx`, `AppSidebar.tsx`, `BottomNav.tsx` |
| Record identity and view hierarchy | `artists/ArtistWorkspace.tsx`, `releases/ReleaseWorkspace.tsx` |
| Browsing, rows and editing examples | Catalog / Working views stories |
| Reviewable visual reference | Library / Patterns / Foundations |
| Remaining adoption work | `docs/ui-continuity.md` |

The stylesheet is the token source. Do not create a second hand-maintained JSON
palette or copy token values into pages. The Foundations swatches use CSS
variables directly, so shared-token changes appear there automatically.

## Character

A light, calm workspace for music and its administration. A record's artwork,
name and relationships carry identity. Controls are restrained and predictable.
Use space and dividers to establish hierarchy; make the next task apparent.

## Foundations

| Role | Existing convention | Use |
| --- | --- | --- |
| Typeface | Geist Variable | Shared across the signed-in suite |
| Record identity | `text-2xl sm:text-3xl font-semibold tracking-tight` | 24px phone / 30px desktop, observed on the release |
| Compact title | `text-xl font-semibold` | Inspector or compact selected record |
| Record section heading | `text-lg font-semibold tracking-tight` | Releases and Tracks on the existing detail pages |
| Supporting heading | `text-base font-semibold` | A smaller group of working content |
| Body / controls | `text-sm` | 14px reading and action labels |
| Metadata | `text-xs text-muted-foreground` | 12px supporting facts, never the only error explanation |
| Related spacing | `gap-1`, `gap-2`, `gap-3` | 4 / 8 / 12px within a group; header actions use 12px and wrap |
| Group spacing | `gap-4`, `gap-6`, `gap-8` | 16 / 24 / 32px between content groups |
| Shell padding | `p-6` | Existing 24px content inset; do not add another page-wide inset |
| Corners | `rounded-lg`, `rounded-md` | Existing 8px control / 6.4px badge scale from the 0.5rem base |
| Depth | Existing layer shadows | Menus, dialogs and sheets; ordinary content stays flat |

The identity scale corrects the older baseline's incomplete 20/24px description;
it reflects current ArtistWorkspace/ReleaseWorkspace and the live release.
These values describe the baseline, not new visual approval.

### Colour means something

- `background` / `foreground`: the working canvas and primary text.
- `muted` / `muted-foreground`: quiet grouping and supporting text.
- `border`: low-contrast separation, without enclosing every group.
- `primary` / `primary-foreground`: principal action; `ring`: keyboard focus.
- `accent` / `accent-foreground`: selected navigation or record context.
- `success`, `warning`, `destructive`: labelled outcomes and problems.
- `sidebar` and related tokens: the shared navigation surface.

Always pair foreground and background roles. Badge text must name the state;
colour alone cannot distinguish it. Light and dark use the same roles and
structure. Public artist press pages can retain their separate editorial style.

## A common grammar for pages

| Layer | What belongs here | Existing example |
| --- | --- | --- |
| Navigation | Where am I, and what else can I work on? | Compact primary sidebar; active children; phone bottom navigation |
| Identity | Which artist, release or work is selected? | Artwork/fallback, record name, short metadata, relevant actions |
| Views | Which aspect of this record am I working on? | Line tabs; More for secondary sections |
| Immediate task | What matters now? | One relevant blocker and its next action |
| Working content | The records or fields needed for that task | Quiet rows, comparison table or labelled form |
| Supporting detail | Evidence, provenance, history, setup | Accordion, secondary tab or context sheet |

Indices use search/filter controls followed by record rows. Detail pages use
identity, view navigation and working content. A workspace with a context column
keeps identity there rather than repeating it above the main content. A dialog
edits the selected object without replacing the navigation model.

Links navigate; buttons act. Default Button marks the principal action, outline
or secondary supports it, and ghost keeps row controls quiet. Preserve the
installed component's size, focus treatment and disabled/saving states.

## Fluid layout and continuity

These are adoption rules grounded in the existing shell and component patterns;
they are not a claim that every route satisfies them yet.

1. **Let content use available width.** Use `min-w-0` for flexible children and
   `minmax(0, 1fr)` for a flexible grid column. Use `max-w-prose` for long prose;
   let tables and working lists use their working area.
2. **Reflow rather than shrink text.** Wrap action groups and long record names.
   Stack fields and identity metadata on narrow screens. Keep input text at
   the component's phone size. Never clip a save control to keep a row short.
3. **Use existing navigation adaptations.** The app uses a 200px sidebar on
   desktop and BottomNav below 768px. Context panes use Sheets where implemented;
   do not add a second independent mobile navigation system.
4. **Keep horizontal scrolling local.** A long tab strip or comparison table
   may scroll within its own region; the whole page should not become wider
   than the viewport. Do not hide overflow to conceal unreachable controls.
5. **Keep the user's place.** Preserve selected object, active view, query/deep
   link, unsaved draft and return path when opening or closing a detail surface.
   Restore focus on dismissal; collapsed context should restore its selection.
6. **Use motion to explain a change.** Context transitions follow the existing
   approximately 300ms pattern and honour reduced motion. Avoid decorative
   animation or changing the layout unexpectedly after loading.

## Honest states

Use the existing Empty, Skeleton/Spinner, Alert, Badge and FieldError patterns.
An empty catalog offers a first action; loading is temporary; failure offers a
recovery action; read-only explains authority. Missing analytics is not zero.
A failed save retains the draft. Success follows confirmation, not the click.

## How to use this language while building

1. Inspect the current route and identify the page grammar above.
2. Open its actual component story and the Foundations reference. Reuse the
   installed primitive and a nearby working consumer before adding anything.
3. Page classes arrange content; they do not invent another control palette,
   font, radius or focus style. Adjust shared tokens only as an intentional
   suite-wide decision and review their consumers.
4. Review the changed surface at 1440, 1024, 390 and 320px, plus long names,
   relevant empty/error/permission states and keyboard navigation.
5. Use Agentation for element-specific feedback, test the affected stories,
   then check the integrated route and its navigation/persistence behaviour.

Existing inconsistencies remain in the continuity checklist. For example,
Dashboard's uppercase section labels differ from the quieter record views,
and the release-to-tracks route can lose the return-to-Today context. Do not
turn either into a new design convention. Address adoption one workflow at a
time; the language provides a shared reference throughout that work.

## Website-to-Storybook workflow

Start from the existing website and its source. Display the same component in
Storybook. When a useful part is inline in a page, extract that markup without
changing its appearance and make the page call it too. Do not maintain a copied
Storybook version. Keep the existing CSS tokens as the only style authority.

## Artist and release component reference

As of 6 November 2026, start at **Existing website / Design language / Reference**.
The signed-in artist and release pages were inspected again before this extraction.
The reference and the application import the same components; there is no copied
Storybook implementation or second palette.

| Pattern | Actual component | Review |
| --- | --- | --- |
| Artist identity and actions | `ArtistHeader` in `artists/ArtistWorkspace.tsx` | Artist header: Editable, Read Only; Design language: Long Names |
| Release identity, cover and status | `ReleaseHeader` in `releases/ReleaseWorkspace.tsx` | Release header: Editable, Read Only; Design language: Long Names |
| Artist views | `ArtistSectionNavigation` inside the existing `Tabs` root | Design language: Artist Navigation, including keyboard selection |
| Release views | `ReleaseSectionNavigation` | Design language: Release Navigation, including More and preserved return query |
| Artist release selection | `ArtistReleaseSection` | Design language: Reference, Empty Lists, Artist Release Selection |
| Release overview tracks | `ReleaseTracklist` | Design language: Reference, Empty Lists, Long Names |

The two navigation types deliberately retain their existing semantics: artist
views are controlled tabs; release views are links with section URLs and a More
menu. Keep modified-click navigation, active indication, deep links and unsaved
correction protection in the page. The extracted navigation delegates selection
to the existing page handler.

Identity uses the existing 24/30px scale. Record section titles use the existing
18px scale; supporting groups can use 16px. Header actions use a wrapping 12px gap.
Artist and release artwork use 80px on phones and 96px from the small breakpoint. Release identity
and track names now wrap instead of overflowing or hiding the end of the title;
readiness labels and editing controls remain visible.

The actual artist and release detail routes now use this language: a wrapping
identity header with 16px gaps, a 44px view strip, 24px between workspace groups,
and 16px between a section heading and its content. Sync deals sits alongside
the other header actions on both pages and keeps the existing edit permission
and record-specific URL. Readiness uses the existing labelled Badge variants;
row hover and keyboard focus use the shared muted and ring tokens. Artist tabs,
release section links, More, and correction drafts retain their existing behaviour.

**Library / Patterns / Foundations** documents the shared CSS tokens, type,
spacing, actions and states. It uses neutral labels. Existing Fields and Layers
stories cover validation, saving, failure, confirmations and focus return.

**Existing website / Current pages / Artist And Release** is an optional local
visual sample of the inspected artist and release. It shows identity and selected
rows, not a full workspace or live connection. Its data and artwork are excluded
from Git. Public stories use neutral labels; all reference saves are disconnected.

The full ArtistWorkspace and ReleaseWorkspace stories continue to exercise page
integration, including correction success/failure and permissions. Browser review
must also check both ordinary and long names at 1440, 1024, 390 and 320px.
Storybook verification is local; it does not certify a deployed route or backend
persistence. No merge or deployment is part of this extraction.

Storybook is the working component reference. The earlier Builder navigation
experiment remains a historical fixture under Library / Workspace language;
it is not the design-language entry point. Penpot is not required in this workflow.

## Catalog lists and creation

Works follows the same list and creation language while retaining its priority
queues, payout summary, clearance meters and rights-editor links. Search, queue
and sort travel in the URL so reload and browser Back restore the chosen view.
Clear filters shows all works without changing the chosen sort, including when
the default Priority queue is empty but cleared works exist. The empty route
uses the same `WorksList` as Storybook. New Work uses the shared Dialog trigger
so Cancel and Escape return keyboard focus, and failed saves retain the draft.
**Catalog / Working views / Work List**, **Create Work**, **Empty Works** and
**Work Save Failure** render these actual components.

Artists and Releases keep the existing search, filters, quiet rows, readiness
links and Details disclosures. Group headings use the 18px section size; row
metadata uses 12px; names wrap rather than disappearing on narrow screens.
Toolbars use 12px action gaps and rows use 16px vertical spacing. The Artist
Browse/Compare choice, search, relationship, activity and sort travel in the URL,
following the existing Release list convention so browser Back restores them.

Both routes render their roster component even when empty. Storybook therefore
uses the same first-record and filtered-empty states as the actual pages.
Filtered-empty states offer Clear filters without changing the chosen sort/view.
Create dialogs use the installed Dialog header, description, fields and buttons;
form actions share a quiet divider and 12px gap. Existing optional fields,
validation and save/retry behavior remain in the actual forms.

**Catalog / Working views / Artist List** and **Release List** are manual review
entries. Creation, cancellation/focus return, retained drafts on failure, read-only
browsing and empty states are covered by adjacent stories. The disposable
`catalog-journey.spec.ts` checks real persistence, linking a release to its artist,
browser Back, cancel without writes, and read-only access at desktop, 390px and
320px. Story mocks do not stand in for this integrated check.
