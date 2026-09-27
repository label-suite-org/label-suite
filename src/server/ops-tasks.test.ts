import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectRows: Array<Array<Record<string, unknown>>> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const existingRows: Array<Record<string, unknown>> = [];
  const updateRows: Array<Record<string, unknown>> = [];
  const db = {
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback(db)),
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => selectRows.length ? selectRows.shift()! : existingRows),
      })),
    })),
    insert: vi.fn(() => ({ values: vi.fn((value: Record<string, unknown>) => ({ onConflictDoNothing: vi.fn(async () => inserted.push(value)) })) })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        updated.push(value);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => updateRows.length ? updateRows.shift()! : [{ id: "updated" }]) })) };
      }),
    })),
  };
  return { db, inserted, selectRows, updated, existingRows, updateRows };
});

vi.mock("../lib/db", () => ({ db: mocks.db }));

import { createOpsTask, createOpsTaskSchema, updateOpsTask } from "./ops-tasks";

describe("release-linked ops tasks", () => {
  beforeEach(() => {
    mocks.inserted.length = 0;
    mocks.selectRows.length = 0;
    mocks.updated.length = 0;
    mocks.existingRows.length = 0;
    mocks.updateRows.length = 0;
    vi.clearAllMocks();
  });

  test("rejects a milestone belonging to another release", async () => {
    mocks.selectRows.push([{ id: "milestone-1", release_id: "release-2" }]);
    await expect(createOpsTask("org-1", { task_name: "Send delivery", linked_release_id: "release-1", release_milestone_id: "milestone-1" })).rejects.toThrow("Release milestone not found");
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("persists a milestone link when it belongs to the task release", async () => {
    mocks.selectRows.push([{ id: "milestone-1", release_id: "release-1" }]);
    const result = await createOpsTask("org-1", { task_name: "Send delivery", linked_release_id: "release-1", release_milestone_id: "milestone-1" });
    expect(result.ok).toBe(true);
    expect(mocks.inserted[0]).toMatchObject({ linked_release_id: "release-1", release_milestone_id: "milestone-1" });
  });

  test("persists an event link when the event belongs to the active workspace", async () => {
    mocks.selectRows.push([{ id: "event-1" }]);
    const result = await createOpsTask("org-1", { task_name: "Confirm load-in", event_id: "event-1" });
    expect(result.ok).toBe(true);
    expect(mocks.inserted[0]).toMatchObject({ event_id: "event-1" });
  });

  test("rejects an event link outside the active workspace", async () => {
    mocks.selectRows.push([]);
    await expect(createOpsTask("org-1", { task_name: "Confirm load-in", event_id: "other-event" })).rejects.toThrow("Event not found");
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("updates an event link after validating the task and target event", async () => {
    mocks.selectRows.push([{ id: "task-1", status: "todo", due_date: null, linked_release_id: null, release_milestone_id: null }], [{ id: "event-1" }], [{ id: "task-1", event_id: null, revision: 0 }]);
    await updateOpsTask("org-1", { id: "task-1", event_id: "event-1" });
    expect(mocks.updated[0]).toMatchObject({ event_id: "event-1" });
  });

  test("rejects an unknown release timeline phase", () => {
    expect(createOpsTaskSchema.safeParse({ task_name: "Send delivery", timeline_phase: "unknown" }).success).toBe(false);
  });
});

test("changing a deadline from the Tasks page converts it to a fixed date", async () => {
  mocks.selectRows.push([{ id: "relative", status: "todo", due_date: "2026-09-01", release_offset_days: -28, linked_release_id: "release-1", release_milestone_id: null }], [{ id: "relative", due_date: "2026-09-01", revision: 0 }]);
  await updateOpsTask("org-1", { id: "relative", due_date: "2026-09-02" });
  expect(mocks.updated.at(-1)).toMatchObject({ due_date: "2026-09-02", release_offset_days: null });
});

describe("task planning validation", () => {
  beforeEach(() => { mocks.selectRows.length = 0; mocks.existingRows.length = 0; mocks.inserted.length = 0; mocks.updated.length = 0; });
  test("rejects a foreign assignee and a foreign dependency without writing", async () => {
    mocks.selectRows.push([]);
    await expect(createOpsTask("org-1", { task_name: "Upload", assignee_ids: ["foreign-user"] })).rejects.toThrow("eligible workspace members");
    mocks.selectRows.push([]);
    await expect(createOpsTask("org-1", { task_name: "Upload", dependency_ids: ["foreign-task"] })).rejects.toThrow("tasks in this workspace");
    expect(mocks.inserted).toHaveLength(0);
  });
  test.each(["member", "fundraiser", "payee"])("preserves existing assignment eligibility for %s", async (role) => {
    mocks.selectRows.push([{ id: "assigned-user", role }]);
    await createOpsTask("org-1", { task_name: "Upload", assignee_ids: ["assigned-user"] });
    expect(mocks.inserted[0]).toMatchObject({ assignee_ids: ["assigned-user"] });
  });
  test("rejects a dependency cycle and keeps valid member, label and dependency selections", async () => {
    mocks.selectRows.push([{ id: "a" }], [{ id: "a", dependencies: [] }, { id: "b", dependencies: ["a"] }]);
    await expect(updateOpsTask("org-1", { id: "a", dependency_ids: ["b"] })).rejects.toThrow("depend on itself");
    mocks.selectRows.push([{ id: "maya", role: "operator" }, { id: "malthe", role: "owner" }], [{ id: "master", dependencies: [] }]);
    await createOpsTask("org-1", { id: "upload", task_name: "Upload", assignee_ids: ["maya", "malthe"], labels: ["Audio"], dependency_ids: ["master"] });
    expect(mocks.inserted[0]).toMatchObject({ assignee_ids: ["maya", "malthe"], labels: ["Audio"], dependency_ids: ["master"] });
  });
});
