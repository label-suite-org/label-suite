# Label Suite v3 — Spec & Implementation Plan

> Historical/reference document. Current product hierarchy lives in
> `docs/product/label-suite-product-map.md`; current execution state lives in GitHub Issues.

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Build a beautiful, production-grade SaaS for independent music label operations — replacing the Airtable-based v2 with a proper web application.

**Architecture:** Astro 7 hybrid SSR → shadcn/ui React islands → Supabase Postgres (Winona) → Caddy → Cloudflare Tunnel

**Tech Stack:** Astro 7, React 19, shadcn/ui, Tailwind 4, Better Auth, Drizzle ORM, TanStack Table, Supabase Postgres

---

## Design Philosophy

**Reference:** `seeds.apophenia.eu` (minimalist, mobile-first, tactile) × Linear/Vercel dashboard aesthetics (clean, fast, professional).

**Principles:**
- **Calm UI.** White/near-white backgrounds, generous whitespace, restrained color palette. Data is the hero, not the chrome.
- **Mobile-first.** Label work happens on the go — every page must be usable on a phone.
- **Progressive disclosure.** Start with the summary. Drill into detail on demand. Never show everything at once.
- **Speed is a feature.** Astro's zero-JS default + selective hydration = instant page loads. Only islands where interaction is essential.

---

## Architecture Overview

```
[Astro 7 Hybrid SSR]
├── Static pages: / (landing), /about, /pricing (pre-rendered)
├── SSR pages: /dashboard, /artists/*, /releases/*, /today (server-rendered per request)
├── React Islands: forms, data tables, interactive filters, charts
├── Better Auth: email/password + magic links, cookie-based sessions
├── Drizzle ORM → Supabase Postgres (Winona, label_suite schema)
└── Deploy: Node adapter → rsync → Winona Caddy → Cloudflare Tunnel
```

**Why server mode (not hybrid)?**
- Research confirmed: for a SaaS where most pages are dynamic (auth-gated, live data), `output: 'server'` is cleaner than `hybrid`
- Server mode: everything is SSR by default, opt INTO static with `prerender = true` on marketing pages only
- Hybrid would mean sprinkling `prerender = false` on every dashboard page — boilerplate
- SSR gives us: live data on every request, auth-gated routes, API endpoints, middleware
- Node adapter `mode: 'standalone'` → runs as Node HTTP server → Caddy reverse-proxies to it

**Why Better Auth over Supabase Auth?**
- Supabase Auth on self-hosted requires Kong (which we don't have)
- Better Auth is framework-agnostic, supports Astro natively, stores sessions in our Postgres
- We control the full auth flow — no dependency on Supabase's auth container
- Trade-off: we build our own auth UI. But shadcn/ui gives us the components.

**Why shadcn/ui?**
- Copy-paste components, not a library — we own the code
- Radix UI primitives = accessible by default
- Beautiful defaults that match Linear/Vercel aesthetic
- Data Table, Sidebar, Card, Form, Dialog — all the SaaS building blocks
- Works perfectly inside Astro React islands

---

## Phased Plan

### Phase 1: Foundation (SSR + Auth + Layout)

Switch from static to hybrid SSR. Add Better Auth. Build the app shell (sidebar + topbar).

### Phase 2: Core CRUD (Artists + Releases + Tracks)

Full CRUD for the domain model with shadcn data tables and forms.

### Phase 3: Readiness Engine (The Product's Heart)

Computed readiness, clearance tracking, validation sweep, auto-bugs.

### Phase 4: Today Hub + Dashboards

Daily cockpit, release pipeline view, budget tracking.

### Phase 5: Polish & Deploy

Design system refinement, dark mode, mobile optimization, production deploy.

---

## Phase 1: Foundation — SSR + Auth + Layout

### Task 1.1: Switch to server SSR mode

**Files:**
- Modify: `astro.config.mjs` — add `output: 'server'` + Node adapter
- Install: `@astrojs/node`

**Steps:**
1. `npm install @astrojs/node`
2. Update `astro.config.mjs`:
   ```js
   output: 'server',
   adapter: node({ mode: 'standalone' }),
   ```
3. Add `export const prerender = true` to landing page (`/`) — marketing stays static
4. All other pages default to SSR (no boilerplate needed)
5. Test: `npm run dev` → verify pages still load
6. Build: `npm run build` → verify `dist/server/entry.mjs` exists

### Task 1.2: Install shadcn/ui

**Files:**
- Modify: `tsconfig.json` — add path aliases
- Create: `src/components/ui/` (shadcn components land here)
- Create: `components.json` (shadcn config)

**Steps:**
1. `npx shadcn@latest init` (choose: React, Tailwind, default style)
2. Add path alias `@/*` → `src/*` in tsconfig
3. Install core components:
   `npx shadcn@latest add button card input label table dialog dropdown-menu sidebar badge separator sheet avatar tooltip`
4. Verify: import a `<Card>` in a test page, confirm it renders

### Task 1.3: Build the app shell (sidebar + topbar layout)

**Files:**
- Create: `src/layouts/AppLayout.astro` — sidebar + topbar wrapper
- Create: `src/components/Sidebar.tsx` — React island (shadcn Sidebar)
- Create: `src/components/Topbar.tsx` — React island (search + user menu)

**Design:**
- Left sidebar: Logo → nav (Dashboard, Artists, Releases, Today, Budget) → collapse toggle
- Topbar: Page title → search → user avatar dropdown
- Mobile: sidebar collapses to Sheet (slide-in drawer)
- Aesthetic: white bg, `border-r` divider, `text-neutral-500` nav items, `bg-neutral-900` active state

### Task 1.4: Better Auth setup

**Files:**
- Create: `src/lib/auth.ts` — Better Auth server instance (Drizzle adapter → Postgres)
- Create: `src/lib/auth-client.ts` — Better Auth React client
- Create: `src/pages/api/auth/[...all].ts` — auth handler
- Create: `src/middleware.ts` — route protection
- Modify: `src/db/schema.ts` — add `users`, `sessions` tables

**Steps:**
1. `npm install better-auth`
2. Configure Better Auth with Drizzle adapter pointing to our Postgres
3. Create auth tables in `label_suite` schema (users, sessions)
4. Set up middleware: redirect to `/login` if not authenticated on `/dashboard/*`
5. Enable email/password + magic link auth
6. Test: create a user, sign in, verify session cookie

### Task 1.5: Auth pages (login + signup)

**Files:**
- Create: `src/pages/login.astro` — login form (React island)
- Create: `src/pages/signup.astro` — signup form (React island)
- Create: `src/components/auth/LoginForm.tsx`
- Create: `src/components/auth/SignupForm.tsx`

**Design:**
- Centered card on neutral background (like Linear's login)
- Email + password fields with shadcn Input
- "Send magic link" alternative
- No navbar/sidebar — standalone auth layout

---

## Phase 2: Core CRUD — Artists + Releases + Tracks

### Task 2.1: Artists list + detail

**Files:**
- Modify: `src/pages/artists/index.astro` — SSR data fetch, shadcn DataTable island
- Create: `src/pages/artists/[id].astro` — artist detail page
- Create: `src/components/artists/ArtistTable.tsx` — TanStack Table with sorting, filtering
- Create: `src/components/artists/ArtistForm.tsx` — create/edit form (Dialog)

**Features:**
- List: sortable columns (name, followers, PRO, releases count), search filter, row click → detail
- Detail: artist info card + releases list + tracks list + roles list
- Form: name, bio, Spotify ID, PRO, IPI, Instagram, TikTok

### Task 2.2: Releases list + detail

**Files:**
- Modify: `src/pages/releases/index.astro` — SSR + DataTable
- Create: `src/pages/releases/[id].astro` — release detail with readiness checklist
- Create: `src/components/releases/ReleaseTable.tsx`
- Create: `src/components/releases/ReleaseForm.tsx`
- Create: `src/components/releases/ReadinessChecklist.tsx` — visual gate status

**Features:**
- List: title, artist, date, status badge, readiness badge, clearance %
- Detail: readiness checklist (art, ISRC, audio, clearance, UPC, date) + tracks list + budget summary
- Form: title, artist (select), date, format, UPC, cover art URL

### Task 2.3: Tracks + Works management

**Files:**
- Create: `src/pages/releases/[id]/tracks.astro` — tracks for a release
- Create: `src/components/tracks/TrackTable.tsx`
- Create: `src/components/tracks/TrackForm.tsx`
- Create: `src/components/tracks/WorkSelector.tsx` — link track to existing or new work

**Features:**
- Track list per release with position, version, ISRC, audio status, clearance %
- Add track → select existing work or create new
- Auto-generate ISRC on track creation (uses `lib/isrc.ts`)

---

## Phase 3: Readiness Engine

### Task 3.1: Readiness computation

**Files:**
- Create: `src/lib/readiness.ts` — pure functions computing readiness gates
- Create: `src/lib/clearance.ts` — clearance progress calculation from roles

**Logic (from v2, but in code not Airtable formulas):**
- Track Ready = ISRC present AND audio present AND clearance_progress = 1.0
- Release Ready = all tracks ready AND artwork AND UPC AND release_date
- Clearance Progress = sum(weighted_shares) / sum(total_shares) per scope
- Each gate produces: boolean (machine) + human-readable missing string

### Task 3.2: Roles (Credit) management

**Files:**
- Create: `src/pages/works/[id].astro` — work detail with roles
- Create: `src/components/roles/RoleTable.tsx`
- Create: `src/components/roles/RoleForm.tsx`

**Features:**
- Roles per work: contact, role, ownership_type, scope, % share, clearance_status
- Clearance status: Signed (1.0) / Confirmed (0.75) / Pending (0.25) / Unknown (0)
- Visual: progress bar per scope (Publishing, Master)

### Task 3.3: Validation sweep (auto-bugs)

**Files:**
- Create: `src/lib/validation.ts` — sweep function (idempotent, upsert by bug_key)
- Create: `src/pages/api/sweep.ts` — API endpoint to trigger sweep
- Create: `src/components/BugInbox.tsx` — bug triage inbox

**Rules:**
- Track missing ISRC → P1 bug
- Track missing audio → P0 bug
- Role with % but no scope → P2 bug
- Release missing UPC → P1 bug
- Release missing date → P2 bug
- All bugs use `bug_key` for idempotent upsert (no duplicates, ever)

---

## Phase 4: Today Hub + Dashboards

### Task 4.1: Today Hub (daily cockpit)

**Files:**
- Modify: `src/pages/today.astro` — full SSR dashboard
- Create: `src/components/today/CallList.tsx`
- Create: `src/components/today/BlockedReleases.tsx`
- Create: `src/components/today/BugInbox.tsx`

**Layout:**
- 3-column grid on desktop, stacked on mobile
- Column 1: Upcoming calls (sorted by time)
- Column 2: Blocked releases (not ready, sorted by date)
- Column 3: Open bugs (sorted by priority)
- Each card: click → drill to detail page

### Task 4.2: Release pipeline dashboard

**Files:**
- Create: `src/pages/dashboard.astro` — overview dashboard
- Create: `src/components/dashboard/ReleasePipeline.tsx` — kanban-style board
- Create: `src/components/dashboard/StatsCards.tsx` — KPI cards

**Features:**
- KPI cards: total artists, releases in pipeline, ready releases, open bugs
- Pipeline: Draft → Scheduled → Released (column view, like Trello)
- Budget summary: total spent, by category

### Task 4.3: Budget tracking

**Files:**
- Create: `src/pages/budget.astro` — budget overview
- Create: `src/components/budget/BudgetTable.tsx`
- Create: `src/components/budget/BudgetForm.tsx`

**Features:**
- Line items per release with category, amount, status
- Rollup totals per release and per category
- Simple. No charts needed yet.

---

## Phase 5: Polish & Deploy

### Task 5.1: Design system refinement

- Define CSS custom properties for color tokens (neutral palette + accent)
- Typography: Inter or system font, clear hierarchy (h1-h4, body, caption)
- Spacing system: 4px base, consistent scale
- Dark mode: `prefers-color-scheme` with shadcn's dark theme
- Micro-interactions: hover states, transitions, loading states

### Task 5.2: Mobile optimization

- Test every page on 375px viewport
- Sidebar → Sheet drawer on mobile
- Tables → card view on small screens
- Forms → full-width, stacked, touch-friendly inputs

### Task 5.3: Production deploy

- Switch Astro to `server` output mode with Node adapter
- Deploy: PM2 or systemd service on Winona running `node dist/server/entry.mjs`
- Caddy: reverse proxy `label-suite.truenature.online` → `localhost:4321`
- Environment: `.env` on Winona with production Supabase URL
- Health check: `GET /api/health` → `{ status: "ok" }`

---

## Rejected Alternatives

| Option | Rejected because |
|---|---|
| **Next.js** | Overkill SSR complexity, React Server Components confusion, heavier bundle |
| **Supabase Auth (GoTrue)** | Self-hosted requires Kong gateway we don't have; auth container config is fragile |
| **Clerk** | External dependency, vendor lock-in, not self-hosted |
| **Prisma ORM** | Heavier than Drizzle, codegen overhead, slower startup |
| **LaunchFast / supastarter** | Paid starter kits — we have the pieces already, and we want full ownership |
| **Static-only mode** | Requires rebuild for every data change — not viable for a SaaS |
| **Full SPA (React Router)** | Loses Astro's performance benefits, SEO, and content-first approach |
