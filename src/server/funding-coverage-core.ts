/**
 * Unified funding coverage — the single computation of how funded a project is.
 *
 * Every surface (Budget, Grants & funding, dashboard) must derive its
 * confirmed / pipeline / gap numbers from this module so they always agree.
 *
 * The model, per project:
 *   budgetTotal      = project.total_planned, falling back to the sum of budget lines
 *   confirmed        = confirmed funding sources + awarded applications not yet
 *                      represented by a confirmed source
 *   pipelineWeighted = open applications weighted by workflow stage, plus pending
 *                      funding sources (not represented by an application) weighted
 *                      by source status
 *   gap              = budgetTotal − confirmed            (the hard gap)
 *   expectedGap      = budgetTotal − confirmed − pipelineWeighted
 *
 * Double-count protection: an application linked to a funding source via
 * funding_source_id "owns" that source — the source row is skipped whenever the
 * linked application is counted (either as confirmed or as pipeline).
 */

export type CoverageWorkflowStage =
  | "idea"
  | "research"
  | "writing"
  | "ready_to_submit"
  | "submitted"
  | "decision_pending"
  | "reporting"
  | "closed";

/**
 * Probability that an application at this stage converts into money.
 * Standard grant-pipeline weighting (prospect ~10%, submitted ~50%, awarded 100%).
 * `reporting` means the grant was awarded and is being reported on, so it is
 * handled by the confirmed path, not the pipeline path.
 */
export const APPLICATION_STAGE_WEIGHTS: Record<CoverageWorkflowStage, number> = {
  idea: 0.05,
  research: 0.1,
  writing: 0.25,
  ready_to_submit: 0.35,
  submitted: 0.5,
  decision_pending: 0.5,
  reporting: 1,
  closed: 0,
};

/** Probability weights for funding sources that have no linked application. */
export const SOURCE_STATUS_WEIGHTS: Record<string, number> = {
  research: 0.15,
  pending: 0.5,
  applied: 0.5,
};
const DEFAULT_SOURCE_WEIGHT = 0.5;

export type CoverageProjectRow = {
  id: string;
  currency?: string | null;
  total_planned?: number | string | null;
};

export type CoverageBudgetLineRow = {
  project_id: string | null;
  planned_amount?: number | string | null;
  amount?: number | string | null;
};

export type CoverageFundingSourceRow = {
  id: string;
  project_id: string | null;
  status?: string | null;
  amount_confirmed?: number | string | null;
  amount_planned?: number | string | null;
};

export type CoverageApplicationRow = {
  currency?: string | null;
  project_id?: string | null;
  funding_source_id?: string | null;
  workflow_stage?: string | null;
  outcome?: string | null;
  amount_requested?: number | string | null;
  amount_awarded?: number | string | null;
};

export type ProjectFundingCoverage = {
  projectId: string;
  currency: string;
  /** Planned project cost the funding has to cover. */
  budgetTotal: number;
  /** Money that is certain: confirmed sources + awarded applications. */
  confirmed: number;
  /** Sum of nominal amounts still in play (unweighted). */
  pipelineNominal: number;
  /** Probability-weighted expected value of the open pipeline. */
  pipelineWeighted: number;
  /** budgetTotal − confirmed, floored at 0. The number to close. */
  gap: number;
  /** budgetTotal − confirmed − pipelineWeighted, floored at 0. */
  expectedGap: number;
  /** confirmed / budgetTotal as 0–100, clamped. */
  confirmedPercent: number;
  /** pipelineWeighted / budgetTotal as 0–100, clamped so confirmed + pipeline ≤ 100. */
  pipelinePercent: number;
  openApplicationCount: number;
  pendingSourceCount: number;
  /** Confirmed sources or awarded applications that contribute to `confirmed`. */
  confirmedRecordCount?: number;
  excludedCurrencyCount?: number;
};

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function stageWeight(stage: string | null | undefined): number {
  return APPLICATION_STAGE_WEIGHTS[(stage ?? "") as CoverageWorkflowStage] ?? 0;
}

function isAwardedOutcome(outcome: string | null | undefined): boolean {
  return outcome === "approved" || outcome === "partially_approved";
}

function isOpenApplication(row: CoverageApplicationRow): boolean {
  const outcome = row.outcome ?? "unknown";
  const stage = row.workflow_stage ?? "idea";
  return outcome === "unknown" && stage !== "closed" && stage !== "reporting";
}

export function computeProjectCoverage(
  project: CoverageProjectRow,
  budgetLines: CoverageBudgetLineRow[],
  fundingSources: CoverageFundingSourceRow[],
  applications: CoverageApplicationRow[],
): ProjectFundingCoverage {
  const lines = budgetLines.filter((line) => line.project_id === project.id);
  const sources = fundingSources.filter((source) => source.project_id === project.id);
  const projectApplications = applications.filter((application) => application.project_id === project.id);

  const lineTotal = lines.reduce((sum, line) => sum + toNumber(line.planned_amount ?? line.amount), 0);
  const budgetTotal = toNumber(project.total_planned) || lineTotal;

  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const ownedSourceIds = new Set<string>();

  let confirmed = 0;
  let pipelineNominal = 0;
  let pipelineWeighted = 0;
  let openApplicationCount = 0;
  let confirmedRecordCount = 0;
  let excludedCurrencyCount = 0;

  for (const application of projectApplications) {
    const linkedSource = application.funding_source_id ? sourcesById.get(application.funding_source_id) : undefined;
    const linkedSourceConfirmed = linkedSource ? String(linkedSource.status).toLowerCase() === "confirmed" : false;

    // Sources are entered in project currency. An award in another currency
    // cannot be added without an explicit project-currency allocation.
    const applicationCurrency = (application.currency ?? "DKK").toUpperCase();
    if (applicationCurrency !== (project.currency || "DKK").toUpperCase()) {
      if (linkedSourceConfirmed) continue;
      if (linkedSource) ownedSourceIds.add(linkedSource.id);
      if (isAwardedOutcome(application.outcome) || application.workflow_stage === "reporting" || isOpenApplication(application)) excludedCurrencyCount += 1;
      continue;
    }

    if (isAwardedOutcome(application.outcome) || application.workflow_stage === "reporting") {
      // Awarded money is confirmed. When a confirmed source already records it,
      // the source row governs; otherwise the award amount counts directly.
      if (linkedSourceConfirmed) continue;
      if (linkedSource) ownedSourceIds.add(linkedSource.id);
      confirmed += toNumber(application.amount_awarded);
      confirmedRecordCount += 1;
      continue;
    }

    if (isOpenApplication(application)) {
      if (linkedSource) ownedSourceIds.add(linkedSource.id);
      const requested = toNumber(application.amount_requested);
      if (requested > 0) {
        openApplicationCount += 1;
        pipelineNominal += requested;
        pipelineWeighted += requested * stageWeight(application.workflow_stage);
      }
    }
    // Rejected / withdrawn / not_qualified contribute nothing, but still own
    // their source so a stale pending source row cannot leak back in.
    if (!isOpenApplication(application) && !isAwardedOutcome(application.outcome) && linkedSource) {
      ownedSourceIds.add(linkedSource.id);
    }
  }

  let pendingSourceCount = 0;
  for (const source of sources) {
    if (ownedSourceIds.has(source.id)) continue;
    const status = String(source.status ?? "").toLowerCase();
    if (status === "confirmed" || status === "granted") {
      confirmed += toNumber(source.amount_confirmed) || toNumber(source.amount_planned);
      confirmedRecordCount += 1;
    } else if (status !== "rejected") {
      const planned = toNumber(source.amount_planned);
      if (planned > 0) {
        pendingSourceCount += 1;
        pipelineNominal += planned;
        pipelineWeighted += planned * (SOURCE_STATUS_WEIGHTS[status] ?? DEFAULT_SOURCE_WEIGHT);
      }
    }
  }

  const gap = Math.max(0, budgetTotal - confirmed);
  const expectedGap = Math.max(0, budgetTotal - confirmed - pipelineWeighted);
  const confirmedPercent = budgetTotal > 0 ? Math.min(100, Math.round((confirmed / budgetTotal) * 100)) : 0;
  const pipelinePercent = budgetTotal > 0
    ? Math.min(100 - confirmedPercent, Math.round((pipelineWeighted / budgetTotal) * 100))
    : 0;

  return {
    projectId: project.id,
    currency: project.currency || "DKK",
    budgetTotal,
    confirmed,
    pipelineNominal,
    pipelineWeighted,
    gap,
    expectedGap,
    confirmedPercent,
    pipelinePercent,
    openApplicationCount,
    pendingSourceCount,
    confirmedRecordCount,
    excludedCurrencyCount,
  };
}

export function computeCoverageForProjects(
  projects: CoverageProjectRow[],
  budgetLines: CoverageBudgetLineRow[],
  fundingSources: CoverageFundingSourceRow[],
  applications: CoverageApplicationRow[],
): Map<string, ProjectFundingCoverage> {
  return new Map(projects.map((project) => [
    project.id,
    computeProjectCoverage(project, budgetLines, fundingSources, applications),
  ]));
}

export type CurrencyCoverageSummary = {
  currency: string;
  budgetTotal: number;
  confirmed: number;
  pipelineWeighted: number;
  gap: number;
  expectedGap: number;
  projectCount: number;
  confirmedRecordCount: number;
};

/** Org-level rollup, kept separate per currency — never sum across currencies. */
export function summarizeCoverageByCurrency(coverages: Iterable<ProjectFundingCoverage>): CurrencyCoverageSummary[] {
  const byCurrency = new Map<string, CurrencyCoverageSummary>();
  for (const coverage of coverages) {
    const entry = byCurrency.get(coverage.currency) ?? {
      currency: coverage.currency, budgetTotal: 0, confirmed: 0, pipelineWeighted: 0, gap: 0, expectedGap: 0,
      projectCount: 0, confirmedRecordCount: 0,
    };
    entry.budgetTotal += coverage.budgetTotal;
    entry.confirmed += coverage.confirmed;
    entry.pipelineWeighted += coverage.pipelineWeighted;
    entry.gap += coverage.gap;
    entry.expectedGap += coverage.expectedGap;
    entry.projectCount += 1;
    entry.confirmedRecordCount += coverage.confirmedRecordCount ?? 0;
    byCurrency.set(coverage.currency, entry);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
