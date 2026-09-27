import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
const mock = vi.hoisted(() => {
  const state = { release: [{ date: "2026-10-23" }] as Record<string, unknown>[], tasks: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], clauses: [] as unknown[], selects: 0 };
  const tx = {
    select: () => ({ from: () => ({ where: (clause: unknown) => { state.clauses.push(clause); return { for: async () => state.selects++ % 2 === 0 ? state.release : state.tasks }; } }) }),
    insert: () => ({ values: async (values: Record<string, unknown>) => { state.tasks.push(values); state.writes.push(values); } }),
    update: () => ({ set: (values: Record<string, unknown>) => ({ where: async (clause: unknown) => { state.clauses.push(clause); state.writes.push(values); } }) }),
  };
  return { state, db: { transaction: async (fn: (arg: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("../lib/db", () => ({ db: mock.db }));
vi.mock("./release-timeline", () => ({ getReleaseTimeline: vi.fn(async () => ({ phases: [] })) }));
import { applyReleaseWorkback, workbackSchema } from "./release-workback";
import { reschedulePreview } from "./release-workback-core";
const apply = { action: "apply" as const, releaseId: "release-1", releaseDate: "2026-10-23", items: [{ key: "masters", title: "Approve final masters", phase: "assets_metadata" as const, owner: "Malthe", dueDate: "2026-09-11", offsetDays: -42 }] };

describe("workback writes", () => {
  beforeEach(() => { mock.state.release = [{ date: "2026-10-23" }]; mock.state.tasks = []; mock.state.writes = []; mock.state.clauses = []; mock.state.selects = 0; });
  it("reuses matching tasks and serializes repeated applications under the release lock", async () => {
    expect(await applyReleaseWorkback("org-a", apply)).toMatchObject({ created: 1, reused: 0 });
    expect(await applyReleaseWorkback("org-a", apply)).toMatchObject({ created: 0, reused: 1 });
    expect(mock.state.writes).toHaveLength(1);
    expect(mock.state.writes[0]).toMatchObject({ org_id: "org-a", linked_release_id: "release-1", due_date: "2026-09-11", release_offset_days: -42 });
    for (const clause of mock.state.clauses) expect(new PgDialect().sqlToQuery(clause as SQL).params).toEqual(expect.arrayContaining(["org-a", "release-1"]));
  });
  it("keeps a manually created matching task unchanged", async () => {
    mock.state.tasks = [{ task_name: "  Approve FINAL masters ", due_date: "2026-09-19" }];
    expect(await applyReleaseWorkback("org-a", apply)).toMatchObject({ created: 0, reused: 1 });
    expect(mock.state.writes).toHaveLength(0);
  });
  it("rejects missing releases and stale dates before writes", async () => {
    await expect(applyReleaseWorkback("org-a", { ...apply, releaseDate: "2026-11-01" })).rejects.toThrow("Release date changed");
    mock.state.selects = 0; mock.state.release = [];
    await expect(applyReleaseWorkback("org-b", apply)).rejects.toThrow("Release not found");
    expect(mock.state.writes).toHaveLength(0);
  });
  it("applies a current preview and rejects changed tasks before writing any dates", async () => {
    mock.state.tasks = [{ id: "task", task_name: "Master", due_date: "2026-09-01", status: "todo", release_offset_days: -28, updated_at: new Date("2026-09-01T00:00:00Z") }, { id: "fixed", task_name: "Fixed", due_date: "2026-09-01", status: "todo", release_offset_days: null }];
    const preview = reschedulePreview([{ id: "task", title: "Master", dueDate: "2026-09-01", status: "todo", phase: null, owner: null, priority: null, milestoneId: null, offsetDays: -28, updatedAt: "2026-09-01T00:00:00.000Z" }], "2026-10-23");
    expect(await applyReleaseWorkback("org-a", { action: "reschedule", releaseId: "release-1", releaseDate: "2026-10-23", preview })).toMatchObject({ rescheduled: 1 });
    expect(mock.state.writes).toEqual([expect.objectContaining({ due_date: "2026-09-25" })]);
    mock.state.writes = []; mock.state.tasks[0].status = "done";
    await expect(applyReleaseWorkback("org-a", { action: "reschedule", releaseId: "release-1", releaseDate: "2026-10-23", preview })).rejects.toThrow("Tasks changed");
    expect(mock.state.writes).toHaveLength(0);
  });
  it("validates checklist keys and real dates at the API boundary", () => {
    expect(workbackSchema.safeParse({ ...apply, releaseDate: "2026-02-30" }).success).toBe(false);
    expect(workbackSchema.safeParse({ ...apply, items: [{ ...apply.items[0], key: "invented" }] }).success).toBe(false);
  });
});
