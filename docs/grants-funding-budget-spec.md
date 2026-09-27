# Grants, Funding & Budget — Sharpening Spec

**Status:** Draft for implementation · **Owner:** Malthe · **Date:** 2026-07-14

**Goal:** Make the grants/funding/budget section of Label Suite razor-sharp to work in daily. One trustworthy money story across `/grants`, `/budget`, and the dashboard; a pipeline you can work from a single queue; and a closed loop from award to funder report.

---

## 1. Context

Label Suite runs an independent Danish label's operations. The funding reality it must model:

- Projects (album/EP/video campaigns) are funded from a **stack**: grants (Koda Kultur, Statens Kunstfond, DMF/Gramex pools, export funds), advances, partners, self-financing.
- Danish grant funders have **fixed deadline rounds** (e.g. Koda Udgivelsespuljen 17 Sep 2026 15:00), **eligibility rules** (ApS vs forening vs individual, commercial restrictions, co-financing requirements), and **mandatory spend reporting** after award.
- Amounts are mostly DKK 10k–125k per grant; a project is typically covered by 3–8 sources. Losing track of one deadline or one reporting due date has real cost.

The data model is already strong. The problem is **coherence**: the two halves (grants cockpit and budget department) compute overlapping numbers independently and don't close the loop.

---

## 2. Current state (as of commit `82d9659`)

### 2.1 Surfaces

| Surface | Entry | Main component | Server module |
|---|---|---|---|
| Grants cockpit | `/grants` | `src/components/grants/GrantsFundingCockpit.tsx` (5 tabs: Funding plan, Applications, Grants, Assets, Calendar & reporting) | `src/server/grants-workspace.ts` (`getGrantsWorkspace`) |
| Budget department | `/budget` | `src/components/budget/BudgetDepartment.tsx` (KPI strip, bucket matrix, funding stack, line table, cashflow timeline, variance queue) | `src/server/budget-dashboard.ts`, `budget-mutations.ts`, endpoint `/api/budget-projects/[projectId]/dashboard` |

### 2.2 Data model (relevant tables in `src/db/schema.ts`)

- **Budget:** `budget_projects` → `budget_line_items` (planned/forecast/committed/paid, phase, spend_month, lock_status, eligibility_tag) → `budget_line_documents` (invoice/receipt/quote/contract links). `budget_line_variance_requests` implements an approval workflow.
- **Funding:** `funding_sources` (type, status, amount_planned/confirmed, restricted_to, plus its own grant lifecycle fields) + `funding_source_events` audit log.
- **Grants:** `grants` (catalog incl. `rules` JSON with ApS/forening eligibility, co-financing, playbook) → `grant_deadlines` (rounds with classification/timezone) → `grant_requirements` (per-grant checklist templates). `grant_applications` (workflow_stage, outcome, amounts, next_action, reporting_due) → `grant_application_requirements`, `grant_application_documents`, `grant_application_events`, `grant_application_calls`.
- **Bridges:** `funding_needs` (per project) ↔ `funding_need_budget_lines` (needs → budget lines) and `grant_application_funding_needs` (applications → needs, with requested/awarded per need). `project_funding_profiles` holds narrative/priority/owner per project.

### 2.3 Known problems

**P1 — Two competing money models.** `funding_sources` duplicates the grant lifecycle (`application_date`, `decision_date`, `grant_amount_received`, `grant_reporting_due`) that `grant_applications` also models. Two places can answer "how much is confirmed?" and they will diverge.

**P2 — Divergent computations of the same numbers.**
- Grants side (`buildGrantsWorkspacePayload`): `totalBudget = total_planned || Σ line planned`; `confirmed = Σ confirmed sources`; `pending = max(pending sources, open application requests)`; `gap = total − confirmed`.
- Budget side (`getBudgetKpi`): `total_planned = production + marketing buckets` (a different total!); `pending = Σ sources not confirmed/rejected` (includes `research`, unlike grants side); gap never shown; "confirmed % of target" uses `max(total_planned, baseline_funding)`.
- Contingency lines are double-represented in `getBucketRollup` (counted in production/marketing by category AND in the contingency bucket by `lock_status`).

**P3 — The live pipeline is currently invisible.** Commit `82d9659` filters the workspace to `isSubmittedDecision` rows only (submitted + decided) and hard-codes `workflowStage: "closed"`. Every open application (idea → decision_pending) is hidden, so the Applications tab is a history view, the stage filters are dead, and application-driven "pending funding" is always 0.

**P4 — Award → report loop is unfinished.** Awards don't flow anywhere: no wizard to allocate awarded money to needs/budget lines, no assembly of spend + receipts for funder reporting, even though `budget_line_documents` and the bridge tables contain all the raw material.

**P5 — UI/consistency debt.** `BudgetKpiStrip` hard-codes `$`/en-US while grants side formats DKK; `budget_line_items` has both `amount` (NOT NULL) and `planned_amount` (nullable) with unclear precedence (`planned_amount ?? amount` in some queries, `amount` in others); drawers/modals reload the whole page on save (`window.location.reload()`); no Estimated Final Cost or variance column in the line table.

---

## 3. Research: patterns to adopt

1. **One tracker, one truth** (Instrumentl). A single pipeline with explicit stages, exactly one assignee per next action, automatic deadline reminders on a cadence (2 weeks / 1 week / 2 days before, on the day, 2 days after), and post-award tasks auto-generated at award time. Five lifecycle stages: prospecting → pre-award prep → application → post-award compliance → reporting/renewal.
2. **Weighted pipeline** (fundraising/grant CRMs). Expected funding = requested × stage probability (prospect ~10%, submitted ~50%, awarded 100%), overridable per record. Turns "6 applications out" into a plannable number. Cold-application win rates run 10–20%, so nominal pipeline is misleading.
3. **Cost-report columns** (film production, the closest analog to release budgets). Plan → committed → paid → **estimated final cost (EFC)** → **variance vs plan**. Variance is the first column stakeholders read. The suite has the input columns but no EFC/variance rollup.

Sources: Instrumentl tracker & tasks docs (help.instrumentl.com), instrumentl.com/blog/grant-pipeline-management, resources.rework.com weighted-pipeline guide, saturation.io/blog/production-cost-report, kultur.koda.dk/en/grants, kunst.dk/for-ansoegere/soeg-tilskud.

---

## 4. Target money model (canonical semantics)

These rules define every money number, everywhere:

- **budgetTotal** (per project) = `budget_projects.total_planned`, falling back to Σ `budget_line_items.planned_amount ?? amount`.
- **confirmed** = Σ confirmed `funding_sources` (`amount_confirmed`, fallback `amount_planned`) **plus** awarded applications (`outcome ∈ {approved, partially_approved}` or `workflow_stage = reporting`) whose award is not already represented by a confirmed source.
- **weighted pipeline** = Σ open applications (`outcome = unknown`, stage ∉ {closed, reporting}) `amount_requested × stageWeight` **plus** Σ pending sources with no linked application `amount_planned × statusWeight`.
- **gap** = `max(0, budgetTotal − confirmed)` (the hard gap). **expectedGap** = `max(0, gap − weightedPipeline)`.
- **Double-count rule:** an application linked via `grant_applications.funding_source_id` *owns* that source. If the linked source is confirmed, the source's amount governs and the application contributes nothing; otherwise the application governs and the source row is skipped. A rejected/withdrawn application also suppresses its stale pending source.
- **Stage weights (defaults, config constant):** idea 0.05, research 0.10, writing 0.25, ready_to_submit 0.35, submitted 0.50, decision_pending 0.50. **Source-status weights:** research 0.15, pending/applied 0.50. Overridable later per record (out of scope for v1).
- **Currencies are never summed across.** Org rollups are per-currency lists.

---

## 5. Features (priority order)

### F1 — Unified coverage number

*One shared computation of budgetTotal / confirmed / weighted pipeline / gap, rendered identically everywhere.*

**Build:**
- `src/server/funding-coverage-core.ts` — pure, unit-tested implementation of §4. Input: plain project/line/source/application rows. Output per project: `{ budgetTotal, confirmed, pipelineNominal, pipelineWeighted, gap, expectedGap, confirmedPercent, pipelinePercent, currency, counts }`. Plus `summarizeCoverageByCurrency()` for org rollups.
- `src/server/funding-coverage.ts` — DB loaders `getFundingCoverage(orgId)` / `getProjectFundingCoverage(orgId, projectId)`.
- `src/components/funding/CoverageBar.tsx` — the single visual: solid segment = confirmed, striped = weighted pipeline, empty = gap; legend with amounts; `Intl.NumberFormat("da-DK", { style: "currency" })`.

**Integrate:**
- `/grants`: `buildGrantsWorkspacePayload` derives `confirmedFunding`/`pendingFunding` (= weighted)/`remainingGap`/`totalBudget` from the core. Project cards and the summary strip render `CoverageBar`. Label pipeline as "expected (weighted)", never "pending".
- `/budget`: dashboard endpoint returns `coverage`; KPI strip renders `CoverageBar` and uses project currency (kills the `$` hard-code).
- Dashboard/Today: org per-currency coverage summary (small, one line per currency).

**Acceptance criteria:**
- The same project shows byte-identical confirmed/pipeline/gap numbers on `/grants` and `/budget`.
- An awarded application with no funding source counts as confirmed; linking it to a confirmed source does not change the total (no double count).
- A 30k pending source with no application shows 15k weighted; an application in `writing` for 20k shows 5k.
- Zero-budget projects render without division-by-zero; over-funded projects clamp gap at 0.
- Unit tests cover: line-sum fallback, all dedupe permutations (awarded+confirmed source, open+pending source, rejected+pending source), weights, clamping, per-currency rollup.

> A reference implementation of F1 exists uncommitted in the working tree (`funding-coverage-core.ts` + tests + `CoverageBar.tsx` + integrations). Review, adopt, or discard.

### F2 — Working queue ("What needs doing")

*Collapse deadlines, next actions, missing materials, and reporting dues into one prioritized queue. This is the daily-use fix.*

**Precondition:** revert/scope the `isSubmittedDecision` filter (P3). Open applications must be visible again. Suggested: the Applications tab gets a "Pipeline | History" toggle — Pipeline = open applications with real stages; History = submitted+decided (current behavior).

**Build:**
- `src/server/grants-worklist.ts` — assemble queue items from existing data (no schema change):
  - `deadline`: open application `submission_deadline` and matched-grant round deadlines within N days
  - `action`: `next_action` + `next_action_due` on open applications
  - `materials`: requirement checklist rows with `readiness_status ∈ {missing, stale}` on applications in writing/ready_to_submit
  - `reporting`: `reporting_due` on awarded applications
  - `decision`: variance requests pending (budget side), funding sources in research/pending past their `deadline`
- Priority = f(days until due, application priority, amount at stake). Overdue floats to top, undated sinks to bottom.
- UI: new default view on `/grants` (before the tab bar or as first tab). Filters: "My actions" (owner = current user), horizon (7/30/90 days), project. Each row: what, for which application/project, due date, amount at stake, one-click jump to the drawer.
- Feed the Today hub (`/today`) with the top-N items.

**Acceptance criteria:**
- Every open application with a deadline or next action within 30 days appears exactly once per obligation.
- Reporting dues appear from award until marked done.
- Marking an action done from the queue updates `grant_applications` and writes a `grant_application_events` row.
- Queue renders in <100ms from the existing workspace payload (pure function, unit-tested with fixture dates).

### F3 — Money model cleanup

*Make `grant_applications` the single lifecycle record; reduce `funding_sources` to a money-in ledger.*

- Migration: for each `funding_sources` row of `type = 'grant'` with lifecycle data (`application_date`, `decision_date`, `grant_amount_received`, `grant_reporting_due`) and no linked application, create a `grant_applications` row (stage/outcome inferred from source status) and set `funding_source_id`. Idempotent, dry-run mode, follows the pattern in `scripts/airtable-import.ts`.
- Deprecate (stop reading/writing, then drop in a later migration): the four lifecycle columns on `funding_sources`.
- New invariant, enforced in `budget-mutations.ts`: when an application's outcome becomes approved/partially_approved, auto-create-or-update its linked funding source (`status = confirmed`, `amount_confirmed = amount_awarded`, name/funder from the grant) and write a `funding_source_events` row. The award wizard (F4) fronts this.
- `NewFundingSourceModal`: for `type = grant`, offer "track as application instead" linking to the application drawer.

**Acceptance criteria:** after migration, no grant lifecycle data lives only on `funding_sources`; awarding an application always produces exactly one confirmed source; coverage (F1) totals are unchanged by the migration (write a before/after assertion script).

### F4 — Award → funder report pack

*The payoff feature: from decision to finished funder report with receipts.*

**Award wizard** (on setting outcome = approved/partially_approved in `GrantApplicationDrawer`):
1. Record `amount_awarded`, `decision_date`, `reporting_due`.
2. Allocate the award across the application's `grant_application_funding_needs` (prefill proportional to `amount_requested`).
3. Cascade to budget lines via `funding_need_budget_lines`: set/update `budget_line_items.funding_source_id` for covered lines.
4. Create/confirm the funding source (F3 invariant).
5. Auto-create reporting task: `next_action = "Submit funder report"`, `next_action_due = reporting_due − 14 days`.

**Report pack** (new endpoint `/api/grant-applications/[id]/report-pack`):
- Collect all budget lines covered by the application's award (via needs → lines), their planned/committed/paid amounts, and linked `budget_line_documents` (invoices/receipts).
- Output: summary table (line, category, planned, actual, variance), document manifest with download URLs (`src/server/storage.ts` presigned flow), completeness warnings (paid lines without receipts, spend outside `restricted_to`).
- UI: "Reporting" panel in the application drawer showing spend-to-date vs award, receipt completeness, and an export button (JSON/CSV first; PDF via the existing export patterns later).

**Acceptance criteria:** an awarded 50k application allocated to 4 budget lines produces a report pack listing exactly those lines with their paid amounts and receipt links; a paid line without a receipt is flagged; the pack respects org scoping (`requireOrgId`) and upload-security rules.

### F5 — Budget table: EFC and variance

- Per line: `EFC = paid + committed + max(0, forecast − committed − paid)` (fallback: forecast, else planned). `variance = planned − EFC` (positive = under).
- Per bucket and project: same rollup; variance becomes the headline column in `BudgetLineTable` and `BudgetBucketMatrix`; negative variance styled as attention.
- Resolve P5 ambiguity: make `planned_amount` canonical (backfill from `amount` where null; treat `amount` as legacy, then drop). Fix the contingency double-count in `getBucketRollup` (exclude `lock_status = 'locked'` lines from production/marketing buckets or make contingency a category-based bucket — decide with data).
- Inline edit for forecast/committed/paid on unlocked lines (respect `lock_status` + variance-request workflow for locked ones).

**Acceptance criteria:** bucket totals equal line-sum totals under all lock states; a line with planned 10k, committed 4k, paid 3k, forecast 12k shows EFC 12k and variance −2k; budget health (`getBudgetKpi`) derives from EFC vs confirmed funding, not raw forecast.

---

## 6. Cross-cutting fixes

- Replace `window.location.reload()` on save in `GrantApplicationDrawer` / modals with targeted refetch (pattern already exists in `BudgetDepartment.refetch`).
- All money formatting through one helper (currency-aware, da-DK). Delete the `usd()` hard-code.
- Every mutation on applications/sources continues writing to the events tables — the queue and report pack depend on them.
- Keep tests colocated per repo convention (`*-core.ts` + `*-core.test.ts`, pure functions, `vi.mock("../lib/db")`).

## 7. Sequencing & estimates

| # | Feature | Est. | Depends on |
|---|---|---|---|
| 1 | F1 Unified coverage | 2–3 d | — |
| 2 | F2 Working queue (incl. history-filter fix) | 3–4 d | F1 payload |
| 3 | F3 Money model cleanup | 2–3 d (incl. migration) | F1 semantics |
| 4 | F4 Award → report pack | 4–5 d | F3 invariant |
| 5 | F5 EFC/variance | 2–3 d | independent, can parallel F2+ |

**Risks:** F3 migration touches imported Airtable data — run parity checks (`npm run airtable:grants:parity`) before/after. The P3 filter revert must not resurrect junk drafts imported as open applications — gate Pipeline view on `amount_requested > 0 OR next_action set` if needed. Weighted-pipeline numbers are estimates; always label them "expected", show nominal on hover, and never let them silently replace the hard gap.
