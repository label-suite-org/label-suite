# Label Suite — Technical Specification

> Historical/reference document. Current product hierarchy lives in
> `docs/product/label-suite-product-map.md`; current execution state lives in GitHub Issues.

| | |
|---|---|
| **Product** | Label Suite |
| **Repo** | `malthelm/label-suite` |
| **Status** | Reflects current `main` + target SaaS evolution |
| **Companion doc** | `label-suite-PRD.md` |
| **Audience** | Implementing developer / agent |

> This spec consolidates the current built state (which has moved past `SPEC.md` and `GAP_ANALYSIS.md`) and defines the architecture to take the single-tenant internal tool to a multi-tenant SaaS. Where the repo already documents a decision, this references it rather than restating it (`SPEC.md` §Rejected Alternatives, `dossier.md` §Decisions, `AGENT_HANDOFF_*.md`).

---

## 1. System overview

Label Suite is an Astro server-SSR application with React islands for interactivity, talking to a self-hosted Supabase Postgres via Drizzle ORM, authenticated by Better Auth, deployed as a Node standalone server behind Caddy and a Cloudflare Tunnel.

```
                         Cloudflare Tunnel
                                │
                          ┌─────▼─────┐
                          │   Caddy   │  reverse proxy + TLS
                          └─────┬─────┘
                                │  localhost:4321
                   ┌────────────▼─────────────┐
                   │  Astro 7 (output:server) │
                   │  Node standalone adapter │
                   │                          │
                   │  ┌────────────────────┐  │
                   │  │ .astro pages (SSR) │  │  ← per-request render
                   │  ├────────────────────┤  │
                   │  │ React 19 islands   │  │  ← forms, tables, dashboards
                   │  ├────────────────────┤  │
                   │  │ /api/* endpoints   │  │  ← JSON CRUD + sweep + health
                   │  ├────────────────────┤  │
                   │  │ middleware.ts      │  │  ← auth route protection
                   │  └─────────┬──────────┘  │
                   └────────────┼─────────────┘
                                │ Drizzle ORM (pg)
                   ┌────────────▼─────────────┐
                   │ Supabase Postgres (Winona)│
                   │ schema: label_suite       │
                   └───────────────────────────┘
```

**Deploy target:** Dokploy on the self-hosted production host. GitHub Actions verifies merged GitHub work; Dokploy's GitHub App auto-deploys `main` through Compose → Traefik routes `suite.truenature.online` → container `:4321`. Health includes the exact checkout-derived revision.

---

## 2. Stack

| Layer | Choice | Version | Notes |
|---|---|---|---|
| Framework | Astro | ^7.0 | `output: 'server'`, `@astrojs/node` standalone |
| UI runtime | React | 19 | islands via `@astrojs/react` |
| Components | shadcn/ui on `@base-ui/react` | — | owned/copied components in `src/components/ui` |
| Styling | Tailwind | 4 | `@tailwindcss/vite`; Geist variable font |
| Auth | Better Auth | ^1.6 | Drizzle adapter → Postgres; email/password + magic link |
| ORM | Drizzle | ^0.45 | `drizzle-kit` migrations in `/drizzle` |
| DB | Postgres (Supabase, self-hosted) | — | dedicated `label_suite` pgSchema |
| DB driver | `pg` / `postgres` | — | — |
| Icons | lucide-react | — | — |

Stack rationale is settled in `SPEC.md` (why server mode, why Better Auth over Supabase Auth/GoTrue, why shadcn, why Drizzle over Prisma) and `dossier.md` decisions D-01..D-06. Do not relitigate without cause.

---

## 3. Repository layout (current)

```
src/
  components/         React islands, grouped by domain (artists/, releases/, tracks/,
                      roles/, royalties/, campaigns/, radio-stations/, media-assets/,
                      documents/, ops-tasks/, budget/, contacts/, pitches/, dashboard/, auth/)
    ui/               shadcn primitives (button, card, table, dialog, sidebar, sheet…)
    AppShell.tsx      sidebar + topbar shell
    BugInbox.tsx      validation/bug triage
  db/
    schema.ts         Drizzle schema — the label_suite domain (single source of truth)
    auth-schema.ts    Better Auth tables
  lib/
    db.ts             Drizzle client
    auth.ts           Better Auth server instance
    auth-client.ts    Better Auth React client
    readiness.ts      clearance + readiness + sweep engine (the core)
    isrc.ts           ISRC auto-generation
    seed.ts           dev seed
    seed_airtable.py  one-time Airtable v3 migration
    utils.ts
  pages/
    *.astro           SSR pages (dashboard, today, releases, artists, works, budget…)
    api/*.ts          JSON endpoints (one per domain) + auth/[...all], sweep, health
  middleware.ts       route protection
  layouts/            AppLayout.astro, Layout.astro
drizzle/              SQL migrations + meta snapshots (0000–0005)
```

---

## 4. Data model

All domain tables live in the `label_suite` pgSchema (isolation from the host Postgres's `public`). Primary keys are application-generated `text` ids. Timestamps default `now()`.

### 4.1 Entity map

```
contacts ──┐
           ├─< artists ──┐
           │             ├─< releases ──< tracks >── works ──< roles >── contacts
           │             │       │                     │
           │             │       ├─< budget_line_items >── budget_categories
           │             │       ├─< dsp_pitches
           │             │       ├─< calls >── contacts
           │             │       ├─< media_assets
           │             │       ├─< documents
           │             │       ├─< side_artists
           │             │       └─< campaigns ──< campaign_stations >── radio_stations
           │             └─< ops_tasks
           └─< royalties_revenue
isrc_sequences (per-year counter)      bugs (auto + manual, dedup by bug_key)
```

### 4.2 Core tables (the readiness spine)

- **`works`** — stable recording identity: `title, isrc, iswc, audio_url, duration, genre`. Clearance is computed *here* (via `roles`), then propagated to tracks.
- **`tracks`** — `release_id`, `work_id`, `position`, `version`, `isrc`, `audio_url`, plus **computed/cached** columns: `track_ready`, `track_missing`, `clearance_pub`, `clearance_master`, `clearance_progress`.
- **`releases`** — catalog/lifecycle fields + computed `release_ready`, `release_missing`; `status ∈ {draft, scheduled, released, archived}`; `delivery_status`, `exploitation_scope`.
- **`roles`** — atomic rights/credit line on a work: `contact_id`, `role`, `ownership_type ∈ {Rights, Credit}`, `scope ∈ {Publishing, Master, Mechanical}`, `percent_share` (0–100), `clearance_status ∈ {Signed, Confirmed, Pending, Unknown}`, `reviewed_by`.

### 4.3 Supporting tables (all present in `schema.ts`)

`contacts, artists, budget_categories, budget_line_items, calls, dsp_pitches, bugs, isrc_sequences, campaigns, radio_stations, campaign_stations, media_assets, documents, side_artists, royalties_revenue, ops_tasks`.

`royalties_revenue` and `ops_tasks` exist but are **flat / not yet surfaced** (see PRD §8.6–8.7). `royalties_revenue` is currently a record store, not an ingestion → statement → balance pipeline.

### 4.4 Key invariants & decisions

- **Every track has a work.** A `work_id = null` track can never clear and silently never goes Ready — `POST /api/tracks` must always link or create a work (per `AGENT_HANDOFF_4`).
- **Works are NOT split into Master/Composition** (deliberate, `AGENT_HANDOFF_6`). The Publishing/Master split is achieved entirely through `roles.scope`. Defer the split until one composition maps to multiple masters (covers/re-records). Splitting later is a table-add + FK-rewrite + track migration.
- **Computed columns are caches.** `clearance_*` / `*_ready` / `*_missing` are written by the engine, not by hand. Read paths trust the cache; the sweep keeps it honest.
- **Deletes must cascade** — DELETE handlers must clean FK children or they throw opaque 500s (`AGENT_HANDOFF_3`). Enforce at the DB (`on delete cascade`) and/or handler level; prefer DB constraints.

### 4.5 Migration discipline

Every schema change is a `drizzle-kit` migration committed under `/drizzle` with its meta snapshot. Never hand-edit the live DB. Migrations 0000–0005 are the current baseline.

---

## 5. The readiness & clearance engine (`src/lib/readiness.ts`)

This is the product's defensible core. Treat it as pure, exhaustively-tested logic.

### 5.1 Clearance computation — `computeClearanceProgress(workId): WorkClearance`

```ts
interface ScopeClearance {
  enteredTotal: number;   // Σ percent_share over Rights lines in scope
  weightedTotal: number;  // Σ percent_share × statusWeight
  progress: number;       // weightedTotal / 100  (0..1, may exceed 1 if overallocated)
  cleared: boolean;       // progress >= 1.0
}
interface WorkClearance {
  pub: ScopeClearance;    // Publishing universe (Mechanical folded in)
  master: ScopeClearance; // Master universe
  overall: number;        // MIN of applicable scopes' progress
  cleared: boolean;       // ALL applicable scopes cleared
}
```

**Rules (authoritative):**
1. `ownership_type = 'Credit'` lines are **excluded** from all clearance math (credit-only).
2. `Mechanical` scope **rolls into Publishing**.
3. Status weights: `Signed 1.0, Confirmed 0.75, Pending 0.25, Unknown 0`.
4. `progress = weightedTotal / 100` (not `/ enteredTotal`) — a scope clears only when shares sum to ~100% **and** all carry high-confidence status.
5. A scope with **zero Rights lines is "not applicable"** → does not block (treated as cleared).
6. `overall = min(applicable scopes' progress)` — the weakest universe defines the badge.
7. `cleared = every applicable scope cleared`; if there are **zero Rights lines anywhere**, `cleared = false`.
8. Round progress to 4 dp in computation; display rounds to integer %.

### 5.2 Persistence split (avoid recompute on read)

- `persistClearanceProgress(workId)` → computes from `roles`, writes `tracks.clearance_pub / clearance_master / clearance_progress` for tracks on that work.
- `persistTrackReadiness(trackId)` → reads the **stored** clearance columns, applies the readiness gate, writes `track_ready` + `track_missing`.
- Release readiness aggregates track readiness + release-level fields, writes `release_ready` + `release_missing`.

Write order on any roles/track/release mutation: clearance → track readiness → release readiness → (optionally) sweep.

### 5.3 Readiness gates

- **Track Ready** = ISRC present AND audio present AND clearance complete (all applicable scopes).
- **Release Ready** = all tracks ready AND artwork AND UPC AND release_date.
- Missing strings name the deficient scope: `Publishing clearance 80%`, `Master clearance 50%`, `Clearance required — no rights entered` (work has only Credit lines).

### 5.4 Validation sweep (idempotent self-healing)

- Endpoint: `POST /api/sweep`. Walks the catalog, upserts blocking issues into `bugs` keyed by **`bug_key`** (unique) → re-running converges, never duplicates.
- Rule → priority: missing audio `P0`, missing ISRC `P1`, release missing UPC `P1`, release missing date `P2`, role with share but no scope `P2`.
- **Planned:** trigger the sweep on write (post-mutation hook) and/or on a schedule, not only manually.

---

## 6. API surface

One JSON endpoint per domain under `src/pages/api/`: `artists, releases, tracks, contacts, roles, royalties, campaigns, radio-stations, media-assets, documents, ops-tasks, dsp-pitches, budget-items, bugs` + `sweep`, `health`, `auth/[...all]`. All `prerender = false`.

**Conventions to standardize (current gaps):**
- **Validation:** introduce a shared input-validation layer (e.g. Zod) at each handler boundary; today handlers trust the body.
- **Errors:** uniform error envelope `{ error: { code, message } }` + correct status codes; never leak raw PG errors.
- **Pagination/filtering:** list endpoints need `limit/offset` (or cursor) + server-side filter/sort before the dataset grows.
- **Mutations recompute:** every write that touches rights/tracks/releases must run the §5.2 recompute chain before responding.
- **Idempotency:** writes that the sweep also produces (e.g. bugs) must respect `bug_key`.

---

## 7. Single-tenant → multi-tenant SaaS (the major evolution)

The app today assumes **one label**. Everything below is required before any external customer touches it.

### 7.1 Tenancy model — *recommended: shared schema + `org_id` + Postgres RLS*

| Approach | Verdict |
|---|---|
| **Shared schema, `org_id` column + RLS** | ✅ **Recommended.** Simplest ops, one migration set, scales to thousands of small orgs. RLS is the backstop against query bugs. |
| Schema-per-tenant | ✗ Migration/ops overhead explodes with tenant count; reserve only for a future enterprise/self-host tier. |
| DB-per-tenant | ✗ Only for self-hosted single-customer installs (which the open-core path already covers). |

**Implementation:**
1. Add `org_id text not null references orgs(id)` to **every** domain table; backfill the existing data to a single "True Nature" org.
2. Add a Drizzle query helper that *requires* an `orgId` and injects `where org_id = :orgId` on every read/write — make it impossible to query a domain table without scoping.
3. Enable Postgres **RLS** on every `label_suite` table with a policy keyed to a session GUC (`app.current_org`) set per request from the authenticated session. RLS is the defense-in-depth net under the application-level scoping.
4. Add **isolation tests**: a user in org A must never read/write org B rows via any endpoint.

### 7.2 Org & membership

New tables (in `label_suite` or an `app` schema):
- `orgs (id, name, slug, plan, created_at)`
- `memberships (id, org_id, user_id, role)` — `role ∈ {owner, operator, member, payee}`
- `invitations (id, org_id, email, role, token, expires_at, accepted_at)`

Better Auth handles users/sessions; orgs/memberships sit alongside. Middleware resolves the active org from the session (and a workspace switcher for multi-org users) and sets `app.current_org`.

### 7.3 Roles & permissions

Server-side enforcement (never trust the client):
- **owner** — full + billing + members.
- **operator** — full domain CRUD, no billing/members.
- **member** — scoped CRUD (configurable).
- **payee** — read-only portal surface (§7.6) only; no access to domain admin.

### 7.4 Billing

- **Stripe** subscriptions; webhook → `orgs.plan` + entitlement flags. Gate features/limits server-side.
- Pricing model is a product decision (PRD §12) — build the entitlement layer model-agnostic (a `plan → limits/features` map) so the pricing choice is config, not a rewrite.

### 7.5 Royalty ingestion pipeline (IC parity — replaces flat `royalties_revenue`)

```
distributor/DSP statement (CSV/XLSX, AWAL first)
        │  importer (per-source adapter, normalize columns)
        ▼
raw_earnings (line-level: source, period, isrc/upc, units, gross, currency)
        │  attribution (match isrc/upc → work/track/release/artist)
        ▼
earnings (normalized, attributed)
        │  period close + split application (roles → payee shares)
        ▼
statements + statement_lines (per payee, per period)
        │
        ▼
balances (running per payee) ──► payouts (record, settle — do NOT initiate funds)
```

- **Importers** are per-source adapters with a common normalized output; "build importers on demand" is exactly IC's promise — match it.
- Splits for *payout* reuse the same `roles` data as clearance, but the payout split set may differ from the clearance set (e.g. label share). Keep payout splits as their own resolved view, derived from roles + release/label terms.
- Payouts are **recorded, not initiated** (same legal boundary IC draws).

### 7.6 Payee portal

- A separate, **read-only** surface (own layout, payee role) showing the payee's releases, statements, balances, payout history.
- Scoped hard by `org_id` + `payee` membership; never exposes domain admin or other payees' data.
- This is the feature IC customers cite most ("transparency, not a black box") — parity here neutralizes IC's strongest pitch.

### 7.7 Background jobs

A job runner (e.g. a small queue + worker, or pg-based cron) for: scheduled validation sweeps, artist-metrics fetch (Spotify/Soundcharts → `artist_metrics` history), importer runs, statement generation. Today everything is request-driven; importers and metrics history require async.

### 7.8 Observability & admin

- Structured logs + error tracking (e.g. Sentry).
- **Audit log** of mutations (who/what/when/org) — needed for trust and support.
- Support access that respects tenant isolation (no raw cross-tenant queries).

---

## 8. Non-functional engineering requirements

- **Security:** production secrets in Dokploy environment variables, never in git or GitHub Actions; RLS enabled pre-launch; auth + permission checks server-side; CSRF/session hardening per Better Auth guidance.
- **Data integrity:** FK cascades correct (§4.4); all multi-write operations transactional; computed caches reconciled by the sweep.
- **Performance:** SSR + islands; add list pagination + indexes (`org_id`, FKs, `release_date`, `bug_key`) before data grows.
- **Backups:** automated Postgres dumps + a tested restore runbook.
- **CI gate:** `npx astro check` (0 errors) + `npm run build` must pass before deploy; engine unit tests in CI.

---

## 9. Build sequencing (maps to PRD milestones)

**M0 — Internal trustworthy (finish now)**
- Finish `seed_airtable.py` migration of v3 (contacts, artists, releases, tracks, works, roles, budgets, calls, pitches).
- Surface per-bucket release budgets (budget vs actual) on the release view.
- Surface `ops_tasks` in the Today Hub.
- Engine unit tests covering every clearance rule in §5.1; scheduled/triggered sweep.

**M1 — Multi-tenant (before any external user)**
- `orgs` / `memberships` / `invitations`; backfill existing data to one org.
- `org_id` on all tables + query-helper scoping + RLS + isolation tests.
- Onboarding wizard (create org → import/seed → defaults).
- Roles/permissions enforced server-side.

**M2 — Money parity**
- Ingestion pipeline §7.5 (AWAL importer first) → statements → balances → payouts.
- Payee portal §7.6.

**M3 — Public beta**
- Stripe billing + entitlements; pricing live.
- Grants/funding pipeline (`projects`, `grants`, `applications`).
- Audit log + error tracking + support tooling.

**M4 — Differentiators**
- Artist metrics history + scheduled fetch; campaigns/radio depth; reporting cadence; self-hosted/open-core packaging.

---

## 10. Open technical questions

- **OQ-T1 — Tenancy:** confirm shared-schema + RLS (§7.1) vs schema-per-tenant. *Recommendation: shared + RLS.*
- **OQ-T2 — Works split:** keep single `works` (status quo) until a covers/re-record requirement forces Master/Composition split (§4.4).
- **OQ-T3 — Entered vs confirmed:** explicit columns on `roles`, or keep status-weighting as the encoding? (PRD §8.4)
- **OQ-T4 — Sweep trigger:** post-write hooks vs scheduled vs both; idempotency makes both safe.
- **OQ-T5 — Job runner:** lightweight pg-cron vs a real queue (BullMQ/pg-boss) — driven by importer/metrics volume.
- **OQ-T6 — Validation lib:** standardize on Zod at API boundaries (recommended) and share types with Drizzle.
- **OQ-T7 — Self-hosted tier:** does open-core change the tenancy model for that tier (DB-per-customer)? Decide before M4.

---

## 11. Pointers to existing in-repo docs

- `SPEC.md` — original phased implementation plan + rejected alternatives (Next.js, GoTrue, Clerk, Prisma, static-only, SPA).
- `dossier.md` — decisions log D-01..D-06, domain model, v2 lessons.
- `GAP_ANALYSIS.md` — SaaS vs Airtable v3 table-by-table mapping (note: schema has since advanced past several "Missing" rows).
- `AGENT_HANDOFF_3..6.md` — delete cascades, works/track auto-link + ISRC, publishing/master clearance split.
- `CLAUDE.md` / `AGENTS.md` — agent working conventions (background dev server, etc.).
