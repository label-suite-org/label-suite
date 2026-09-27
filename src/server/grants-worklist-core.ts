export type WorklistKind = "deadline" | "action" | "materials" | "reporting" | "decision";

export type WorklistApplication = {
  id: string;
  name: string;
  projectId: string | null;
  projectName: string | null;
  ownerName: string | null;
  currency?: string;
  workflowStage: string;
  outcome: string;
  priority: string | null;
  amountRequested: number;
  amountAwarded: number;
  applicationDeadline: string | null;
  nextAction: string | null;
  nextActionDue: string | null;
  reportingDue: string | null;
  checklist?: Array<{
    id: string;
    requirementName: string | null;
    readinessStatus: string;
    required?: boolean;
  }>;
};

export type GrantsWorklistInput = {
  applications: WorklistApplication[];
  varianceRequests?: Array<{ id: string; lineName: string; projectId: string | null; projectName: string | null; amountAtStake?: number; currency?: string; priority?: string | null }>;
  fundingSources?: Array<{ id: string; name: string; projectId: string | null; projectName: string | null; status: string | null; deadline: string | null; amountPlanned: number; currency?: string; priority?: string | null }>;
  today?: string;
  horizonDays?: number;
};

export type GrantsWorklistItem = {
  id: string;
  kind: WorklistKind;
  title: string;
  detail: string;
  dueDate: string | null;
  amountAtStake: number;
  applicationId: string | null;
  projectId: string | null;
  projectName: string | null;
  ownerName: string | null;
  currency: string;
  priority: string | null;
  href: string;
};

const OPEN_STAGES = new Set(["idea", "research", "writing", "ready_to_submit", "submitted", "decision_pending"]);
const DECIDED_OUTCOMES = new Set(["approved", "partially_approved"]);
const PRIORITY_SCORE: Record<string, number> = { urgent: 4, high: 3, medium: 2, low: 1 };
const DAY_MS = 86_400_000;

function dateOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  const result = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

function isOpenApplication(application: WorklistApplication): boolean {
  return application.outcome === "unknown" && OPEN_STAGES.has(application.workflowStage);
}

function isReportingApplication(application: WorklistApplication): boolean {
  return DECIDED_OUTCOMES.has(application.outcome) && Boolean(dateOnly(application.reportingDue));
}

function item(
  application: WorklistApplication,
  kind: WorklistKind,
  title: string,
  detail: string,
  dueDate: string | null,
  amountAtStake = application.amountRequested,
  suffix: string = kind,
): GrantsWorklistItem {
  return {
    id: `${kind}:${application.id}:${suffix}`,
    kind,
    title,
    detail,
    dueDate,
    amountAtStake,
    applicationId: application.id,
    projectId: application.projectId,
    projectName: application.projectName,
    ownerName: application.ownerName,
    currency: application.currency ?? "DKK",
    priority: application.priority,
    href: `/grants?application=${encodeURIComponent(application.id)}`,
  };
}

export function buildGrantsWorklist({ applications, varianceRequests, fundingSources, today = new Date().toISOString().slice(0, 10), horizonDays = 30 }: GrantsWorklistInput): GrantsWorklistItem[] {
  const normalizedToday = dateOnly(today) ?? new Date().toISOString().slice(0, 10);
  const items: GrantsWorklistItem[] = [];

  for (const application of applications) {
    const open = isOpenApplication(application);
    if (open) {
      const deadline = dateOnly(application.applicationDeadline);
      if (deadline && daysUntil(deadline, normalizedToday) <= horizonDays) {
        items.push(item(application, "deadline", `${application.name} deadline`, "Application deadline", deadline));
      }

      if (application.nextAction) {
        items.push(item(application, "action", application.nextAction, "Next owned action", dateOnly(application.nextActionDue)));
      }

      if (["writing", "ready_to_submit"].includes(application.workflowStage)) {
        for (const requirement of application.checklist ?? []) {
          if (requirement.required === false || !["missing", "stale"].includes(requirement.readinessStatus)) continue;
          items.push(item(
            application,
            "materials",
            requirement.requirementName ?? "Application material",
            requirement.readinessStatus === "stale" ? "Material is stale" : "Material is missing",
            null,
            application.amountRequested,
            requirement.id,
          ));
        }
      }
    }

    if (isReportingApplication(application)) {
      const reportingDue = dateOnly(application.reportingDue);
      if (reportingDue && daysUntil(reportingDue, normalizedToday) <= horizonDays) {
        items.push(item(application, "reporting", "Submit funder report", "Award reporting obligation", reportingDue, application.amountAwarded || application.amountRequested));
      }
    }
  }

  for (const request of varianceRequests ?? []) {
    items.push({
      id: `decision:variance:${request.id}`,
      kind: "decision",
      title: `Approve variance: ${request.lineName}`,
      detail: "Budget variance request is pending",
      dueDate: null,
      amountAtStake: request.amountAtStake ?? 0,
      applicationId: null,
      projectId: request.projectId,
      projectName: request.projectName,
      ownerName: null,
      currency: request.currency ?? "DKK",
      priority: request.priority ?? "high",
      href: "/budget",
    });
  }

  for (const source of fundingSources ?? []) {
    const status = String(source.status ?? "").toLowerCase();
    const deadline = dateOnly(source.deadline);
    if (!deadline || !["research", "pending"].includes(status) || daysUntil(deadline, normalizedToday) >= 0) continue;
    items.push({
      id: `decision:source:${source.id}`,
      kind: "decision",
      title: `Review overdue funding source: ${source.name}`,
      detail: `${status} funding source deadline passed`,
      dueDate: deadline,
      amountAtStake: source.amountPlanned,
      applicationId: null,
      projectId: source.projectId,
      projectName: source.projectName,
      ownerName: null,
      currency: source.currency ?? "DKK",
      priority: source.priority ?? "high",
      href: "/budget",
    });
  }

  return items.sort((a, b) => {
    const aDays = a.dueDate ? daysUntil(a.dueDate, normalizedToday) : Number.POSITIVE_INFINITY;
    const bDays = b.dueDate ? daysUntil(b.dueDate, normalizedToday) : Number.POSITIVE_INFINITY;
    if (aDays !== bDays) return aDays - bDays;
    const priorityDelta = (PRIORITY_SCORE[b.priority ?? ""] ?? 0) - (PRIORITY_SCORE[a.priority ?? ""] ?? 0);
    if (priorityDelta !== 0) return priorityDelta;
    if (b.amountAtStake !== a.amountAtStake) return b.amountAtStake - a.amountAtStake;
    return a.id.localeCompare(b.id);
  });
}
