# Label Suite Mobile Feature-Parity Inventory

> Tracking: canonical Forgejo review for `codex/229-mobile-parity-map`
> Baseline: `origin/main` at `4cbd46c` (2026-08-13)
> Scope: product and interaction inventory only; no production UI implementation

## Purpose

Label Suite mobile is the complete Label Suite product presented deliberately for a phone, not a reduced companion product. Every canonical record and implemented operator action must remain reachable, understandable, and safe on mobile. Desktop density may change, but authority, provenance, review gates, and record boundaries may not.

This inventory distinguishes four different claims:

- **Reachable:** the route is available from the current mobile shell.
- **Responsive:** the surface has layout behavior intended for a narrow viewport.
- **Usable:** the important workflow can be completed with touch, the software keyboard, and phone-sized information density.
- **Parity-ready:** the mobile workflow preserves all implemented actions, states, permissions, evidence, and approval gates.

Route presence or a responsive class is not proof of usability or parity.

## Current mobile baseline

The current application already provides:

- one shared Astro/React application and canonical route set;
- a mobile bottom bar for Dashboard, Today, Events, Artists, and Releases;
- a More sheet containing the remaining workspaces and contextual domains;
- mobile access to Command-K search from the More sheet;
- safe-area padding on the bottom bar and More sheet;
- a 16-pixel-equivalent viewport declaration and a mobile content bottom inset;
- automated navigation checks at mobile viewport sizes;
- targeted no-horizontal-overflow checks for Campaign overview and outreach.

The current baseline does **not** establish full mobile parity. There is no screen-by-screen mobile completion gate across the product, and many dense surfaces use wide tables, multi-column layouts, or desktop-oriented editors. Those require interaction decisions, not only breakpoint fixes.

## Mobile interaction contract

These treatments should form one shared mobile language:

| Need | Mobile treatment |
| --- | --- |
| Global navigation | Five-item bottom tab bar with stable destinations; complete hierarchy in a full-height More/navigation sheet. |
| Page hierarchy | iOS-like navigation stack: large page title at the root, compact title after scroll, explicit back/context link on detail screens. |
| Record lists | Search and filters above scannable rows; preserve sorting and status; open a detail screen rather than placing every field in the row. |
| Dense tables | Summary rows/cards for normal use, with column selection or an explicit full-table inspection mode when exact comparison is necessary. |
| Object detail | Summary first, then grouped sections. Use sticky or compact segmented navigation only when the number of sections justifies it. |
| Create and edit | Full-height sheet or pushed screen with grouped fields, visible validation, keyboard-safe actions, and unsaved-change protection. |
| Quick actions | Swipe or context-menu actions only as shortcuts; every action must also have a visible accessible control. |
| Filters and scopes | Bottom sheet with an active-filter count and a clear reset path; current scope remains visible after dismissal. |
| Selection | Explicit Edit/Select mode; never depend on hover or desktop modifier keys. |
| Destructive actions | Confirmation sheet naming the exact record and consequence. Preserve existing capability checks. |
| External sends | Complete preview, recipients, content revision, and explicit approval remain visible before send or publish. |
| Finance approvals | Amount, currency, source evidence, variance, and decision authority remain visible together before approval. |
| Files | Native file picker/camera where supported, visible upload progress, provenance fields, and safe signed download/share behavior. |
| Charts | A concise KPI and takeaway first; touch exploration and an accessible data view; no hover-only meaning. |
| Empty/error states | Distinguish missing, stale, partial, invalid, unreviewed, unavailable, and permission-restricted states. |
| Feedback | Inline result plus appropriate toast/haptic-like visual response; never hide a failed save or provider action. |

“iOS-native” describes interaction quality and hierarchy, not a decorative copy of Apple system applications. Label Suite keeps its own visual identity and web accessibility.

## Primary workspaces

| Screen/workflow | Current implemented responsibility | Mobile treatment required | Main parity risk | Prototype evidence needed |
| --- | --- | --- | --- | --- |
| Dashboard (`/dashboard`) | Personalized overview, selected operational modules, analytics decisions, release pipeline, and funding coverage. | Large-title Home root; reorder/edit mode; vertically composed modules; concise attention items linking to canonical records. | Desktop customization controls and heterogeneous modules may create an overlong, inconsistent feed. | Reorder modules, inspect an attention item, and return without losing position. |
| Today (`/today`) | Daily decisions, agenda/time signals, deadlines, calls, grant work, funding signals, and bug inbox. | Timeline/agenda feed grouped by urgency and time; inline completion for safe tasks; contextual drill-down for consequential work. | Too many unrelated signals can become a dashboard dump instead of a daily command surface. | Complete one task, inspect one deadline, and defer one item using one-handed interactions. |
| Artist roster (`/artists`) | Search/browse artists, readiness summaries, contact linkage, and artist creation. | Search-first native list; compact readiness/status indicators; create via full-height sheet. | Desktop roster density and creation form may be cramped; readiness cannot rely on color alone. | Find an artist, understand readiness, create/edit a minimal artist record. |
| Artist detail (`/artists/:id`) | Artist profile, identity/contact relationships, readiness, releases, works/campaign context, and artist analytics. | Collapsing header; Overview, Releases, Rights, Campaigns, Analytics, and Files sections; edit pushed as a dedicated screen. | Many cross-domain panels can bury the artist’s current state and create excessive scroll. | Move between identity, readiness, and analytics while preserving the artist context. |
| Release roster (`/releases`) | Browse releases, pipeline/readiness information, filters, and release creation. | Cover-led rows with date, artist, phase, and blocking status; sheet-based filters; dedicated create screen. | Complex readiness and release-type distinctions may be reduced too aggressively. | Find a blocked release, identify the blocker, and create a basic release. |
| Release detail (`/releases/:id`) | Metadata, readiness, timeline/milestones, tracks/works, DSP pitches, Samply review, analytics, campaigns, budget items, assets, and documents. | Release navigation stack with sticky identity header and section index; priority/blocker summary before detail; contextual child screens. | This is the broadest object workspace and will fail if reproduced as one long desktop page. | Resolve a readiness blocker, inspect a track, review audio context, and open linked budget/campaign evidence. |
| Track editor (`/releases/:id/tracks`) | Create/edit tracks, link Works, manage identifiers and readiness evidence. | Track list → track editor screen; grouped metadata and readiness; next/previous track controls. | Repeated metadata entry, keyboard coverage, and identifier validation on a small screen. | Edit consecutive tracks without returning to the release root or losing unsaved work. |
| Campaign list (`/campaigns`) | Browse campaigns by artist/release/type/status and create/edit campaign records. | Status-grouped list with search/filter sheet; prominent campaign stage and next action. | Campaign status may be visible while the actual next operational action remains hidden. | Locate the campaign needing attention and enter directly into that work. |
| Campaign detail (`/campaigns/:id`) | Overview, rich content, audiences, channels, outreach/lead workflow, enrichment review, email logs, public-page review/publish, and radio context. | Campaign header plus task-oriented sections; outreach uses queue → lead detail navigation; editors use keyboard-safe full screens; approval is a distinct review screen. | Highest consequential-action risk: rich editing, recipient context, AI proposals, send/publish approval, and multi-pane lead work. | Draft/edit, inspect relationship history, accept/reject a proposal, preview recipients/content, and stop before the explicit send gate. |
| Analytics (`/analytics`) | Overview, trends, revenue, audience, playlists, data quality, imports/sync logs, artist/release scopes, and forecast child section. | KPI summary first; horizontally scrollable section tabs; filters in sheet; charts with touch and data-list alternatives; imports in dedicated screens. | Charts and wide comparison tables can become visually present but functionally unreadable. | Change artist/release scope, inspect a chart point, use its data view, and understand freshness/quality. |
| Forecast (`/analytics?section=forecast`) | Contextual analytical forecast and planning view. | Scenario summary, assumptions, range, and timeline in stacked sections; controls separated from results. | Dense projections can imply false precision or require wide horizontal comparison. | Change one assumption and understand base/range impact without horizontal page scrolling. |

## Operational workspaces

| Screen/workflow | Current implemented responsibility | Mobile treatment required | Main parity risk | Prototype evidence needed |
| --- | --- | --- | --- | --- |
| Events and Projects (`/events`) | Toggle between event agenda and project portfolio; create and manage both record types. | Agenda-first Events tab and searchable Projects tab; create actions open record-specific sheets/screens. | Event and Project are distinct objects but currently share a workspace; mobile must not blur the distinction. | Switch views, create each record type, and follow their different relationships. |
| Event detail (`/events/:id`) | Event identity, dates/status, project context, people, tasks, campaigns, files, assets, and budget links. | Date/status header; agenda and next actions first; grouped related records; calendar-friendly editing. | Large linked context can obscure the actual happening and its immediate operational state. | Update schedule/status and open a linked task/file without losing event context. |
| Project detail (`/projects/:id`) | Goal-oriented workspace with overview, schedule/events, people, tasks, files, money, grants, and campaigns. | Project summary and segmented sections; workstream status and next action remain persistent. | Similar content to Event but different meaning; navigation must maintain the object boundary. | Move across schedule, people, files, and money while clearly remaining in a Project. |
| Tasks (`/ops-tasks`) | Task list/create/edit with links to Artists, Releases, Campaigns, Events, Projects, Contacts, and Grants. | Today/upcoming/all scopes; compact rows; inline safe completion; full edit screen for relationships and assignment. | Relationship selectors and bulk/dense task management can be difficult with touch. | Complete, reschedule, reassign, and open the canonical parent object. |
| Royalties (`/royalties`) | Overview, records, statements/runs, data quality, imports, unmatched identity review, and payout preview/evidence. | Read-only financial summary first; dedicated import/reconciliation flow; row detail screen; guarded payout review. | Wide statements, currencies, identity matching, and payout semantics must not be simplified into unsafe summaries. | Import a statement sample, resolve an unmatched row, and inspect a payout preview without executing payment. |
| Grants and Funding (`/grants`) | Funding cockpit, opportunity research, worklist, applications, requirements, evidence/materials, deadlines, decisions, and reports. | Worklist-first root; application detail stack; deadline timeline; evidence picker; dedicated decision/report screens. | The current cockpit contains dense tables, tabs, drawers, and many state types; terminology can collapse on mobile. | Start an application record, attach evidence, inspect requirements, and locate the next deadline. |

## Directory and administration

| Screen/workflow | Current implemented responsibility | Mobile treatment required | Main parity risk | Prototype evidence needed |
| --- | --- | --- | --- | --- |
| Contacts (`/contacts`) | Person/organization directory, details, edit/create, affiliations, relationship context, Gmail connections, and reviewable enrichment suggestions. | Search-first Contacts root; person/organization badge; native contact-like detail; suggestion review as before/after sheet. | Person and organization identity must remain distinct; enrichment must never look auto-applied. | Find a contact, inspect history/affiliation, and accept or ignore one cited suggestion. |
| Search / Command-K | Search real Label Suite records and navigate to canonical destinations. | Search tab/action opening a full-screen search with recent records, grouped results, and software-keyboard focus. | “Command-K” is desktop language; mobile access exists but discovery and result density need validation. | Open search from anywhere, find a record across domains, and return predictably. |
| Settings (`/settings`) | Workspace/member/invitation settings, integrations/operations, local-tool tokens, job visibility, and theme/account controls. | Grouped Settings list → detail screen; capability-restricted rows explain access; secret/token actions get dedicated confirmations. | Operational settings and credentials can be too dense or expose sensitive values in screenshots. | Invite/revoke flow, inspect integration health, change theme, and manage a token safely. |
| Authentication and invitations | Login, signup, invitation acceptance, password reset, session and membership boundaries. | Platform-consistent forms, password-manager/autofill support, keyboard-safe validation, clear workspace/invitation identity. | These screens sit outside the signed-in shell and can be missed by a feature-only mobile audit. | Complete login, invitation acceptance, failure recovery, and password reset at 320–430 px. |

## Contextual domains

| Screen/workflow | Current implemented responsibility | Mobile treatment required | Main parity risk | Prototype evidence needed |
| --- | --- | --- | --- | --- |
| Works list (`/works`) | Prioritize compositions/rights identities, create Works, and expose clearance state. | Search/filter list with clearance state and linked-track count; dedicated create screen. | Work, Track, and Release identities can become visually ambiguous. | Identify an uncleared Work and follow it to its supporting roles/tracks. |
| Work detail (`/works/:id`) | Publishing/master clearance workspace, roles, contacts/organizations, scopes, ownership, and linked tracks. | Clearance summary first; roles as inspectable rows; add/edit Role screen with explicit scope and ownership. | Rights decisions contain dense legal/identity fields where truncated labels are dangerous. | Add/review a role and understand why the Work is or is not clear. |
| Catalog (`/catalog`) | Chronological release-number index and metadata, linked one-to-one to Release identity. | Searchable chronological list; number and release identity prominent; detail/edit sheet. | Catalog entry must never appear to replace the Release record. | Find a catalog number and move to the canonical Release. |
| Radio Plugging (`/radio-plugging`, `/radio-plugging/:campaignId`) | Campaign-specific radio workflow, station targeting/status, drafts and activity. | Campaign picker; station queue; station detail/status sheet; draft review as dedicated screen. | Desktop cockpit density and status grids may turn into horizontal-scroll dependence. | Progress one station through the workflow while preserving campaign and relationship context. |
| Radio Stations (`/radio-stations`) | Station directory, contact fields, campaign relationships, templates, and email composition context. | Station search/list; station detail; campaign history; composer as a separate reviewable flow. | Directory identity and outbound-email action are tightly adjacent; accidental send risk must stay bounded. | Find/edit a station and prepare—but do not send—a contextual email. |
| Media Assets (`/media-assets`) | Asset metadata, upload/storage reference, artist/release ownership, approval/provenance state. | Thumbnail list/grid toggle; native picker/camera upload; progress; metadata and ownership screen. | Mobile upload state, large media, weak networks, and private/public distinctions. | Upload, recover from interruption, set ownership/provenance, and inspect signed access. |
| Documents (`/documents`) | Reusable legal/operational documents, contextual ownership links, metadata, and signed access. | Document list with type/status; file picker/scanner where supported; metadata and link management screen. | Shared evidence must be linked/unlinked without implying destructive deletion. | Add a document, link it to a record, download/view it, and unlink safely. |
| Budget (`/budget`) | Projects, funding stack, KPI/coverage, bucket matrix, cashflow, line items, evidence links, and variance requests. | Project selector; financial summary; buckets and cashflow stacked; line item list/detail; guarded variance decision screen. | This is a highly dense desktop financial workspace; horizontal tables and separated evidence can make approvals unsafe. | Review totals and evidence, edit a line item, request a variance, and approve/reject with full context. |

## Integration and capability boundaries

Mobile parity applies to implemented Label Suite behavior, while provider maturity remains truthful:

| Capability | Current status | Mobile implication |
| --- | --- | --- |
| PostgreSQL/Neon canonical state | Active | All mutations retain tenant and capability checks; optimistic UI cannot invent success. |
| Sisense/Periscope analytics imports | Active when configured | Show source, freshness, last successful import, and retained last-good state. |
| Samply release review | Partial | Expose implemented link/sync/files/comments honestly; show unavailable or manual states for missing durable sync/webhooks. |
| Gmail contact enrichment | Active inbound suggestions | Mobile reviews suggestions; it never silently changes Contacts. |
| Campaign enrichment MCP | Active proposal-only | Mobile can accept/reject cited pending proposals only through authenticated Label Suite authority. |
| STEM/royalty files | Manual inbound | Mobile file selection may be supported, but parsing/reconciliation provenance remains visible. |
| Brevo operational email | Active outbound | Mobile preserves complete preview and explicit approval before consequential delivery. |
| Cloudflare R2 storage | Active | Use private signed access and visible upload/download state; never infer public access from a file preview. |
| Airtable | Migration-only | Do not present it as normal mobile synchronization or editable canonical data. |
| Discogs | Planned | No mobile production flow until the integration is implemented and approved. |
| Revolut | Planned | No payment execution surface; current finance mobile work is evidence/review only. |

## Prototype order

The prototype should grow as a coherent interaction system, not as disconnected mockups. These slices are ordered by how much of the shared mobile language they test.

1. **Shell, Today, and search**
   Prove safe areas, large-title hierarchy, bottom navigation, More, full-screen search, attention rows, inline safe actions, and return-position behavior.

2. **Release operations spine**
   Prove roster → detail → section → child record navigation; readiness; forms; repeated track editing; files; linked Campaign and Budget context.

3. **Campaign outreach and approval**
   Prove queues, relationship context, rich editing, AI proposal review, recipient/content preview, and explicit send/publish gates.

4. **Dense evidence work**
   Use Analytics, Royalties, and Budget to prove charts, data alternatives, dense rows, imports, evidence inspection, currency display, and consequential approval.

5. **Cross-object operations**
   Use Event, Project, Task, Contact, Grant, Asset, and Document flows to prove record boundaries, contextual linking, selectors, upload behavior, and navigation continuity.

6. **Administration and edge states**
   Prove invitations, permissions, read-only roles, integration health, offline/provider failure, stale/partial data, long content, keyboard behavior, and 320–430 px widths.

Penpot may capture the navigation model, key screens, and reusable visual decisions. Interactive code on real iPhone-sized viewports remains the acceptance medium for scrolling, keyboard, touch, sheets, safe areas, uploads, charts, and state continuity.

## Definition of mobile parity

A workspace is mobile parity-ready only when:

- every implemented desktop capability has a reachable mobile path or an explicitly approved mobile exception;
- primary workflows complete at 320, 390, and 430 CSS pixels without page-level horizontal overflow;
- touch targets, focus order, labels, validation, and software-keyboard behavior are usable;
- tables, charts, editors, selectors, uploads, and long content have deliberate narrow-screen behavior;
- permissions and read-only states match desktop authority;
- provenance, freshness, missing/partial states, review gates, and failure states remain visible;
- destructive, outbound, publishing, and financial actions retain their explicit confirmations;
- navigation preserves canonical object identity and returns the operator to a predictable prior context;
- focused automated checks pass and signed-in device QA records visual evidence.

## Immediate design decision

Start with slice 1 as the shared shell prototype, while using the complete inventory above as the coverage contract. Do not redesign every screen in Penpot before validating the shell in interactive code. The shell decision should establish navigation depth, title behavior, list rows, sheets, forms, search, and safe-area/keyboard rules that later slices can reuse.

The throwaway primary source for this decision is Forgejo branch `prototype/mobile-shell` at commit `1a165ed`. It contains three switchable structural variants and a return-handoff template; it is evidence for review, not production implementation.
