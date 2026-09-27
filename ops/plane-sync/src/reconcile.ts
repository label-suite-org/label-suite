import { PermanentSyncError } from "./errors.js";
import { GitHubClient } from "./github.js";
import {
  convergeExistingTarget,
  type ExistingConvergenceInput,
  type ProcessorDeps,
} from "./processor.js";
import { milestonesForDelivery } from "./projection.js";
import { SqliteDeliveryStore } from "./store.js";
import { PlaneClient } from "./plane.js";
import type {
  CompactDelivery,
  DesiredProjection,
  GitHubIssueContext,
  ReconcileReport,
  SeedRegistryEntry,
  SeedRegistryIndex,
  WriteMode,
} from "./types.js";

const CURSOR_KEY = "github-reconcile";
const LAST_SUCCESS_KEY = "last-successful-reconciliation-at";
const LAST_PLANE_MUTATION_KEY = "last-successful-plane-mutation-at";

interface ReconcileDeps {
  store: SqliteDeliveryStore;
  github: GitHubClient;
  plane: PlaneClient;
  registry: SeedRegistryIndex;
}

interface ReconcileTarget {
  key: string;
  issueNumber: number;
  planeWorkItemId: string;
  source: "seed" | "automatic";
  seedEntry: SeedRegistryEntry | null;
  mappingWillBeRepaired: boolean;
}

interface AutomaticTargetScan {
  targets: ReconcileTarget[];
  checked: number;
  knownIssueNumbers: Set<number>;
}

interface PreparedTarget {
  target: ReconcileTarget;
  context: GitHubIssueContext;
  changed: boolean;
  repairMilestonePlanned: boolean;
}

function initialReport(mode: WriteMode): ReconcileReport {
  return {
    mode,
    seedItemsChecked: 0,
    automaticItemsChecked: 0,
    planned: 0,
    applied: 0,
    repaired: 0,
    ambiguous: 0,
    failed: 0,
    cursorAdvancedTo: null,
  };
}

function reconciliationDelivery(context: GitHubIssueContext): CompactDelivery {
  return {
    deliveryId: `reconcile:${context.issue.number}:${context.issue.updatedAt}`,
    event: "issues",
    action: "reconcile",
    repository: "label-suite-org/label-suite_neon_r2",
    subjectKind: "issue",
    subjectNumber: context.issue.number,
    actorLogin: "reconciler",
    occurredAt: context.issue.updatedAt,
  };
}

async function ensureRepairMilestone(
  deps: ReconcileDeps,
  target: ReconcileTarget,
  input: ExistingConvergenceInput,
  projection: DesiredProjection,
  apply: boolean,
  now: Date,
): Promise<boolean> {
  const [milestone] = milestonesForDelivery({
    delivery: reconciliationDelivery({ issue: input.issue, hasOpenLinkedPullRequest: input.hasOpenLinkedPullRequest }),
    transition: "reconciliation_repair",
    planeWorkItemId: target.planeWorkItemId,
    canonicalUrl: input.issue.url,
    updatedAt: input.issue.updatedAt,
    projection,
  });
  if (!milestone) throw new PermanentSyncError("reconciliation_milestone_missing");
  const planeExternalIds = await deps.plane.listMilestoneExternalIds(target.planeWorkItemId);
  if (planeExternalIds.has(milestone.externalId)) {
    if (apply && !deps.store.hasMilestone(milestone.externalId, target.planeWorkItemId)) {
      deps.store.recordMilestone(milestone.externalId, target.planeWorkItemId, now);
    }
    return false;
  }
  if (deps.store.hasMilestone(milestone.externalId, target.planeWorkItemId)) return false;
  if (!apply) return true;
  await deps.plane.addMilestone(target.planeWorkItemId, milestone);
  deps.store.setMaxTimestamp(LAST_PLANE_MUTATION_KEY, now);
  deps.store.recordMilestone(milestone.externalId, target.planeWorkItemId, now);
  return true;
}

function seedTargets(registry: SeedRegistryIndex): ReconcileTarget[] {
  return [...registry.byPlaneItem.values()]
    .sort((left, right) => left.planeWorkItemId.localeCompare(right.planeWorkItemId))
    .map((entry) => ({
      key: `seed:${entry.planeWorkItemId}`,
      issueNumber: [...entry.issueNumbers].sort((left, right) => left - right)[0]!,
      planeWorkItemId: entry.planeWorkItemId,
      source: "seed",
      seedEntry: entry,
      mappingWillBeRepaired: false,
    }));
}

function automaticTargets(deps: ReconcileDeps): AutomaticTargetScan {
  const targets = new Map<string, ReconcileTarget>();
  for (const mapping of deps.store.automaticMappings()) {
    const key = `automatic:${mapping.issueNumber}:${mapping.planeWorkItemId}`;
    targets.set(key, {
      key,
      issueNumber: mapping.issueNumber,
      planeWorkItemId: mapping.planeWorkItemId,
      source: "automatic",
      seedEntry: null,
      mappingWillBeRepaired: false,
    });
  }
  const values = [...targets.values()].sort((left, right) => left.key.localeCompare(right.key));
  return {
    targets: values,
    checked: values.length,
    knownIssueNumbers: new Set(values.map((target) => target.issueNumber)),
  };
}

function partitionAutomaticTargets(
  targets: ReconcileTarget[],
  registry: SeedRegistryIndex,
): { clean: ReconcileTarget[]; ambiguous: number } {
  const unique = new Map<string, ReconcileTarget>();
  for (const target of targets) unique.set(`${target.issueNumber}:${target.planeWorkItemId}`, target);
  const values = [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
  const targetsByIssue = new Map<number, ReconcileTarget[]>();
  const targetsByPlane = new Map<string, ReconcileTarget[]>();
  for (const target of values) {
    targetsByIssue.set(target.issueNumber, [...(targetsByIssue.get(target.issueNumber) ?? []), target]);
    targetsByPlane.set(target.planeWorkItemId, [...(targetsByPlane.get(target.planeWorkItemId) ?? []), target]);
  }
  const visited = new Set<string>();
  const ambiguousKeys = new Set<string>();
  let ambiguous = 0;
  for (const target of values) {
    const identity = `${target.issueNumber}:${target.planeWorkItemId}`;
    if (visited.has(identity)) continue;
    const queue = [target];
    const component: ReconcileTarget[] = [];
    const issueNumbers = new Set<number>();
    const planeItemIds = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentIdentity = `${current.issueNumber}:${current.planeWorkItemId}`;
      if (visited.has(currentIdentity)) continue;
      visited.add(currentIdentity);
      component.push(current);
      issueNumbers.add(current.issueNumber);
      planeItemIds.add(current.planeWorkItemId);
      queue.push(...(targetsByIssue.get(current.issueNumber) ?? []));
      queue.push(...(targetsByPlane.get(current.planeWorkItemId) ?? []));
    }
    const conflictsWithSeed = component.some((current) =>
      registry.byIssue.has(current.issueNumber) || registry.byPlaneItem.has(current.planeWorkItemId),
    );
    if (issueNumbers.size > 1 || planeItemIds.size > 1 || conflictsWithSeed) {
      ambiguous += 1;
      for (const current of component) ambiguousKeys.add(current.key);
    }
  }
  return {
    clean: values.filter((target) => !ambiguousKeys.has(target.key)),
    ambiguous,
  };
}

function managesMilestones(target: ReconcileTarget): boolean {
  return target.seedEntry === null || target.seedEntry.managedFields.includes("milestones");
}

function recordPermanentFailure(report: ReconcileReport, error: PermanentSyncError): void {
  if (error.code === "plane_mapping_ambiguous") report.ambiguous += 1;
  else report.failed += 1;
}

export async function reconcile(
  deps: ReconcileDeps,
  options: { apply: boolean; now: Date },
): Promise<ReconcileReport> {
  const mode: WriteMode = options.apply ? "active" : "dry-run";
  const report = initialReport(mode);
  const runStartedAt = new Date(options.now.valueOf());
  const cursor = deps.store.getCursor(CURSOR_KEY);
  const seed = seedTargets(deps.registry);
  const automatic = automaticTargets(deps);
  const automaticCandidates = [...automatic.targets];
  const knownIssueNumbers = new Set<number>();
  const knownContexts = new Map<number, GitHubIssueContext>();

  report.seedItemsChecked = seed.length;
  report.automaticItemsChecked = automatic.checked;
  for (const target of seed) {
    for (const issueNumber of target.seedEntry!.issueNumbers) knownIssueNumbers.add(issueNumber);
  }
  for (const issueNumber of automatic.knownIssueNumbers) knownIssueNumbers.add(issueNumber);

  if (cursor !== null) {
    const updatedIssues = await deps.github.listIssuesUpdatedSince(cursor);
    for (const issue of [...updatedIssues].sort((left, right) => left.number - right.number || left.url.localeCompare(right.url))) {
      if (knownIssueNumbers.has(issue.number) || deps.registry.byIssue.has(issue.number)) continue;
      report.automaticItemsChecked += 1;
      knownIssueNumbers.add(issue.number);
      try {
        const context = await deps.github.getIssueContext(issue.number);
        knownContexts.set(issue.number, context);
        const recovered = await deps.plane.findItemsByCanonicalIssueUrl(context.issue.url);
        if (recovered.length > 1) {
          report.ambiguous += 1;
          continue;
        }
        if (recovered.length !== 1) continue;
        automaticCandidates.push({
          key: `automatic:${context.issue.number}:${recovered[0]!.id}`,
          issueNumber: context.issue.number,
          planeWorkItemId: recovered[0]!.id,
          source: "automatic",
          seedEntry: null,
          mappingWillBeRepaired: true,
        });
      } catch (error) {
        if (!(error instanceof PermanentSyncError)) throw error;
        recordPermanentFailure(report, error);
      }
    }
  }

  const partitioned = partitionAutomaticTargets(automaticCandidates, deps.registry);
  report.ambiguous += partitioned.ambiguous;
  const targets = [...seed, ...partitioned.clean].sort((left, right) => left.key.localeCompare(right.key));
  // One fresh, sequential inventory is authoritative for both planning and
  // applying this reconciliation. It intentionally never survives the run.
  const moduleInventory = await deps.plane.loadModuleMembershipInventory();
  const contexts = new Map<number, Promise<GitHubIssueContext>>(
    [...knownContexts].map(([issueNumber, context]) => [issueNumber, Promise.resolve(context)]),
  );
  const contextFor = (issueNumber: number): Promise<GitHubIssueContext> => {
    let context = contexts.get(issueNumber);
    if (!context) {
      context = deps.github.getIssueContext(issueNumber);
      contexts.set(issueNumber, context);
    }
    return context;
  };
  const processorDeps = (writeMode: WriteMode): ProcessorDeps => ({
    config: { writeMode },
    store: deps.store,
    github: deps.github,
    plane: deps.plane,
    registry: deps.registry,
    now: () => new Date(runStartedAt.valueOf()),
    log: () => undefined,
    moduleInventory,
    onPlaneMutation: writeMode === "active" ? (at) => {
      deps.store.setMaxTimestamp(LAST_PLANE_MUTATION_KEY, at);
    } : undefined,
  });
  const prepared: PreparedTarget[] = [];

  for (const target of targets) {
    try {
      const context = await contextFor(target.issueNumber);
      const input: ExistingConvergenceInput = {
        issue: context.issue,
        hasOpenLinkedPullRequest: context.hasOpenLinkedPullRequest,
        planeWorkItemId: target.planeWorkItemId,
        source: target.source,
        seedEntry: target.seedEntry,
        mappingWillBeRepaired: target.mappingWillBeRepaired,
      };
      const result = await convergeExistingTarget(processorDeps("dry-run"), input);
      const changed = result.updated > 0 || result.comments > 0;
      const repairMilestonePlanned = changed && managesMilestones(target)
        ? await ensureRepairMilestone(deps, target, input, result.projection, false, runStartedAt)
        : false;
      const planned = result.planned || repairMilestonePlanned;
      if (planned) report.planned += 1;
      prepared.push({ target, context, changed, repairMilestonePlanned });
    } catch (error) {
      if (!(error instanceof PermanentSyncError)) throw error;
      recordPermanentFailure(report, error);
    }
  }

  if (report.ambiguous > 0 || report.failed > 0) return report;
  if (!options.apply) {
    report.repaired = prepared.filter(({ target }) => target.mappingWillBeRepaired).length;
    return report;
  }

  report.planned = 0;
  for (const { target, context, changed, repairMilestonePlanned } of prepared) {
    // The dry-run just fetched authoritative item, membership, and comment
    // state. A clean target has no mutation to re-check, so avoid repeating
    // its Plane reads in the active pass. This keeps a 16-item no-op
    // reconciliation safely below Plane's shared 60 request/minute window.
    if (!changed && !repairMilestonePlanned) continue;
    const input: ExistingConvergenceInput = {
      issue: context.issue,
      hasOpenLinkedPullRequest: context.hasOpenLinkedPullRequest,
      planeWorkItemId: target.planeWorkItemId,
      source: target.source,
      seedEntry: target.seedEntry,
      mappingWillBeRepaired: target.mappingWillBeRepaired,
    };
    const result = await convergeExistingTarget(processorDeps("active"), input);
    const activeChanged = result.updated > 0 || result.comments > 0;
    const repairMilestoneChanged = activeChanged && managesMilestones(target)
      ? await ensureRepairMilestone(deps, target, input, result.projection, true, runStartedAt)
      : false;
    if (result.mutated || repairMilestoneChanged) {
      report.applied += 1;
    }
    if (target.mappingWillBeRepaired) {
      deps.store.upsertMapping(context.issue.number, target.planeWorkItemId);
      report.repaired += 1;
    }
  }

  const completedAt = runStartedAt.toISOString();
  deps.store.setCursors([
    { key: CURSOR_KEY, value: completedAt },
    { key: LAST_SUCCESS_KEY, value: completedAt },
  ]);
  report.cursorAdvancedTo = completedAt;
  return report;
}
