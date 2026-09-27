import { createHash } from "node:crypto";
import { PermanentSyncError } from "./errors.js";
import { escapeHtml } from "./managed-html.js";
import type {
  DesiredProjection,
  GitHubIssueState,
  Milestone,
  MilestoneInput,
  ModuleName,
  PlaneStateName,
  ProjectionInput,
  ProjectionSignal,
} from "./types.js";

const EXTERNAL_SOURCE = "label-suite-github-plane-sync" as const;

export const moduleLabelMap = new Map<string, ModuleName>([
  ["plane:module/product-confidence-delivery", "Product Confidence & Delivery"],
  ["plane:module/analytics-forecasting", "Analytics & Forecasting"],
  ["plane:module/artists-releases-rights", "Artists, Releases & Rights"],
  ["plane:module/directory-campaigns", "Directory & Campaigns"],
  ["plane:module/events-tasks-search", "Events, Tasks & Search"],
  ["plane:module/content-assets-budgets", "Content, Assets & Budgets"],
]);

export interface ProjectionComment {
  html: string;
  externalId: string;
}

type StatusLabel = "status:backlog" | "status:todo" | "status:in-progress" | "status:review" | "status:blocked";
type PriorityLabel = "priority:low" | "priority:medium" | "priority:high";

interface IssueMapping {
  issue: GitHubIssueState;
  status: StatusLabel | null;
  priority: PriorityLabel | null;
  moduleName: ModuleName | null;
  isClosed: boolean;
}

const statusLabels = new Set<StatusLabel>([
  "status:backlog",
  "status:todo",
  "status:in-progress",
  "status:review",
  "status:blocked",
]);
const priorityLabels = new Set<PriorityLabel>(["priority:low", "priority:medium", "priority:high"]);
const priorityByLabel: Readonly<Record<PriorityLabel, "low" | "medium" | "high">> = {
  "priority:low": "low",
  "priority:medium": "medium",
  "priority:high": "high",
};
const milestoneSummary: Readonly<Record<Exclude<MilestoneInput["transition"], null>, string>> = {
  work_started: "Work entered active status",
  pr_opened: "Pull request opened",
  ready_for_review: "Pull request is ready for review",
  review_submitted: "Review submitted",
  pr_merged: "Pull request merged",
  pr_closed: "Pull request closed",
  issue_closed: "Issue closed",
  issue_reopened: "Issue reopened",
  issue_cancelled: "Issue cancelled",
  reconciliation_repair: "Reconciliation repaired a missed state transition",
};

function exactlyOne<T>(values: T[], code: string): T | null {
  if (values.length > 1) throw new PermanentSyncError(code);
  return values[0] ?? null;
}

function mappingForIssue(issue: GitHubIssueState): IssueMapping {
  const status = exactlyOne(
    issue.labels.filter((label): label is StatusLabel => statusLabels.has(label as StatusLabel)),
    "projection_status_labels_conflict",
  );
  const priority = exactlyOne(
    issue.labels.filter((label): label is PriorityLabel => priorityLabels.has(label as PriorityLabel)),
    "projection_priority_labels_conflict",
  );
  const moduleName = exactlyOne(
    issue.labels.flatMap((label) => {
      const moduleName = moduleLabelMap.get(label);
      return moduleName ? [moduleName] : [];
    }),
    "projection_module_labels_conflict",
  );

  return { issue, status, priority, moduleName, isClosed: issue.state === "CLOSED" };
}

function stateForClosedIssues(issues: IssueMapping[]): PlaneStateName {
  return issues.every(({ issue }) => issue.stateReason === "NOT_PLANNED") ? "Cancelled" : "Done";
}

function stateForOpenIssues(issues: IssueMapping[], hasOpenLinkedPullRequest: boolean): PlaneStateName {
  if (issues.some(({ status }) => status === "status:review")) return "In Progress";
  if (issues.some(({ status }) => status === "status:in-progress") || hasOpenLinkedPullRequest) return "In Progress";
  if (issues.some(({ status }) => status === "status:blocked")) return "Todo";
  if (issues.some(({ status }) => status === "status:todo")) return "Todo";
  if (issues.some(({ status }) => status === "status:backlog")) return "Backlog";
  return "Todo";
}

function issueState(issues: IssueMapping[], hasOpenLinkedPullRequest: boolean): PlaneStateName {
  if (issues.every(({ isClosed }) => isClosed)) return stateForClosedIssues(issues);
  return stateForOpenIssues(
    issues.filter(({ isClosed }) => !isClosed),
    hasOpenLinkedPullRequest,
  );
}

function projectionSignals(issues: IssueMapping[], automatic: boolean, moduleName: ModuleName | null): ProjectionSignal[] {
  const openIssues = issues.filter(({ isClosed }) => !isClosed);
  const signals: ProjectionSignal[] = [];
  if (openIssues.some(({ status }) => status === "status:review")) signals.push("review");
  if (openIssues.some(({ status }) => status === "status:blocked")) signals.push("blocked");
  if (automatic && moduleName === null) signals.push("roadmap_triage");
  return signals;
}

function selectedModuleName(input: ProjectionInput, issues: IssueMapping[]): ModuleName | null {
  const moduleNames = [...new Set(issues.flatMap(({ moduleName }) => (moduleName ? [moduleName] : [])))];
  if (moduleNames.length > 1) throw new PermanentSyncError("projection_module_labels_conflict");
  const explicitModuleName = moduleNames[0] ?? null;
  if (explicitModuleName === null) return input.seedModuleName;
  if (input.seedModuleName !== null && !input.allowModuleOverride) return input.seedModuleName;
  return explicitModuleName;
}

function selectedPriority(input: ProjectionInput, issues: IssueMapping[]): DesiredProjection["priority"] {
  if (input.currentPriority === "urgent") return null;
  const priorities = [...new Set(issues.flatMap(({ priority }) => (priority ? [priority] : [])))];
  if (priorities.length > 1) throw new PermanentSyncError("projection_priority_labels_conflict");
  const priority = priorities[0];
  if (priority) return priorityByLabel[priority];
  return input.automatic ? "none" : null;
}

function primaryIssue(issues: GitHubIssueState[]): GitHubIssueState {
  if (issues.length === 0) throw new PermanentSyncError("projection_issue_group_empty");
  return [...issues].sort((left, right) => left.number - right.number || left.url.localeCompare(right.url))[0]!;
}

export function projectIssueGroup(input: ProjectionInput): DesiredProjection {
  const primary = primaryIssue(input.issues);
  const mappedIssues = input.issues.map(mappingForIssue);
  const moduleName = selectedModuleName(input, mappedIssues);

  return {
    planeState: issueState(mappedIssues, input.hasOpenLinkedPullRequest),
    priority: selectedPriority(input, mappedIssues),
    moduleName,
    commentSignals: projectionSignals(mappedIssues, input.automatic, moduleName),
    title: input.automatic ? primary.title : null,
    canonicalIssueUrl: primary.url,
  };
}

function nonEmpty(value: string, code: string): string {
  if (!value) throw new PermanentSyncError(code);
  return value;
}

function canonicalUrl(value: string): string {
  const url = nonEmpty(value, "projection_canonical_url_invalid");
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("unsafe canonical URL");
    return url;
  } catch {
    throw new PermanentSyncError("projection_canonical_url_invalid");
  }
}

function milestoneHtml(summary: string, input: MilestoneInput): string {
  const actor = nonEmpty(input.delivery.actorLogin, "projection_actor_invalid");
  const occurredAt = nonEmpty(input.delivery.occurredAt, "projection_occurred_at_invalid");
  const url = canonicalUrl(input.canonicalUrl);
  return `<p><strong>GitHub milestone:</strong> ${escapeHtml(summary)}</p><p><strong>Actor:</strong> ${escapeHtml(actor)} · <time datetime="${escapeHtml(occurredAt)}">${escapeHtml(occurredAt)}</time> · <a href="${escapeHtml(url)}">View on GitHub</a></p>`;
}

export function milestonesForDelivery(input: MilestoneInput): Milestone[] {
  const { delivery, planeWorkItemId, transition } = input;
  if (transition === null) return [];
  const itemId = nonEmpty(planeWorkItemId, "projection_plane_work_item_invalid");
  const summary = milestoneSummary[transition];
  let id: string;
  if (transition === "reconciliation_repair") {
    if (delivery.subjectNumber === null) throw new PermanentSyncError("projection_reconciliation_issue_invalid");
    const updatedAt = nonEmpty(input.updatedAt, "projection_reconciliation_updated_at_invalid");
    const projectionHash = projectionHashForProjection(input.projection);
    id = `github:reconcile:${delivery.subjectNumber}:${updatedAt}:${projectionHash}:${itemId}`;
  } else {
    id = `github:${delivery.deliveryId}:${transition}:${itemId}`;
  }

  return [{ id, html: milestoneHtml(summary, input), externalSource: EXTERNAL_SOURCE, externalId: id }];
}

export function projectionHashForProjection(projection: DesiredProjection): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        planeState: projection.planeState,
        priority: projection.priority,
        moduleName: projection.moduleName,
        commentSignals: projection.commentSignals,
        title: projection.title,
        canonicalIssueUrl: projection.canonicalIssueUrl,
      }),
    )
    .digest("hex");
}

export function projectionCommentForProjection(projection: DesiredProjection, planeWorkItemId: string): ProjectionComment {
  const itemId = nonEmpty(planeWorkItemId, "projection_plane_work_item_invalid");
  const sourceUrl = canonicalUrl(projection.canonicalIssueUrl);
  const sourceTitle = projection.title ?? sourceUrl;
  const signals = projection.commentSignals.length === 0 ? "none" : projection.commentSignals.join(", ");
  const module = projection.moduleName ?? "Unassigned";
  const priority = projection.priority ?? "preserved";
  const hash = projectionHashForProjection(projection);

  return {
    externalId: `projection:${itemId}:${hash}`,
    html: `<p><strong>GitHub projection:</strong> ${escapeHtml(projection.planeState)}</p><p><strong>Source:</strong> <a href="${escapeHtml(sourceUrl)}">${escapeHtml(sourceTitle)}</a></p><p><strong>Priority:</strong> ${escapeHtml(priority)} · <strong>Module:</strong> ${escapeHtml(module)} · <strong>Signals:</strong> ${escapeHtml(signals)}</p>`,
  };
}
