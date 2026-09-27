# Label Suite — Product Requirements Document (PRD)

> Historical/reference document. Current product hierarchy lives in
> `docs/product/label-suite-product-map.md`; current execution state lives in GitHub Issues.

| | |
|---|---|
| **Product** | Label Suite |
| **Owner** | Malthe Lindholm (True Nature Records) |
| **Status** | Draft v1 — for developer alignment |
| **Repo** | `malthelm/label-suite` |
| **Live (internal)** | `label-suite.truenature.online` |
| **Source of truth (legacy)** | Airtable v3 base `appoKM3ylTDhR60LY` (34 tables) |
| **Companion doc** | `label-suite-technical-spec.md` |

---

## 1. One-liner

**Label Suite is the operations cockpit for independent record labels — the place a label runs the entire life of a release, from clearing rights to shipping it to DSPs to splitting the money — with readiness and clearance computed, not guessed.**

Infinite Catalog starts where the money lands. Label Suite owns everything *before* the money lands, and then takes the money side too.

---

## 2. Problem & opportunity

Running an independent label is a coordination problem spread across a dozen disconnected surfaces: a spreadsheet for splits, a calendar for release dates, an inbox for clearances, a Notion page for campaigns, a distributor portal for delivery, and an accountant (or another tool) for royalties. The single most expensive failure mode is **shipping a release that isn't actually cleared** — a track goes live with an unsigned producer split or a missing ISRC, and it becomes a legal and financial liability after the fact.

The Airtable v2/v3 base proved the model works: model the label as data, compute readiness from rights, and surface a daily "what's blocking me" view. But Airtable is fragile at this scale — formula `#ERROR!` cascades, no real transactions or constraints, business logic trapped in a spreadsheet that can't be tested or versioned. The migration to a real backend (Astro + Postgres) is the v3 already underway.

The opportunity: there is no tool that does **pre-release label operations** well. The category leader, Infinite Catalog, is a royalty-accounting product — excellent at the money, absent on the operations. A product that owns the operational spine *and* the money is strictly larger than either half.

---

## 3. Vision & competitive positioning

### 3.1 Vision

Within 18 months, Label Suite is the system of record an indie label opens first every morning and closes last every night — the place where a release is born, cleared, shipped, promoted, reported on, and paid out. It replaces the label's spreadsheet stack, its Airtable base, and its royalty tool with one fast, trustworthy, mobile-first application.

### 3.2 The Infinite Catalog wedge

| | **Infinite Catalog** | **Label Suite** |
|---|---|---|
| **Core job** | Royalty accounting & statements | End-to-end label operations |
| **Center of gravity** | After money is earned | Whole release lifecycle, money included |
| **Release readiness / clearance gating** | ✗ Not modeled | **✓ Computed engine — the product's heart** |
| **Pre-release ops (pipeline, today-hub, blockers)** | ✗ | ✓ |
| **Rights clearance (pub vs master, entered vs confirmed)** | Splits for payout only | ✓ Clearance universes with status-weighted progress |
| **Campaigns + radio promo CRM** | ✗ | ✓ |
| **Grants / funding pipeline** (KODA, Statens Kunstfond, etc.) | ✗ | ✓ (planned) |
| **A&R / artist development** | ✗ | ✓ (planned) |
| **Royalty statements + payee transparency + payouts** | ✓ (best-in-class) | Planned — table stakes to win, not the wedge |
| **Importers (DSP/distributor statements)** | ✓ on-demand, free | Planned |
| **Pricing** | Sliding scale on monthly revenue added | TBD (see §12) |
| **Self-hostable / data ownership** | ✗ (SaaS only) | ✓ optional (built self-hosted first) |

**Strategic read:** Don't win by out-accounting the accountants on day one. Win by owning the operational lifecycle IC ignores, then absorb the royalty/statement layer to make IC redundant. The clearance/readiness engine is the moat — it requires modeling rights correctly, which is exactly the modeling a payout-only tool skips.

### 3.3 What we explicitly do *not* try to be

- A distributor (we integrate with AWAL/distributors, we don't replace them).
- A DAW, a publishing administrator, or a PRO.
- A general accounting/bookkeeping ledger (we feed the accountant; we are not the GL).
- An AI music generator or A&R-discovery analytics platform.

---

## 4. Target users & personas

### P1 — The Label Operator ("Malthe") — *primary, design anchor*
Runs a small roster, wears every hat: A&R, ops, legal/clearance, grants, finance. Lives on a phone between studio sessions. Needs one place that tells the truth about what's blocking each release and what to do today. **This is the user the product is built for first.**

### P2 — The Manager / Co-runner ("Maya")
Partner with overlapping but distinct responsibilities (UX, artist-facing, business). Needs the same data, a calmer overview, and confidence the numbers are right. Drives design/UX standards.

### P3 — The Artist / Payee
Wants transparency: where is my release, what's it earned, when do I get paid. Read-mostly. Today this is unserved; the **payee portal** (planned) is how we match and beat IC's transparency story.

### P4 (future) — The multi-label / agency operator
Runs several labels or clients. Needs workspace switching and per-workspace isolation. Drives the multi-tenant requirements in §11.

---

## 5. Jobs to be done

1. **"Tell me whether this release is actually ready to ship"** — clearance complete (pub *and* master), ISRCs assigned, audio present, artwork, UPC, date set. Computed, not a checkbox someone ticked.
2. **"Tell me what's blocking me right now and what to do about it"** — a daily cockpit of calls, blocked releases, and open issues, prioritized.
3. **"Track every rights line so nothing ships uncleared"** — per-work credit/rights lines with status, fed into readiness automatically.
4. **"Run the release pipeline"** — draft → scheduled → released, with budgets, DSP pitches, media assets, and delivery status.
5. **"Run promo"** — campaigns and radio outreach as a lightweight CRM.
6. **"Fund the work"** — track grants/applications (KODA, Statens Kunstfond, ROSA, MXD) through their pipeline.
7. **"Account for the money"** — ingest DSP/distributor earnings, compute net, split it, show payees their balances, record payouts.
8. **"Don't make me re-enter anything"** — migrate the Airtable v3 base in once; never maintain two sources of truth again.

---

## 6. Product principles

1. **Truth is computed.** Readiness, clearance, overdue status, balances — derived from data in code, never a manually-maintained flag. (Lesson #1 from v2: logic lives in code, not Airtable formulas — testable and versioned.)
2. **Every gate is explainable.** A boolean for the machine *and* a human-readable "what's missing" string for the person. No silent failures.
3. **Idempotent self-healing.** The validation sweep upserts issues by a canonical key — no duplicate bugs, ever. Re-running is always safe.
4. **Calm, mobile-first UI.** Data is the hero. White space, restrained palette, instant loads (Astro zero-JS default, islands only where interaction is essential). Every page usable at 375px.
5. **Speed is a feature.** SSR + selective hydration. The cockpit must feel instant.
6. **Own the code and the data.** Self-hosted-first, full ownership; no fragile external auth/vendor lock-in.

---

## 7. Scope

### 7.1 In scope (the product)
Release lifecycle management, rights/clearance, computed readiness, daily cockpit, budgets, DSP pitches, campaigns + radio promo, media assets, documents, ops tasks, grants/funding, royalty ingestion + statements + payee portal, and the multi-tenant SaaS shell needed to sell it.

### 7.2 Non-goals (now)
Distribution delivery itself, bookkeeping/GL, AI generation, public discovery/analytics marketplace, mobile native apps (PWA/responsive web is the bar).

---

## 8. Functional requirements by domain

Status legend: **Built** (live in repo) · **Partial** (exists, fidelity/coverage gaps) · **Planned** (not yet modeled) · **SaaS** (required to ship as a product, not yet started).

### 8.1 Identity & access — *the spine for everything else*
- **FR-AUTH-1 (Built):** Email/password + magic-link auth (Better Auth), cookie sessions, route protection via middleware.
- **FR-AUTH-2 (SaaS):** Organizations/workspaces. Every domain row scoped to an `org_id`. A user belongs to one or more orgs.
- **FR-AUTH-3 (SaaS):** Roles & permissions — Owner, Operator, Member, Payee (read-only portal). Enforced server-side.
- **FR-AUTH-4 (SaaS):** Self-serve signup → create org → onboarding wizard (vs. today's single-tenant seed).

### 8.2 Roster & contacts
- **FR-ART-1 (Partial):** Artists — name, bio, Spotify ID/followers/popularity, PRO, IPI, IG/TikTok, contact link. *Gap:* YouTube/Soundcharts, genres, priority tier, team, image, **metrics history**.
- **FR-CON-1 (Partial):** Contacts — name, email, phone, role, company, notes. *Gap:* CVR, publisher info, legal name, splits links.
- **FR-ART-2 (Planned):** Artist metrics time-series (social/streaming) with scheduled fetch; today only a single snapshot exists.
- **FR-ART-3 (Planned):** Side/featured artist credits.

### 8.3 Catalog: releases, tracks, works
- **FR-REL-1 (Built):** Releases CRUD — title, artist, date, format, UPC/EAN, cover art, status (draft/scheduled/released/archived), delivery & exploitation status, computed `release_ready` + `release_missing`.
- **FR-TRK-1 (Built):** Tracks CRUD — position, version, ISRC, audio, duration, linked to a **work**; computed `track_ready`, `track_missing`, `clearance_pub`, `clearance_master`, `clearance_progress`.
- **FR-WRK-1 (Built):** Works — the stable recording identity (ISRC/ISWC/audio) that survives across releases. Every track auto-backed by a work (a track with no work can never clear).
- **FR-CAT-2 (Planned):** Per-bucket release budgets (Marketing / A&R / Digital / Publicity, budget vs actual) surfaced on the release view; catalog number; focus track; "why blocked"; artist events.
- **FR-CAT-3 (Planned, deferred):** Split `works` into Master (recording) vs Composition entities — only when one composition maps to multiple masters (covers, re-records). Currently a deliberate non-split (see tech spec §4.4).

### 8.4 Rights & clearance — *the differentiator*
- **FR-CLR-1 (Built):** Rights/credit lines (`roles`) per work — contact, role, ownership_type (Rights | Credit), scope (Publishing | Master | Mechanical), % share, clearance status (Signed | Confirmed | Pending | Unknown).
- **FR-CLR-2 (Built):** Clearance computed per scope, status-weighted (Signed 1.0 / Confirmed 0.75 / Pending 0.25 / Unknown 0). Credit lines excluded from math. Mechanical rolls into Publishing. A scope with zero rights lines is "not applicable" and does not block. Overall = **min of applicable scopes** (the weakest universe wins).
- **FR-CLR-3 (Partial):** "Entered vs confirmed" fidelity — Airtable tracked an entered value separate from a confirmed value per share. Current model encodes this via status weighting; evaluate whether explicit entered/confirmed columns are needed for the Manager view.

### 8.5 Readiness & validation engine
- **FR-RDY-1 (Built):** Track Ready = ISRC present AND audio present AND clearance complete (all applicable scopes). Release Ready = all tracks ready AND artwork AND UPC AND date.
- **FR-RDY-2 (Built):** Validation sweep — idempotent, upserts issues by `bug_key`. Rules: missing audio → P0, missing ISRC → P1, release missing UPC → P1, missing date → P2, role with share but no scope → P2.
- **FR-RDY-3 (Built):** Bug inbox — triage queue (logged → triaged → in_progress → done), auto + manual, dedup'd.
- **FR-RDY-4 (Planned):** Scheduled/triggered sweep (cron or post-write hook) rather than manual `/api/sweep` only.

### 8.6 Daily cockpit ("Today Hub")
- **FR-TDY-1 (Built):** Three-column cockpit — upcoming calls, blocked releases, open bugs — each card drills to detail. P0-reliable, never `#ERROR!`.
- **FR-TDY-2 (Partial):** Ops tasks layer (owner, due date, overdue) — schema exists (`ops_tasks`); surface it in the cockpit as the general to-do plane distinct from bugs/calls.
- **FR-TDY-3 (Built):** Release pipeline dashboard (draft → scheduled → released) + KPI cards.

### 8.7 Money
- **FR-MNY-1 (Partial):** `royalties_revenue` table exists (statement period, source, gross/costs/net, paid_out, payment date/method). Flat; not yet a pipeline.
- **FR-MNY-2 (Planned):** Royalty **ingestion** — importers for DSP/distributor statements (AWAL first) → normalized earnings → per-work/release/artist attribution.
- **FR-MNY-3 (Planned):** **Statements & balances** — period close, computed running balances per payee (the IC core).
- **FR-MNY-4 (Planned):** **Payouts** — record payouts and settle balances (record, not initiate — same boundary IC draws).
- **FR-MNY-5 (Planned):** Budget rollups per release and category feeding the dashboard.

### 8.8 Promo & marketing
- **FR-CMP-1 (Built):** Campaigns — type, linked release/artist, dates, status, owner, goal, budget planned/actual, KPI summary, performance rating, platform.
- **FR-RAD-1 (Built):** Radio stations CRM + campaign↔station join with per-station status.

### 8.9 Assets, documents, ops
- **FR-AST-1 (Built):** Media assets — type, linked artist/release, version, approval status, delivery status, file link.
- **FR-DOC-1 (Built):** Documents — contracts/legal per release/artist/contact, type, status, file link.
- **FR-OPS-1 (Built schema):** Ops tasks — status, priority, owner, due date, overdue, next action, links.

### 8.10 Funding (the local moat)
- **FR-GRT-1 (Planned):** Grants/funding bodies + applications pipeline (KODA Elitepulje, Statens Kunstfond, ROSA, MXD), with deadlines, amounts, status, linked project. Strong differentiator for the Nordic/EU indie market IC doesn't serve.

### 8.11 Payee portal (transparency = the IC parity play)
- **FR-PRT-1 (Planned, SaaS):** Invite payees → read-only portal showing their releases, statements, balances, and payout history. This is the single feature IC's customers cite most ("transparency, not a black box"). Matching it neutralizes IC's strongest sales line.

### 8.12 Data migration
- **FR-MIG-1 (Partial):** One-time import of Airtable v3 (`seed_airtable.py`) — contacts, artists, releases, tracks, works, roles, budgets, calls, pitches. Do NOT port Airtable's automation-scaffolding tables (Implementation Log, RUNS, Schema Snapshots, auto-bug) — code replaces those.

---

## 9. The differentiating engine (product-level spec)

This is what makes Label Suite defensible. Engineering detail lives in the tech spec; here is the product contract:

- A release the system says is **Ready** is *legally and operationally safe to ship*. That promise is the product. Everything else is table stakes.
- "Ready" is only as trustworthy as the rights model. Therefore clearance must distinguish **Publishing** from **Master** universes and never average them into a single misleadingly-green number. A work at 100% publishing / 0% master is **not cleared**.
- Every blocker is **actionable**: the missing string names the deficient scope and percentage ("Master clearance 50%"), not just "not ready."
- The engine is **self-healing and idempotent** — running validation can only converge the issue list, never duplicate or corrupt it.

---

## 10. Non-functional requirements

- **NFR-PERF:** SSR page loads feel instant; islands hydrate only where needed. Cockpit interactions < 200ms perceived.
- **NFR-MOBILE:** Every page usable at 375px; tables degrade to cards; sidebar → drawer.
- **NFR-INTEGRITY:** FK constraints enforced; deletes cascade correctly (no orphaned children / opaque 500s); all writes transactional.
- **NFR-SEC:** Secrets out of git; auth server-side; (SaaS) tenant isolation enforced at the query layer, verified by tests.
- **NFR-A11Y:** Radix/shadcn accessible primitives; keyboard-navigable; sufficient contrast.
- **NFR-OBS:** `/api/health` liveness; structured logs; (SaaS) error tracking + audit log of mutations.
- **NFR-BACKUP:** Postgres backups + tested restore; migration discipline (every schema change is a Drizzle migration in git).

---

## 11. SaaS productization requirements (internal tool → product)

The app today is **single-tenant**: one label's data in one `label_suite` schema, one set of users. To sell it, the following are required (detailed design in tech spec §7):

1. **Multi-tenancy** — `org_id` on every domain row + enforced isolation (recommended: shared schema + row scoping + RLS). No cross-tenant read paths.
2. **Org & membership model** — orgs, memberships, roles, invitations.
3. **Self-serve onboarding** — signup → create org → optional Airtable/CSV import → seeded defaults (ISRC prefix, budget categories).
4. **Billing & subscriptions** — Stripe; plan/limits enforcement. Decide pricing model (§12).
5. **Payee portal** — scoped read-only access for non-staff (FR-PRT-1).
6. **Royalty ingestion pipeline** — importers + statements + balances + payouts (FR-MNY-2..4) to reach IC parity.
7. **Background jobs** — scheduled sweeps, metrics fetch, importer runs.
8. **Admin & support** — impersonation-safe support access, audit log, usage metrics.

---

## 12. Pricing (open decision)

IC prices on **monthly revenue added** (sliding scale, unlimited everything, revenue-tier billing). That model deliberately ties their price to customer cashflow and removes per-seat/per-release friction.

Options to evaluate:
- **Mirror IC** (revenue-tier) — competes head-on on their terms; risky as the challenger.
- **Flat per-label tiers** (by roster size / releases / features) — predictable; favored for an ops tool where value isn't only royalty volume.
- **Free ops core + paid money/portal layer** — land on operations (where IC is absent), expand into royalties.
- **Self-hosted/open-core** — differentiator IC can't match; community + paid cloud.

**Recommendation to decide before public beta:** lead with flat tiers anchored on the *operations* value (which IC doesn't price for at all), keep the royalty/payee layer in higher tiers. Revisit once design-partner data exists.

---

## 13. Success metrics

**North star:** *Releases shipped through Label Suite that passed the readiness gate with zero post-release clearance corrections.* (Directly measures the core promise.)

Supporting:
- **Activation:** % of new orgs that import/seed data and create a first release within 7 days.
- **Engagement:** Weekly active operators; Today-Hub opens/week.
- **Trust:** Clearance corrections required *after* a release was marked Ready (target → 0).
- **Money parity:** % of orgs running at least one royalty statement through the tool.
- **Retention:** Logo + revenue retention; orgs that migrate fully off Airtable/IC.
- **Switching:** Orgs that name IC or Airtable as the thing Label Suite replaced.

---

## 14. Release plan / milestones

| Milestone | Goal | Exit criteria |
|---|---|---|
| **M0 — Internal trustworthy (now)** | True Nature runs daily on it | Airtable v3 migrated in; clearance pub/master correct; cockpit P0-reliable; budgets bucketed on release view |
| **M1 — Design partners** | 3–5 friendly labels using it | Multi-tenancy + org model + invites; onboarding wizard; per-tenant isolation tested; ops-tasks in cockpit |
| **M2 — Money parity** | Match IC's core | Royalty importers (AWAL) → statements → balances → payouts; payee portal read-only |
| **M3 — Public beta** | Self-serve signup + billing | Stripe billing; pricing live; funding/grants pipeline; support/admin + audit log |
| **M4 — Differentiators** | Pull ahead of IC | Artist metrics history + fetch; campaigns/radio depth; reporting cadence; self-hosted/open-core option |

---

## 15. Risks & open questions

- **R1 — Money is hard and IC is great at it.** Royalty ingestion/statements are a deep domain; under-build and we look like a toy, over-invest early and we delay the wedge. *Mitigation:* lead with ops (M1) where IC is absent; treat money as M2 parity, not the opening move.
- **R2 — Multi-tenancy retrofit.** Single-tenant assumptions are baked into queries today. *Mitigation:* introduce `org_id` + RLS before any external user (M1), with isolation tests.
- **R3 — Clearance correctness is the brand.** A single false "Ready" undermines the whole pitch. *Mitigation:* unit-test the engine exhaustively; the pub/master min-rule is non-negotiable.
- **R4 — Scope sprawl.** 20+ domains already modeled. *Mitigation:* this PRD's status legend gates what's "must work" vs "exists but parked."
- **OQ-1:** Pricing model (§12) — decide before M3.
- **OQ-2:** Entered-vs-confirmed — explicit columns or keep status-weighting? (§8.4)
- **OQ-3:** Self-hosted/open-core as a tier — when, and what's the cloud/paid boundary?
- **OQ-4:** Tenancy approach — shared-schema + RLS vs schema-per-tenant (tech spec §7.1 recommends the former; confirm).

---

## 16. Appendix — glossary

- **Work** — the stable recording identity (a master + its composition), carrying ISRC/ISWC; survives across releases. Clearance lives here.
- **Role / Rights line** — an atomic credit or rights row on a work (contact, scope, % share, status).
- **Clearance universe** — Publishing (incl. Mechanical) vs Master; a work clears only when every *applicable* universe reaches 100% status-weighted.
- **Readiness gate** — computed boolean + human-readable missing string at track and release level.
- **Validation sweep** — idempotent pass that upserts blocking issues into the bug inbox by `bug_key`.
- **Today Hub** — the daily operations cockpit.
- **Payee** — an artist/collaborator owed money; gets read-only portal access (planned).
