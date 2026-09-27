export const RELEASE_TIMELINE_PHASES = [
  { key: "strategy_lock", label: "Strategy & lock", startWeeks: -20, endWeeks: -14 },
  { key: "assets_metadata", label: "Masters, artwork & metadata", startWeeks: -16, endWeeks: -8 },
  { key: "distribution_dsp", label: "Distribution & DSP setup", startWeeks: -10, endWeeks: -4 },
  { key: "campaign_rollout", label: "Campaign rollout", startWeeks: -8, endWeeks: -1 },
  { key: "release_week", label: "Release week", startWeeks: -1, endWeeks: 1 },
  { key: "post_release", label: "Post-release", startWeeks: 1, endWeeks: 8 },
] as const;

export type ReleaseTimelinePhaseKey = (typeof RELEASE_TIMELINE_PHASES)[number]["key"];
export type ReleaseTimelineHealth = "blocked" | "attention" | "on_track" | "not_started" | "complete";
export type ReleaseTimelineMilestone = { id: string; title: string; phase: ReleaseTimelinePhaseKey; dueDate: string | null; status: string; owner: string | null; isBlocking: boolean; notes: string | null };
export type ReleaseTimelineTask = { id: string; title: string; phase: ReleaseTimelinePhaseKey | null; dueDate: string | null; status: string; priority: string | null; owner: string | null; milestoneId: string | null; offsetDays?: number | null; workbackKey?: string | null; updatedAt?: string | null; assigneeIds?: string[]; labels?: string[]; dependencyIds?: string[] };
export type ReleaseTimelineBudgetItem = { id: string; name: string; phase: string | null; planned: number; committed: number; paid: number };
export type ReleaseTimelineBudget = { planned: number; committed: number; paid: number };
export type ReleaseTimelineChildRelease = { id: string; title: string; releaseDate: string | null; status: string | null; ready: boolean | null };
export type ReleaseTimelinePhase = {
  key: ReleaseTimelinePhaseKey;
  label: string;
  startDate: string | null;
  endDate: string | null;
  health: ReleaseTimelineHealth;
  milestones: ReleaseTimelineMilestone[];
  tasks: ReleaseTimelineTask[];
  budgetItems: ReleaseTimelineBudgetItem[];
  childReleases: ReleaseTimelineChildRelease[];
  budget: ReleaseTimelineBudget;
  completeCount: number;
  totalCount: number;
};
export type ReleaseTimeline = { planningOptions?: import("../components/ops-tasks/TaskPlanningFields").TaskPlanningOptions; releaseDate: string | null; today: string; currentPhaseKey: ReleaseTimelinePhaseKey | null; phases: ReleaseTimelinePhase[]; unphasedTasks?: ReleaseTimelineTask[]; unallocatedBudget: ReleaseTimelineBudget };

const budgetPhaseMap: Record<string, ReleaseTimelinePhaseKey> = {
  pre_pro: "strategy_lock",
  recording: "strategy_lock",
  post_pro: "assets_metadata",
  setup: "assets_metadata",
  singles: "campaign_rollout",
  release_week: "release_week",
  post_release: "post_release",
};

const doneStatuses = new Set(["done", "complete", "completed", "cancelled", "canceled"]);
export const openStatus = (status: string | null | undefined) => !doneStatuses.has((status ?? "todo").toLowerCase());
const hasOwner = (owner: string | null) => Boolean(owner?.trim());
const ymd = (date: Date) => date.toISOString().slice(0, 10);
const dateAtWeeks = (releaseDate: string, weeks: number) => {
  const date = new Date(`${releaseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return ymd(date);
};
const sumBudget = (items: ReleaseTimelineBudgetItem[]): ReleaseTimelineBudget => items.reduce((sum, item) => ({ planned: sum.planned + item.planned, committed: sum.committed + item.committed, paid: sum.paid + item.paid }), { planned: 0, committed: 0, paid: 0 });
const isSoon = (dueDate: string | null, today: string) => dueDate != null && dueDate >= today && dueDate <= ymd(new Date(new Date(`${today}T12:00:00Z`).getTime() + 7 * 86_400_000));

export function buildReleaseTimeline(input: { releaseDate: string | null; today: string; milestones: ReleaseTimelineMilestone[]; tasks: ReleaseTimelineTask[]; budgetItems: ReleaseTimelineBudgetItem[]; childReleases?: ReleaseTimelineChildRelease[] }): ReleaseTimeline {
  const phases = RELEASE_TIMELINE_PHASES.map((definition) => {
    const milestones = input.milestones.filter((milestone) => milestone.phase === definition.key);
    const tasks = input.tasks.filter((task) => task.phase === definition.key);
    const budgetItems = input.budgetItems.filter((item) => item.phase != null && budgetPhaseMap[item.phase] === definition.key);
    const childReleases = definition.key === "campaign_rollout" ? (input.childReleases ?? []).slice().sort((a, b) => (a.releaseDate ?? "9999-12-31").localeCompare(b.releaseDate ?? "9999-12-31")) : [];
    const budget = sumBudget(budgetItems);
    const tracked = [...milestones, ...tasks];
    const completeCount = tracked.filter((item) => !openStatus(item.status)).length;
    const blockingOverdue = tracked.some((item) => item.status.toLowerCase() === "blocked") || milestones.some((item) => item.isBlocking && openStatus(item.status) && item.dueDate != null && item.dueDate < input.today)
      || tasks.some((item) => openStatus(item.status) && item.dueDate != null && item.dueDate < input.today && ["P0", "P1"].includes(item.priority ?? ""));
    const needsAttention = milestones.some((item) => openStatus(item.status) && (!hasOwner(item.owner) || !item.dueDate || item.dueDate < input.today || isSoon(item.dueDate, input.today)))
      || tasks.some((item) => openStatus(item.status) && (!(hasOwner(item.owner) || item.assigneeIds?.length) || !item.dueDate || item.dueDate < input.today || isSoon(item.dueDate, input.today)))
      || (budget.planned > 0 && budget.committed / budget.planned >= 0.9);
    const health: ReleaseTimelineHealth = blockingOverdue ? "blocked"
      : needsAttention ? "attention"
      : tracked.length > 0 && completeCount === tracked.length ? "complete"
      : tracked.length > 0 || budget.planned > 0 || budget.committed > 0 || budget.paid > 0 ? "on_track"
      : "not_started";
    return {
      key: definition.key,
      label: definition.label,
      startDate: input.releaseDate ? dateAtWeeks(input.releaseDate, definition.startWeeks) : null,
      endDate: input.releaseDate ? dateAtWeeks(input.releaseDate, definition.endWeeks) : null,
      health,
      milestones,
      tasks,
      budgetItems,
      childReleases,
      budget,
      completeCount,
      totalCount: tracked.length,
    };
  });
  const currentPhaseKey = input.releaseDate
    ? phases.find((phase) => phase.startDate != null && phase.endDate != null && phase.startDate <= input.today && input.today <= phase.endDate)?.key ?? null
    : null;
  return { releaseDate: input.releaseDate, today: input.today, currentPhaseKey, phases, unphasedTasks: input.tasks.filter((task) => !task.phase), unallocatedBudget: sumBudget(input.budgetItems.filter((item) => item.phase == null || budgetPhaseMap[item.phase] == null)) };
}
