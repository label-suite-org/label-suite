import type { ProjectFundingCoverage } from "../../server/funding-coverage-core";

export type WorkflowStage =
  | "idea"
  | "research"
  | "writing"
  | "ready_to_submit"
  | "submitted"
  | "decision_pending"
  | "reporting"
  | "closed";

export type ApplicationOutcome =
  | "unknown"
  | "approved"
  | "partially_approved"
  | "rejected"
  | "withdrawn"
  | "not_qualified";

export type AssetReadiness = {
  ready: number;
  total: number;
  missing: number;
  stale: number;
};

export type FundingNeedView = {
  id: string;
  title: string;
  category: string;
  description: string | null;
  targetAmount: number;
  confirmedAmount: number;
  pendingAmount: number;
  remainingGap: number;
  eligibility: "grant_eligible" | "mixed" | "not_eligible" | "unknown";
  neededBy: string | null;
  reconciled: boolean;
  priority?: "low" | "medium" | "high" | "urgent";
  status?: "planned" | "active" | "funded" | "cancelled";
  successMeasure?: string | null;
};

export type WorkspaceContactChoice = { id: string; name: string };
export type WorkspaceMemberChoice = { id: string; name: string; role: string };

export type ApplicationFundingAllocationView = {
  id: string;
  fundingNeedId: string;
  amountRequested: number;
  amountAwarded: number;
};

export type ApplicationRequirementView = {
  id: string;
  requirementId: string | null;
  requirementName: string | null;
  assetRole: string | null;
  documentId: string | null;
  documentName: string | null;
  required: boolean;
  readinessStatus: string;
  notes: string | null;
};

export type GrantApplicationDocumentView = {
  id: string;
  documentId: string;
  name: string;
  fileLink: string | null;
  assetRole: string;
  linkType: string;
  required: boolean;
  readinessStatus: string;
  extractionStatus: string | null;
  extractionError: string | null;
  extractedTextPreview: string | null;
  extractionId: string | null;
  sourceHash: string | null;
};

export type GrantWritingGuideBlock = { title: string; source: string; content: string; status: "ready" | "pending" | "failed" | "empty" };

export type OpportunityMatchView = {
  opportunityId: string;
  name: string;
  funder: string | null;
  deadline: string | null;
  maxAmount: number | null;
  currency: string;
  reasons: string[];
  cautions: string[];
};

export type FundingProjectView = {
  id: string;
  name: string;
  status: string | null;
  priority: string | null;
  artistName: string | null;
  releaseTitle: string | null;
  ownerName: string | null;
  currency: string;
  totalBudget: number;
  confirmedFunding: number;
  pendingFunding: number;
  remainingGap: number;
  coverage?: ProjectFundingCoverage;
  targetDate: string | null;
  goal: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  needs: FundingNeedView[];
  applicationIds: string[];
  assetReadiness: AssetReadiness;
  topMatch: OpportunityMatchView | null;
  suggestedMatches?: OpportunityMatchView[];
};

export type GrantApplicationView = {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  opportunityId: string | null;
  opportunityName: string | null;
  ownerName: string | null;
  ownerUserId?: string | null;
  ownerContactId?: string | null;
  workspaceView?: "pipeline" | "history";
  workflowStage: WorkflowStage;
  outcome: ApplicationOutcome;
  priority: string | null;
  currency: string;
  amountRequested: number;
  amountAwarded: number;
  amountRequestedRecorded?: boolean;
  amountAwardedRecorded?: boolean;
  nextAction: string | null;
  nextActionDue: string | null;
  applicationDeadline: string | null;
  submittedAt: string | null;
  decisionDate: string | null;
  reportingDue: string | null;
  angleNarrative?: string | null;
  responseNotes?: string | null;
  evaluation?: string | null;
  nextStepRecommendation?: string | null;
  sourceFolder?: string | null;
  externalReference?: string | null;
  notes?: string | null;
  allocations?: ApplicationFundingAllocationView[];
  checklist?: ApplicationRequirementView[];
  documents?: GrantApplicationDocumentView[];
  writingGuide?: GrantWritingGuideBlock[];
  assetReadiness: AssetReadiness;
};

export function applicationWorkspaceView(application: Pick<GrantApplicationView, "workspaceView" | "workflowStage" | "outcome">): "pipeline" | "history" {
  if (application.workspaceView) return application.workspaceView;
  return application.outcome === "unknown" && application.workflowStage !== "closed" ? "pipeline" : "history";
}

export type GrantOpportunityView = {
  id: string;
  name: string;
  funder: string | null;
  program: string | null;
  purposes: string[];
  applicantType: string | null;
  status: string | null;
  researchStatus: string | null;
  researchSummary: string | null;
  deadline: string | null;
  opensOn: string | null;
  maxAmount: number | null;
  currency: string;
  requirements: string | null;
  officialUrl: string | null;
  lastVerifiedAt: string | null;
  matchReasons: string[];
  matchingProjectIds: string[];
  description?: string | null;
  researchUrl?: string | null;
  priority?: string | null;
  notes?: string | null;
  eligibleUses?: string | null;
  assessmentBody?: string | null;
  responseTiming?: string | null;
  rules?: string | null;
  researchSource?: string | null;
  deadlineRounds?: GrantDeadlineRoundView[];
};

export type GrantDeadlineRoundView = {
  id: string;
  date: string;
  label: string | null;
  classification: "confirmed" | "estimated" | "rolling" | string;
  sourceUrl: string | null;
  deadlineTime: string | null;
  timezone: string | null;
  opensOn: string | null;
  expectedResponseDate: string | null;
  status: string | null;
};

export type GrantPlaybookView = {
  preparationTimeline: string | null;
  requiredAssets: string[];
  commonTraps: string[];
  tips: string | null;
  owner: string | null;
};

export type GrantRulesView = {
  apsEligible: boolean | null;
  foreningEligible: boolean | null;
  individualEligible: boolean | null;
  commercialAllowed: boolean | null;
  revenueGeneratingAllowed: boolean | null;
  coFinancingRequired: boolean | null;
  selfFinancingRequired: boolean | null;
  inKindAccepted: boolean | null;
  paymentSchedule: string | null;
  paymentTiming: string | null;
  recurrenceType: string | null;
  recurrenceNotes: string | null;
  genreRestrictions: string | null;
  careerStage: string | null;
  geography: string | null;
  applicantRequirements: string | null;
  restrictions: string | null;
  assessmentCriteria: string | null;
  playbook: GrantPlaybookView | null;
};

const nullableBoolean = (value: unknown): boolean | null => typeof value === "boolean" ? value : null;
const nullableString = (value: unknown): string | null => typeof value === "string" && value.trim() ? value : null;
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];

export function parseGrantRules(raw: string | null | undefined): GrantRulesView | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const playbook = value.playbook && typeof value.playbook === "object" && !Array.isArray(value.playbook)
      ? value.playbook as Record<string, unknown>
      : null;
    return {
      apsEligible: nullableBoolean(value.aps_eligible),
      foreningEligible: nullableBoolean(value.forening_eligible),
      individualEligible: nullableBoolean(value.individual_eligible),
      commercialAllowed: nullableBoolean(value.commercial_allowed),
      revenueGeneratingAllowed: nullableBoolean(value.revenue_generating_allowed),
      coFinancingRequired: nullableBoolean(value.co_financing_required),
      selfFinancingRequired: nullableBoolean(value.self_financing_required),
      inKindAccepted: nullableBoolean(value.in_kind_accepted),
      paymentSchedule: nullableString(value.payment_schedule),
      paymentTiming: nullableString(value.payment_timing),
      recurrenceType: nullableString(value.recurrence_type),
      recurrenceNotes: nullableString(value.recurrence_notes),
      genreRestrictions: nullableString(value.genre_restrictions),
      careerStage: nullableString(value.career_stage),
      geography: nullableString(value.geography),
      applicantRequirements: nullableString(value.applicant_requirements),
      restrictions: nullableString(value.restrictions),
      assessmentCriteria: nullableString(value.assessment_criteria),
      playbook: playbook ? {
        preparationTimeline: nullableString(playbook.preparation_timeline),
        requiredAssets: stringList(playbook.required_assets),
        commonTraps: stringList(playbook.common_traps),
        tips: nullableString(playbook.tips),
        owner: nullableString(playbook.owner),
      } : null,
    };
  } catch {
    return null;
  }
}

export type GrantAssetView = {
  id: string;
  name: string;
  role: string;
  ownerName: string | null;
  projectName: string | null;
  readiness: "ready" | "missing" | "stale" | "draft";
  lastUpdatedAt: string | null;
  applicationNames: string[];
  href: string | null;
};

export type GrantCalendarEventView = {
  id: string;
  kind: "opening" | "deadline" | "action" | "submission" | "decision" | "reporting";
  title: string;
  context: string | null;
  date: string | null;
  status: string | null;
  href: string | null;
};

/**
 * Framework-agnostic, JSON-safe contract between the grants service and React.
 * Dates are ISO date strings and monetary values are numbers; no DB rows or Date
 * instances cross the Astro-to-React boundary.
 */
export type GrantsWorkspacePayload = {
  contacts?: WorkspaceContactChoice[];
  members?: WorkspaceMemberChoice[];
  projects: FundingProjectView[];
  applications: GrantApplicationView[];
  opportunities: GrantOpportunityView[];
  assets: GrantAssetView[];
  calendarEvents: GrantCalendarEventView[];
};

export type ApplicationFilter =
  | "all"
  | "my_actions"
  | "due_30"
  | "writing"
  | "ready_to_submit"
  | "decision_pending"
  | "reporting"
  | "closed";

export type ApplicationSort = "submitted_desc" | "decision_desc" | "deadline_asc";
export type ApplicationSortDateField = "submitted" | "decision" | "deadline";

const DAY_MS = 86_400_000;

/**
 * Adapts a funding project view (whose money fields are produced by the shared
 * coverage model on the server) into the shape CoverageBar renders.
 */
export function coverageFromProject(project: FundingProjectView): ProjectFundingCoverage {
  if (project.coverage) return project.coverage;
  const { confirmedPercent, pendingPercent } = getProjectProgress(project);
  return {
    projectId: project.id,
    currency: project.currency,
    budgetTotal: project.totalBudget,
    confirmed: project.confirmedFunding,
    pipelineNominal: project.pendingFunding,
    pipelineWeighted: project.pendingFunding,
    gap: project.remainingGap,
    expectedGap: Math.max(0, project.remainingGap - project.pendingFunding),
    confirmedPercent,
    pipelinePercent: Math.min(pendingPercent, 100 - confirmedPercent),
    openApplicationCount: 0,
    pendingSourceCount: 0,
  };
}

export function getProjectProgress(project: FundingProjectView) {
  if (project.totalBudget <= 0) return { confirmedPercent: 0, pendingPercent: 0 };
  return {
    confirmedPercent: Math.min(100, Math.round((project.confirmedFunding / project.totalBudget) * 100)),
    pendingPercent: Math.min(100, Math.round((project.pendingFunding / project.totalBudget) * 100)),
  };
}

export function getApplicationReadiness(application: GrantApplicationView): {
  label: string;
  tone: "ready" | "attention" | "empty";
} {
  const attention = application.assetReadiness.missing + application.assetReadiness.stale;
  if (attention > 0) return { label: `${attention} need attention`, tone: "attention" };
  if (application.assetReadiness.total === 0) return { label: "Checklist not set", tone: "empty" };
  return { label: "Materials ready", tone: "ready" };
}

export function applicationMatchesFilter(
  application: GrantApplicationView,
  filter: ApplicationFilter,
  today = new Date().toISOString().slice(0, 10),
  currentUserName: string | null = null,
): boolean {
  if (filter === "all") return true;
  if (filter === "my_actions") {
    const owner = application.ownerName?.trim().toLocaleLowerCase();
    const currentUser = currentUserName?.trim().toLocaleLowerCase();
    return Boolean(currentUser && owner === currentUser && application.nextAction && application.workflowStage !== "closed");
  }
  if (filter === "due_30") {
    const date = application.nextActionDue ?? application.applicationDeadline;
    if (!date) return false;
    const delta = new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime();
    return delta >= 0 && delta <= 30 * DAY_MS;
  }
  return application.workflowStage === filter;
}

function applicationSortDate(application: GrantApplicationView, field: ApplicationSortDateField): string | null {
  const value = field === "submitted"
    ? application.submittedAt
    : field === "decision"
      ? application.decisionDate
      : application.applicationDeadline;
  if (!value) return null;
  const date = value.slice(0, 10);
  const timestamp = new Date(`${date}T00:00:00`).getTime();
  return Number.isNaN(timestamp) ? null : date;
}

export function formatApplicationSortDate(application: GrantApplicationView, field: ApplicationSortDateField): string {
  const date = applicationSortDate(application, field);
  if (!date) return "Date not recorded";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

export function sortApplications(applications: GrantApplicationView[], sort: ApplicationSort): GrantApplicationView[] {
  const field: ApplicationSortDateField = sort === "submitted_desc" ? "submitted" : sort === "decision_desc" ? "decision" : "deadline";
  const direction = sort === "deadline_asc" ? 1 : -1;
  return applications
    .map((application, index) => ({ application, index, date: applicationSortDate(application, field) }))
    .sort((a, b) => {
      if (a.date === null && b.date === null) return a.index - b.index;
      if (a.date === null) return 1;
      if (b.date === null) return -1;
      const comparison = a.date.localeCompare(b.date);
      return comparison === 0 ? a.index - b.index : comparison * direction;
    })
    .map(({ application }) => application);
}

export function opportunityMatchesQuery(
  opportunity: GrantOpportunityView,
  query: string,
  projects: FundingProjectView[],
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const matchingProjectNames = projects
    .filter((project) => opportunity.matchingProjectIds.includes(project.id))
    .map((project) => project.name);
  return [
    opportunity.name,
    opportunity.funder,
    opportunity.program,
    opportunity.applicantType,
    ...opportunity.purposes,
    ...matchingProjectNames,
  ].some((value) => (value ?? "").toLowerCase().includes(normalized));
}

export function sortCalendarEvents(events: GrantCalendarEventView[]): GrantCalendarEventView[] {
  return [...events].sort((a, b) => (a.date ?? "9999-12-31").localeCompare(b.date ?? "9999-12-31"));
}

export function safeWorkspaceHref(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildWorkspaceSummary(workspace: GrantsWorkspacePayload, today = new Date().toISOString().slice(0, 10)) {
  const funding = new Map<string, { currency: string; confirmed: number; pending: number; gap: number }>();
  for (const project of workspace.projects) {
    const current = funding.get(project.currency) ?? {
      currency: project.currency,
      confirmed: 0,
      pending: 0,
      gap: 0,
    };
    current.confirmed += project.confirmedFunding;
    current.pending += project.pendingFunding;
    current.gap += project.remainingGap;
    funding.set(project.currency, current);
  }

  return {
    fundingByCurrency: [...funding.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    activeApplications: workspace.applications.filter((application) => application.workflowStage !== "closed").length,
    upcomingDeadlines: workspace.calendarEvents.filter((event) => event.kind === "deadline" && event.date && event.date.slice(0, 10) >= today).length,
    materialsNeedingAttention: workspace.applications.reduce(
      (total, application) => total + application.assetReadiness.missing + application.assetReadiness.stale,
      0,
    ),
  };
}

export function labelForStage(stage: WorkflowStage): string {
  const labels: Record<WorkflowStage, string> = {
    idea: "Idea",
    research: "Research",
    writing: "Writing",
    ready_to_submit: "Ready to submit",
    submitted: "Submitted",
    decision_pending: "Awaiting decision",
    reporting: "Reporting",
    closed: "Closed",
  };
  return labels[stage];
}

export function labelForOutcome(outcome: ApplicationOutcome): string {
  if (outcome === "unknown") return "No decision";
  if (outcome === "rejected") return "Declined";
  return outcome.split("_").map((word) => word[0]?.toUpperCase() + word.slice(1)).join(" ");
}
