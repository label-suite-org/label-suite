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

  test.each(["linked_artist_id", "linked_release_id", "linked_campaign_id", "linked_contact_id", "owner_contact_id", "project_id"] as const)("rejects foreign %s links on create and update", async (field) => {
    mocks.selectRows.push([]);
    await expect(createOpsTask("org-1", { task_name: "Local task", [field]: "foreign-record" })).rejects.toThrow("not found in active workspace");
    mocks.selectRows.push([{ id: "task-1", revision: 0 }], []);
    await expect(updateOpsTask("org-1", { id: "task-1", [field]: "foreign-record" })).rejects.toThrow("not found in active workspace");
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updated).toHaveLength(0);
  });

  test("preserves valid workspace links and allows clearing them", async () => {
    const links = { linked_artist_id: "artist", linked_release_id: "release", linked_campaign_id: "campaign", linked_contact_id: "contact", owner_contact_id: "owner", project_id: "project" };
    mocks.selectRows.push(...Object.values(links).map((id) => [{ id }]));
    await createOpsTask("org-1", { task_name: "Linked task", ...links });
    expect(mocks.inserted[0]).toMatchObject(links);
    mocks.selectRows.push([{ id: "task-1", revision: 0 }], ...Object.values(links).map((id) => [{ id }]), [{ id: "task-1", revision: 0 }]);
    await updateOpsTask("org-1", { id: "task-1", ...links });
    expect(mocks.updated.at(-1)).toMatchObject(links);
    const cleared = Object.fromEntries(Object.keys(links).map((key) => [key, null]));
    mocks.selectRows.push([{ id: "task-1", revision: 0 }], [{ id: "task-1", revision: 0 }]);
    await updateOpsTask("org-1", { id: "task-1", ...cleared });
    expect(mocks.updated.at(-1)).toMatchObject(cleared);
  });

  test("rejects a milestone belonging to another release", async () => {
    mocks.selectRows.push([{ id: "milestone-1", release_id: "release-2" }]);
    await expect(createOpsTask("org-1", { task_name: "Send delivery", linked_release_id: "release-1", release_milestone_id: "milestone-1" })).rejects.toThrow("Release milestone not found");
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  test("persists a milestone link when it belongs to the task release", async () => {
    mocks.selectRows.push([{ id: "milestone-1", release_id: "release-1" }], [{ id: "release-1" }]);
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
