import { PermanentSyncError } from "./errors.js";
import { GitHubClient } from "./github.js";
import { logSyncEvent } from "./log.js";
import {
  PlaneClient,
  type PlaneModuleMembershipInventory,
  type PlanePriority,
  type PlaneWorkItem,
} from "./plane.js";
import {
  milestonesForDelivery,
  projectIssueGroup,
  projectionCommentForProjection,
} from "./projection.js";
import { SqliteDeliveryStore, type StoredMapping } from "./store.js";
import type {
  CompactDelivery,
  DesiredProjection,
  EventMilestoneInput,
  GitHubIssueContext,
  GitHubIssueState,
  GitHubPullRequestContext,
  Milestone,
  ProcessResult,
  SeedRegistryEntry,
  SeedRegistryIndex,
  SyncConfig,
} from "./types.js";

export interface ProcessorDeps {
  config: Pick<SyncConfig, "writeMode">;
  store: SqliteDeliveryStore;
  github: GitHubClient;
  plane: PlaneClient;
  registry: SeedRegistryIndex;
  now: () => Date;
  log: typeof logSyncEvent;
  onPlaneMutation?: (at: Date) => void;
  /** Fresh, execution-scoped membership truth. Never retain this across deliveries. */
  moduleInventory?: PlaneModuleMembershipInventory;
}

interface ExistingTarget {
  kind: "existing";
  planeWorkItemId: string;
  source: "seed" | "automatic";
  seedEntry: SeedRegistryEntry | null;
  mappingWillBeRepaired: boolean;
}

interface NewAutomaticTarget {
  kind: "new-automatic";
  issueNumber: number;
}

type Target = ExistingTarget | NewAutomaticTarget;

interface IssueWork {
  delivery: CompactDelivery;
  issue: GitHubIssueState;
  hasOpenLinkedPullRequest: boolean;
  milestoneUrl: string;
  transition: EventMilestoneInput["transition"];
  emitAutomaticWorkStarted: boolean;
}

interface ExistingTargetApply {
  totals: Totals;
  projection: DesiredProjection;
}

export interface ExistingConvergenceInput {
  issue: GitHubIssueState;
  hasOpenLinkedPullRequest: boolean;
  planeWorkItemId: string;
  source: "seed" | "automatic";
  seedEntry: SeedRegistryEntry | null;
  mappingWillBeRepaired?: boolean;
}

export interface ExistingConvergenceResult {
  updated: number;
  comments: number;
  planned: boolean;
  mutated: boolean;
  projection: DesiredProjection;
}

interface Totals {
  created: number;
  updated: number;
  comments: number;
  planned: boolean;
  mutated: boolean;
}

function emptyTotals(): Totals {
  return { created: 0, updated: 0, comments: 0, planned: false, mutated: false };
}

function addTotals(total: Totals, addition: Totals): void {
  total.created += addition.created;
  total.updated += addition.updated;
  total.comments += addition.comments;
  total.planned ||= addition.planned;
  total.mutated ||= addition.mutated;
}

function recordPlaneMutation(deps: ProcessorDeps): void {
  const at = deps.now();
  if (deps.onPlaneMutation) deps.onPlaneMutation(at);
  else deps.store.setMaxTimestamp("last-successful-plane-mutation-at", at);
}

async function planeMutation<T>(deps: ProcessorDeps, operation: () => Promise<T>): Promise<T> {
  const result = await operation();
  recordPlaneMutation(deps);
  return result;
}

async function planeModuleMutation(
  deps: ProcessorDeps,
  operation: (onMutation: () => void) => Promise<boolean>,
): Promise<boolean> {
  return operation(() => recordPlaneMutation(deps));
}

function isManaged(target: ExistingTarget, field: SeedRegistryEntry["managedFields"][number]): boolean {
  return target.seedEntry === null || target.seedEntry.managedFields.includes(field);
}

function targetFromStoredMapping(registry: SeedRegistryIndex, mapping: StoredMapping): ExistingTarget {
  const seedEntry = registry.byPlaneItem.get(mapping.planeWorkItemId) ?? null;
  if (mapping.source === "seed" && seedEntry === null) {
    throw new PermanentSyncError("plane_seed_mapping_unregistered");
  }
  return {
    kind: "existing",
    planeWorkItemId: mapping.planeWorkItemId,
    source: seedEntry === null ? mapping.source : "seed",
    seedEntry,
    mappingWillBeRepaired: false,
  };
}

async function targetsForIssue(deps: ProcessorDeps, issueWork: IssueWork): Promise<Target[]> {
  const issue = issueWork.issue;
  const targets = new Map<string, ExistingTarget>();
  for (const entry of deps.registry.byIssue.get(issue.number) ?? []) {
    targets.set(entry.planeWorkItemId, {
      kind: "existing",
      planeWorkItemId: entry.planeWorkItemId,
      source: "seed",
      seedEntry: entry,
      mappingWillBeRepaired: false,
    });
  }
  for (const mapping of deps.store.mappingsForIssue(issue.number)) {
    const target = targetFromStoredMapping(deps.registry, mapping);
    const existing = targets.get(target.planeWorkItemId);
    targets.set(target.planeWorkItemId, existing?.seedEntry ? existing : target);
  }
  if (targets.size > 0) return [...targets.values()];

  const recovered = await deps.plane.findItemsByCanonicalIssueUrl(issue.url);
  if (recovered.length > 1) throw new PermanentSyncError("plane_mapping_ambiguous");
  if (recovered.length === 1) {
    const target: ExistingTarget = {
      kind: "existing",
      planeWorkItemId: recovered[0]!.id,
      source: "automatic",
      seedEntry: null,
      mappingWillBeRepaired: true,
    };
    if (deps.config.writeMode === "active") deps.store.upsertMapping(issue.number, target.planeWorkItemId);
    return [target];
  }
  if (
    issueWork.delivery.event !== "issues" ||
    issueWork.delivery.action !== "opened" ||
    issueWork.delivery.subjectKind !== "issue" ||
    issueWork.delivery.subjectNumber !== issue.number
  ) {
    return [];
  }
  return [{ kind: "new-automatic", issueNumber: issue.number }];
}

function exactProjectionPatch(
  target: ExistingTarget,
  current: PlaneWorkItem,
  projection: DesiredProjection,
  stateId: string,
): { stateId?: string; priority?: PlanePriority } {
  const patch: { stateId?: string; priority?: PlanePriority } = {};
  if (isManaged(target, "state") && current.stateId !== stateId) patch.stateId = stateId;
  if (isManaged(target, "priority") && projection.priority !== null && current.priority !== projection.priority) {
    patch.priority = projection.priority;
  }
  return patch;
}

async function withModuleInventory(deps: ProcessorDeps): Promise<ProcessorDeps & { moduleInventory: PlaneModuleMembershipInventory }> {
  return deps.moduleInventory
    ? deps as ProcessorDeps & { moduleInventory: PlaneModuleMembershipInventory }
    : { ...deps, moduleInventory: await deps.plane.loadModuleMembershipInventory() };
}

function workStartedIntentKey(delivery: CompactDelivery, planeWorkItemId: string): string {
  return `delivery-transition:${delivery.deliveryId}:work_started:${planeWorkItemId}`;
}

function newWorkStartedIntentKey(delivery: CompactDelivery, issueNumber: number): string {
  return `delivery-transition:${delivery.deliveryId}:work_started:new-issue:${issueNumber}`;
}

async function ensureComment(
  deps: ProcessorDeps,
  planeWorkItemId: string,
  milestone: Milestone | { html: string; externalId: string },
  planeExternalIds: Set<string>,
  create: () => Promise<void>,
): Promise<Totals> {
  const totals = emptyTotals();
  const existsLocally = deps.store.hasMilestone(milestone.externalId, planeWorkItemId);
  const existsInPlane = planeExternalIds.has(milestone.externalId);
  if (existsInPlane) {
    if (!existsLocally && deps.config.writeMode === "active") {
      deps.store.recordMilestone(milestone.externalId, planeWorkItemId, deps.now());
    }
    return totals;
  }
  if (existsLocally) return totals;
  if (deps.config.writeMode === "dry-run") {
    totals.comments = 1;
    totals.planned = true;
    return totals;
  }
  await planeMutation(deps, create);
  deps.store.recordMilestone(milestone.externalId, planeWorkItemId, deps.now());
  planeExternalIds.add(milestone.externalId);
  totals.comments = 1;
  totals.mutated = true;
  return totals;
}

async function applyComments(
  deps: ProcessorDeps,
  target: ExistingTarget,
  projection: DesiredProjection,
  issueWork: IssueWork,
): Promise<Totals> {
  const totals = emptyTotals();
  if (!isManaged(target, "milestones")) return totals;
  const planeExternalIds = await deps.plane.listMilestoneExternalIds(target.planeWorkItemId);
  const projectionComment = projectionCommentForProjection(projection, target.planeWorkItemId);
  addTotals(
    totals,
    await ensureComment(deps, target.planeWorkItemId, projectionComment, planeExternalIds, () =>
      deps.plane.addProjectionComment(target.planeWorkItemId, projectionComment),
    ),
  );
  for (const milestone of milestonesForDelivery({
    delivery: issueWork.delivery,
    transition: issueWork.transition,
    planeWorkItemId: target.planeWorkItemId,
    canonicalUrl: issueWork.milestoneUrl,
  })) {
    addTotals(
      totals,
      await ensureComment(deps, target.planeWorkItemId, milestone, planeExternalIds, () =>
        deps.plane.addMilestone(target.planeWorkItemId, milestone),
      ),
    );
  }
  return totals;
}

function transitionForProjection(
  issueWork: IssueWork,
  projection: DesiredProjection,
  enteredInProgress: boolean,
): EventMilestoneInput["transition"] {
  if (issueWork.transition !== null) return issueWork.transition;
  return issueWork.emitAutomaticWorkStarted && enteredInProgress && projection.planeState === "In Progress"
    ? "work_started"
    : null;
}

function projectionForTarget(
  issues: GitHubIssueState[],
  target: ExistingTarget | NewAutomaticTarget,
  currentPriority: PlanePriority,
  hasOpenLinkedPullRequest: boolean,
): DesiredProjection {
  const seedEntry = target.kind === "existing" ? target.seedEntry : null;
  return projectIssueGroup({
    issues,
    hasOpenLinkedPullRequest,
    automatic: seedEntry === null,
    seedModuleName: seedEntry?.moduleName ?? null,
    allowModuleOverride: true,
    currentPriority,
  });
}

async function applyExistingTarget(
  deps: ProcessorDeps,
  target: ExistingTarget,
  issueWork: IssueWork,
): Promise<ExistingTargetApply> {
  const totals = emptyTotals();
  if (target.mappingWillBeRepaired) {
    totals.updated += 1;
    if (deps.config.writeMode === "active") totals.mutated = true;
    else totals.planned = true;
  }
  const current = await deps.plane.getWorkItem(target.planeWorkItemId);
  const issueNumbers = target.seedEntry?.issueNumbers ?? [issueWork.issue.number];
  const contexts = await Promise.all(
    issueNumbers.map((issueNumber): Promise<GitHubIssueContext> =>
      issueNumber === issueWork.issue.number
        ? Promise.resolve({ issue: issueWork.issue, hasOpenLinkedPullRequest: issueWork.hasOpenLinkedPullRequest })
        : deps.github.getIssueContext(issueNumber),
    ),
  );
  const projection = projectionForTarget(
    contexts.map((context) => context.issue),
    target,
    current.priority,
    contexts.some((context) => context.hasOpenLinkedPullRequest),
  );
  const vocabulary = deps.moduleInventory!.vocabulary;
  const desiredStateId = vocabulary.states[projection.planeState];
  const enteredInProgress =
    issueWork.emitAutomaticWorkStarted &&
    isManaged(target, "state") &&
    projection.planeState === "In Progress" &&
    (current.stateId !== desiredStateId ||
      deps.store.getCursor(workStartedIntentKey(issueWork.delivery, target.planeWorkItemId)) !== null ||
      deps.store.getCursor(newWorkStartedIntentKey(issueWork.delivery, issueWork.issue.number)) !== null);
  const patch = exactProjectionPatch(target, current, projection, desiredStateId);
  if (Object.keys(patch).length > 0) {
    if (deps.config.writeMode === "active") {
      if (enteredInProgress) {
        deps.store.setCursor(workStartedIntentKey(issueWork.delivery, target.planeWorkItemId), deps.now().toISOString());
      }
      await planeMutation(deps, () => deps.plane.patchProjection(current, patch));
      totals.mutated = true;
    } else {
      totals.planned = true;
    }
    totals.updated += 1;
  }
  if (isManaged(target, "module") && projection.moduleName !== null) {
    const moduleId = vocabulary.modules[projection.moduleName];
    if (!deps.moduleInventory!.hasExactlyOneModule(target.planeWorkItemId, moduleId)) {
      if (deps.config.writeMode === "active") {
        const changed = await planeModuleMutation(deps, (onMutation) =>
          deps.plane.setModule(target.planeWorkItemId, moduleId, onMutation, deps.moduleInventory),
        );
        if (changed) {
          totals.mutated = true;
          totals.updated += 1;
        }
      } else {
        totals.planned = true;
        totals.updated += 1;
      }
    }
  } else if (isManaged(target, "module") && target.seedEntry === null) {
    if (deps.moduleInventory!.hasAnyModule(target.planeWorkItemId) && deps.config.writeMode === "active") {
      const changed = await planeModuleMutation(deps, (onMutation) =>
        deps.plane.clearModule(target.planeWorkItemId, onMutation, deps.moduleInventory),
      );
      if (changed) {
        totals.mutated = true;
        totals.updated += 1;
      }
    } else if (deps.moduleInventory!.hasAnyModule(target.planeWorkItemId)) {
      totals.planned = true;
      totals.updated += 1;
    }
  }
  const comments = await applyComments(
    deps,
    target,
    projection,
    { ...issueWork, transition: transitionForProjection(issueWork, projection, enteredInProgress) },
  );
  addTotals(totals, comments);
  return { totals, projection };
}

async function applyNewAutomaticTarget(
  deps: ProcessorDeps,
  target: NewAutomaticTarget,
  issueWork: IssueWork,
): Promise<Totals> {
  const totals = emptyTotals();
  const projection = projectionForTarget([issueWork.issue], target, "none", issueWork.hasOpenLinkedPullRequest);
  if (deps.config.writeMode === "dry-run") {
    return { created: 1, updated: 0, comments: 0, planned: true, mutated: false };
  }
  const vocabulary = deps.moduleInventory!.vocabulary;
  if (projection.planeState === "In Progress") {
    deps.store.setCursor(newWorkStartedIntentKey(issueWork.delivery, target.issueNumber), deps.now().toISOString());
  }
  const item = await planeMutation(deps, () =>
    deps.plane.createAutomaticItem({
      title: projection.title ?? issueWork.issue.title,
      canonicalIssueUrl: projection.canonicalIssueUrl,
      stateId: vocabulary.states[projection.planeState],
      priority: projection.priority ?? "none",
    }),
  );
  deps.store.upsertMapping(target.issueNumber, item.id);
  if (projection.moduleName !== null) {
    const moduleId = vocabulary.modules[projection.moduleName];
    await planeModuleMutation(deps, (onMutation) => deps.plane.setModule(item.id, moduleId, onMutation, deps.moduleInventory));
  }
  totals.created = 1;
  totals.mutated = true;
  const existing: ExistingTarget = {
    kind: "existing",
    planeWorkItemId: item.id,
    source: "automatic",
    seedEntry: null,
    mappingWillBeRepaired: false,
  };
  addTotals(
    totals,
    await applyComments(deps, existing, projection, {
      ...issueWork,
      transition: transitionForProjection(issueWork, projection, projection.planeState === "In Progress"),
    }),
  );
  return totals;
}

function issueTransition(delivery: CompactDelivery, issue: GitHubIssueState): EventMilestoneInput["transition"] {
  if (delivery.event === "issues") {
    if (delivery.action === "closed") return issue.stateReason === "NOT_PLANNED" ? "issue_cancelled" : "issue_closed";
    if (delivery.action === "reopened") return "issue_reopened";
  }
  return null;
}

function pullRequestTransition(delivery: CompactDelivery, context: GitHubPullRequestContext): EventMilestoneInput["transition"] {
  if (delivery.event === "pull_request") {
    if (delivery.action === "opened") return "pr_opened";
    if (delivery.action === "ready_for_review") return "ready_for_review";
    if (delivery.action === "closed") return context.pullRequest.state === "MERGED" ? "pr_merged" : "pr_closed";
  }
  if (delivery.event === "pull_request_review" && delivery.action === "submitted") return "review_submitted";
  return null;
}

async function workForDelivery(deps: ProcessorDeps, delivery: CompactDelivery): Promise<IssueWork[]> {
  if (delivery.subjectNumber === null || delivery.subjectKind === "repository") return [];
  if (delivery.subjectKind === "issue") {
    if (
      delivery.event === "issue_comment" &&
      await deps.github.getIssueSubjectKind(delivery.subjectNumber) === "pull_request"
    ) {
      return [];
    }
    const context = await deps.github.getIssueContext(delivery.subjectNumber);
    return [{
      delivery,
      issue: context.issue,
      hasOpenLinkedPullRequest: context.hasOpenLinkedPullRequest,
      milestoneUrl: context.issue.url,
      transition: issueTransition(delivery, context.issue),
      emitAutomaticWorkStarted: true,
    }];
  }
  const context = await deps.github.getPullRequestContext(delivery.subjectNumber);
  const transition = pullRequestTransition(delivery, context);
  return Promise.all(
    [...new Set(context.closingIssueNumbers)].map(async (issueNumber) => {
      const issueContext = await deps.github.getIssueContext(issueNumber);
      return {
        delivery,
        issue: issueContext.issue,
        hasOpenLinkedPullRequest:
          issueContext.hasOpenLinkedPullRequest || context.pullRequest.state === "OPEN",
        milestoneUrl: context.pullRequest.url,
        transition,
        emitAutomaticWorkStarted: true,
      };
    }),
  );
}

export async function processDelivery(deps: ProcessorDeps, delivery: CompactDelivery): Promise<ProcessResult> {
  const issueWork = await workForDelivery(deps, delivery);
  if (issueWork.length === 0) return { outcome: "noop", created: 0, updated: 0, comments: 0 };

  const executionDeps = await withModuleInventory(deps);

  const totals = emptyTotals();
  const processed = new Set<string>();
  for (const work of issueWork) {
    const targets = await targetsForIssue(executionDeps, work);
    for (const target of targets) {
      const key = target.kind === "existing" ? target.planeWorkItemId : `new:${target.issueNumber}`;
      if (processed.has(key)) continue;
      processed.add(key);
      addTotals(
        totals,
        target.kind === "existing"
          ? (await applyExistingTarget(executionDeps, target, work)).totals
          : await applyNewAutomaticTarget(executionDeps, target, work),
      );
    }
  }
  return {
    outcome: totals.mutated ? "mutated" : totals.planned ? "planned" : "noop",
    created: totals.created,
    updated: totals.updated,
    comments: totals.comments,
  };
}

/**
 * Converges one already-mapped Plane item from authoritative GitHub state.
 * Reconciliation deliberately uses this delivery processor core so the two
 * paths cannot drift in how they project, patch, preserve manual fields, or
 * write projection comments.
 */
export async function convergeExistingTarget(
  deps: ProcessorDeps,
  input: ExistingConvergenceInput,
): Promise<ExistingConvergenceResult> {
  if (input.source === "seed" && input.seedEntry === null) {
    throw new PermanentSyncError("plane_seed_mapping_unregistered");
  }
  const executionDeps = await withModuleInventory(deps);
  const applied = await applyExistingTarget(
    executionDeps,
    {
      kind: "existing",
      planeWorkItemId: input.planeWorkItemId,
      source: input.source,
      seedEntry: input.seedEntry,
      mappingWillBeRepaired: input.mappingWillBeRepaired ?? false,
    },
    {
      delivery: {
        deliveryId: `reconcile:${input.issue.number}:${input.issue.updatedAt}`,
        event: "issues",
        action: "reconcile",
        repository: "label-suite-org/label-suite_neon_r2",
        subjectKind: "issue",
        subjectNumber: input.issue.number,
        actorLogin: "reconciler",
        occurredAt: input.issue.updatedAt,
      },
      issue: input.issue,
      hasOpenLinkedPullRequest: input.hasOpenLinkedPullRequest,
      milestoneUrl: input.issue.url,
      transition: null,
      emitAutomaticWorkStarted: false,
    },
  );
  return {
    updated: applied.totals.updated,
    comments: applied.totals.comments,
    planned: applied.totals.planned,
    mutated: applied.totals.mutated,
    projection: applied.projection,
  };
}
