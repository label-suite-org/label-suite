import { describe, expect, it } from "vitest";
import { buildReleaseTimeline, type ReleaseTimelineTask } from "./release-timeline-core";
import { dateAtOffset, reschedulePreview, workBucket } from "./release-workback-core";
const task = (patch: Partial<ReleaseTimelineTask> = {}): ReleaseTimelineTask => ({ id: "task", title: "Deliver masters", phase: null, dueDate: "2026-09-01", status: "todo", owner: "Malthe", priority: "P2", milestoneId: null, ...patch });

describe("release workback", () => {
  it("keeps unphased tasks and marks ordinary overdue and blocked work for attention", () => {
    const timeline = buildReleaseTimeline({ releaseDate: "2026-10-23", today: "2026-09-15", tasks: [task(), task({ id: "overdue", phase: "assets_metadata" }), task({ id: "blocked", phase: "distribution_dsp", status: "blocked", dueDate: "2026-10-01" })], milestones: [], budgetItems: [] });
    expect(timeline.unphasedTasks).toEqual([task()]);
    expect(timeline.phases.find((phase) => phase.key === "assets_metadata")?.health).toBe("attention");
    expect(timeline.phases.find((phase) => phase.key === "distribution_dsp")?.health).toBe("blocked");
  });
  it("classifies calendar deadlines and only reschedules open relative tasks", () => {
    expect(dateAtOffset("2028-03-01", -1)).toBe("2028-02-29");
    expect(workBucket(task({ dueDate: "2026-09-15" }), "2026-09-15")).toBe("Next 7 days");
    expect(workBucket(task({ dueDate: null }), "2026-09-15")).toBe("Unscheduled");
    expect(workBucket(task({ status: "Canceled" }), "2026-09-15")).toBe("Done");
    expect(reschedulePreview([task({ offsetDays: -28 }), task({ id: "fixed" }), task({ id: "done", offsetDays: -28, status: "done" })], "2026-10-23")).toEqual([expect.objectContaining({ id: "task", dueDate: "2026-09-01", newDate: "2026-09-25" })]);
    expect(reschedulePreview([task({ offsetDays: -28 })], null)).toEqual([]);
  });
});
