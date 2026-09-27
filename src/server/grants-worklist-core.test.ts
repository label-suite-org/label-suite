import { describe, expect, it } from "vitest";
import { buildGrantsWorklist } from "./grants-worklist-core";

describe("buildGrantsWorklist", () => {
  it("creates one item per open application obligation and sorts overdue work first", () => {
    const items = buildGrantsWorklist({
      applications: [
        {
          id: "app-writing",
          name: "Writing application",
          projectId: "project-1",
          projectName: "Fountain",
          ownerName: "Malthe",
          workflowStage: "writing",
          outcome: "unknown",
          priority: "high",
          amountRequested: 20_000,
          amountAwarded: 0,
          applicationDeadline: "2026-07-30",
          nextAction: "Finish treatment",
          nextActionDue: "2026-07-15",
          reportingDue: null,
          checklist: [
            { id: "req-1", requirementName: "Budget", readinessStatus: "missing", required: true },
            { id: "req-2", requirementName: "Bio", readinessStatus: "ready", required: true },
          ],
        },
        {
          id: "app-awarded",
          name: "Awarded application",
          projectId: "project-2",
          projectName: "Lambs",
          ownerName: "Alex",
          workflowStage: "closed",
          outcome: "approved",
          priority: "medium",
          amountRequested: 50_000,
          amountAwarded: 40_000,
          applicationDeadline: null,
          nextAction: null,
          nextActionDue: null,
          reportingDue: "2026-07-20",
          checklist: [],
        },
      ],
      today: "2026-07-14",
      horizonDays: 30,
    });

    expect(items.map((item) => item.kind)).toEqual(["action", "reporting", "deadline", "materials"]);
    expect(items[0]).toMatchObject({
      applicationId: "app-writing",
      dueDate: "2026-07-15",
      amountAtStake: 20_000,
      priority: "high",
    });
    expect(items.find((item) => item.kind === "materials")).toMatchObject({ title: "Budget", dueDate: null });
  });

  it("keeps undated actions at the bottom and excludes decided non-reporting history", () => {
    const items = buildGrantsWorklist({
      applications: [
        {
          id: "app-undated",
          name: "Undated application",
          projectId: null,
          projectName: null,
          ownerName: null,
          workflowStage: "research",
          outcome: "unknown",
          priority: "low",
          amountRequested: 10_000,
          amountAwarded: 0,
          applicationDeadline: null,
          nextAction: "Confirm eligibility",
          nextActionDue: null,
          reportingDue: null,
          checklist: [],
        },
        {
          id: "app-history",
          name: "Old decision",
          projectId: null,
          projectName: null,
          ownerName: null,
          workflowStage: "closed",
          outcome: "rejected",
          priority: "urgent",
          amountRequested: 100_000,
          amountAwarded: 0,
          applicationDeadline: "2026-07-15",
          nextAction: "Should not appear",
          nextActionDue: "2026-07-15",
          reportingDue: null,
          checklist: [],
        },
      ],
      today: "2026-07-14",
      horizonDays: 30,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "action", dueDate: null, title: "Confirm eligibility" });
  });

  it("includes pending variance decisions and overdue funding-source decisions", () => {
    const items = buildGrantsWorklist({
      applications: [], today: "2026-07-14",
      varianceRequests: [{ id: "vr-1", lineName: "Studio", projectId: "p1", projectName: "Album", amountAtStake: 12_000 }],
      fundingSources: [{ id: "fs-1", name: "Export pool", projectId: "p1", projectName: "Album", status: "pending", deadline: "2026-07-10", amountPlanned: 20_000 }],
    });
    expect(items.map((item) => item.kind)).toEqual(["decision", "decision"]);
    expect(items.every((item) => item.applicationId === null && item.href === "/budget")).toBe(true);
  });
});
