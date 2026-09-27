> Retained technical/historical reference. Current public candidate and production
> boundaries are defined in `PUBLIC_SOURCE.md`; this document does not authorize deployment.

# Label Suite v3 — Project Dossier

> Historical architecture record. The current production delivery contract is
> `origin/main` -> GitHub Actions verification -> Dokploy GitHub App auto-deploy
> and is documented in
> `docs/runbooks/label-suite-deploy.md`.

**Created:** 2026-06-24
**Status:** Initializing
**Stack:** Astro 5 + React islands + Supabase (Winona) + Drizzle ORM + Tailwind

---

## Decisions

| # | Decision | Chosen | Rejected |
|---|---|---|---|
| D-01 | Data storage | Supabase (self-hosted, Winona) — already running, full Postgres + auto-API + auth | Supabase cloud (managed overhead, data off-site); Airtable (fragile, #ERROR! issues) |
| D-02 | Frontend interactivity | SPA-lignende React islands — React på alle interaktive views for responsiv UX | Server-rendered only (for statisk til et data-tungt system) |
| D-03 | Repo structure | Ét Astro-projekt med embedded DB-schema — enkelt, alt versionsstyret sammen | Monorepo med separat backend (overkill til nuværende scope) |
| D-04 | Framework | Astro 5 — island architecture, zero JS default, file-based routing | Next.js (for tungt, unødvendig SSR-kompleksitet); Remix (mindre modent økosystem) |
| D-05 | ORM | Drizzle ORM — type-safe, letvægts, SQL-like | Prisma (tungere, generator overhead); raw SQL (ingen type-safety) |
| D-06 | CSS | Tailwind CSS — allerede kendt, hurtig iteration | CSS Modules, styled-components |

---

## Architecture

```
[label-suite] Astro 5 SSR (Node adapter)
├── Pages (file-based routing, .astro)
├── React Islands (interactive views: dashboards, forms, filters)
├── Drizzle ORM → Supabase Postgres (Winona)
├── Supabase Auth (email/password, magic links)
└── Deploy → Winona (rsync via studio-deploy-loop)
```

---

## Domain Model (from v2 — proven)

```
Contacts ──┐
Artists ───┤
           ├──→ Releases ──→ Tracks ──→ WORKS ──→ Roles (Credit)
           │       │                        │
           │   Budget Line Items        ISRC (auto-generated)
           │   DSP Pitches
           │   Calls
           └──→ Bugs (auto + manual)
```

**Key invariants:**
- Release readiness is COMPUTED, not manual
- WORKS is the stable recording identity (survives across releases)
- Roles are atomic credit/rights lines
- Every computed gate has both boolean (machine) AND human-readable missing string

---

## V1 Scope

| Feature | Status |
|---|---|
| Release dashboard med computed readiness | ✅ V1 |
| Artist → Release → Track → WORKS → Roles CRUD | ✅ V1 |
| Clearance tracking + computed progress | ✅ V1 |
| "Today Hub" (calls, deadlines, blockers) | ✅ V1 |
| ISRC auto-generation | ✅ V1 |
| Budget tracking | ✅ V1 |
| DSP Pitches | ⏸️ V2 |
| Publisher/PRO registration | ⏸️ V2 |
| Artist login/portal | ⏸️ V2 |

---

## Lessons from v2

1. **Forretningslogik skal bo i kode, ikke i Airtable-formler** — testbart, versions-kontrolleret
2. **Auto-bugs skal være idempotente** — upsert via unik Bug Key fra dag 1
3. **"Today Hub" skal være P0-pålidelig** — ingen formler der kan give #ERROR!
4. **ISRC skal auto-genereres** — undgå metadatagæld
5. **Database, ikke spreadsheet** — transaktioner, constraints, migrations

---

## Links

- GitHub: `malthelm/label-suite` (to be created)
- Supabase: Winona (existing instance)
- Deploy target: `label-suite.truenature.online`
- Inspiration: `seeds.apophenia.eu` (Astro, minimalist, mobile-first)
