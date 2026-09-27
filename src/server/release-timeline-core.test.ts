import { describe, expect, test } from "vitest";
import { buildReleaseTimeline } from "./release-timeline-core";

describe("release timeline core", () => {
  test("anchors phase dates to the release date", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [], tasks: [], budgetItems: [] });
    expect(timeline.phases[0]).toMatchObject({ key: "strategy_lock", startDate: "2026-07-04", endDate: "2026-08-15" });
    expect(timeline.currentPhaseKey).toBe("strategy_lock");
  });

  test("blocks a phase for an overdue blocking milestone", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [{ id: "m1", title: "Approve master", phase: "assets_metadata", dueDate: "2026-07-01", status: "todo", owner: null, isBlocking: true, notes: null }], tasks: [], budgetItems: [] });
    expect(timeline.phases.find((phase) => phase.key === "assets_metadata")?.health).toBe("blocked");
  });

  test("treats a whitespace-only owner as unassigned attention", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [{ id: "m1", title: "Approve master", phase: "assets_metadata", dueDate: "2026-08-20", status: "todo", owner: "  ", isBlocking: false, notes: null }], tasks: [], budgetItems: [] });
    expect(timeline.phases.find((phase) => phase.key === "assets_metadata")?.health).toBe("attention");
  });

  test("marks a phase as attention when committed budget reaches ninety percent", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [], tasks: [], budgetItems: [{ id: "b1", name: "Artwork", phase: "setup", planned: 500, committed: 450, paid: 0 }] });
    expect(timeline.phases.find((phase) => phase.key === "assets_metadata")?.health).toBe("attention");
  });

  test("puts budget without a mapped phase in the unallocated total", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [], tasks: [], budgetItems: [{ id: "b1", name: "Artwork", phase: "setup", planned: 500, committed: 480, paid: 100 }, { id: "b2", name: "Misc", phase: null, planned: 200, committed: 0, paid: 0 }] });
    expect(timeline.phases.find((phase) => phase.key === "assets_metadata")?.budget).toMatchObject({ planned: 500, committed: 480, paid: 100 });
    expect(timeline.unallocatedBudget).toMatchObject({ planned: 200, committed: 0, paid: 0 });
  });

  test("keeps an undated release usable without a current phase", () => {
    const timeline = buildReleaseTimeline({ releaseDate: null, today: "2026-07-12", milestones: [], tasks: [], budgetItems: [] });
    expect(timeline.currentPhaseKey).toBeNull();
    expect(timeline.phases[0]).toMatchObject({ startDate: null, endDate: null, health: "not_started" });
  });

  test("surfaces child singles in the parent campaign rollout", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-11-21", today: "2026-07-12", milestones: [], tasks: [], budgetItems: [], childReleases: [{ id: "single-1", title: "Fascinator", releaseDate: "2026-09-25", status: "scheduled", ready: false }] });
    expect(timeline.phases.find((phase) => phase.key === "campaign_rollout")?.childReleases).toEqual([expect.objectContaining({ id: "single-1", title: "Fascinator" })]);
  });
});
