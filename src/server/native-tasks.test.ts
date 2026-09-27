import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selected: Array<Array<Record<string, unknown>>> = [];
  const writes: Array<Record<string, unknown>> = [];
  const db = {
    transaction: vi.fn(async (operation: (tx: unknown) => unknown) => operation(db)),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => {
      const rows = selected.shift() ?? [];
      return { limit: vi.fn(async () => rows), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
    }) })) })), 
    update: vi.fn(() => ({ set: vi.fn((value: Record<string, unknown>) => { writes.push(value); return { where: vi.fn(() => ({ returning: vi.fn(async () => selected.shift() ?? []) })) }; }) })),
  };
  return { db, selected, writes };
});
const audit = vi.hoisted(() => ({ recordAuditEvent: vi.fn() }));
vi.mock("../lib/db", () => ({ db: mocks.db }));
vi.mock("./integrations", () => audit);

import { executeNativeTaskAction } from "./native-tasks";

const task = { id: "task-a", org_id: "org-a", status: "todo", due_date: "2026-09-20", assignee_ids: ["user-a"], revision: 4, is_overdue: false };

describe("canonical native Task actions", () => {
  beforeEach(() => { mocks.selected.length = 0; mocks.writes.length = 0; vi.clearAllMocks(); audit.recordAuditEvent.mockResolvedValue({ id: "audit-a" }); });

  it.each(["canonical web update", "canonical system update"])("rejects a stale action after a %s", async () => {
    mocks.selected.push([{ ...task, status: "done", revision: 5 }]);
    await expect(executeNativeTaskAction("org-a", "task-a", { action: "complete", expected_revision: 4 }, "actor-a")).rejects.toMatchObject({ status: 409 });
    expect(mocks.writes).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("checks staleness before validating a no-op reassignment", async () => {
    mocks.selected.push([{ ...task, revision: 5, assignee_ids: ["payee-user"] }]);
    await expect(executeNativeTaskAction("org-a", "task-a", { action: "reassign", expected_revision: 4, assignee_ids: ["payee-user"] }, "actor-a")).rejects.toMatchObject({ status: 409 });
    expect(mocks.writes).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("returns no_change without writing or auditing for a current no-op action", async () => {
    mocks.selected.push([{ ...task, status: "done" }], [{ ...task, status: "done" }]);
    await expect(executeNativeTaskAction("org-a", "task-a", { action: "complete", expected_revision: 4 }, "actor-a"))
      .resolves.toMatchObject({ action: "complete", no_change: true, task: { revision: 4, status: "done" } });
    expect(mocks.writes).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("rejects a foreign assignee before writing or auditing", async () => {
    mocks.selected.push([task], []);
    await expect(executeNativeTaskAction("org-a", "task-a", { action: "reassign", expected_revision: 4, assignee_ids: ["foreign-user"] }, "actor-a")).rejects.toThrow("eligible workspace members");
    expect(mocks.writes).toHaveLength(0);
    expect(audit.recordAuditEvent).not.toHaveBeenCalled();
  });

  it.each(["member", "fundraiser", "payee"])("preserves canonical %s assignee eligibility without granting actor permission", async (role) => {
    mocks.selected.push([task], [{ id: "assigned-user", role }], [{ ...task, assignee_ids: ["assigned-user"], revision: 5 }]);
    const result = await executeNativeTaskAction("org-a", "task-a", { action: "reassign", expected_revision: 4, assignee_ids: ["assigned-user"] }, "actor-a");
    expect(result.task.assignee_ids).toEqual(["assigned-user"]);
    expect(audit.recordAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("updates only an action field, increments revision, and records matching audit metadata", async () => {
    mocks.selected.push([task], [{ id: "user-b", role: "operator" }], [{ ...task, assignee_ids: ["user-b"], revision: 5 }]);
    const result = await executeNativeTaskAction("org-a", "task-a", { action: "reassign", expected_revision: 4, assignee_ids: ["user-b"] }, "actor-a");
    expect(result).toMatchObject({ action: "reassign", no_change: false, task: { revision: 5, assignee_ids: ["user-b"] }, consequence: { assignee_ids: ["user-b"] } });
    expect(mocks.writes[0]).toMatchObject({ assignee_ids: ["user-b"] });
    expect(mocks.writes[0]).not.toHaveProperty("status");
    expect(mocks.writes[0]).not.toHaveProperty("revision");
    expect(audit.recordAuditEvent).toHaveBeenCalledWith("org-a", expect.objectContaining({ event_type: "task.reassign", actor_user_id: "actor-a", metadata: expect.objectContaining({ expected_revision: 4, resulting_revision: 5 }) }), mocks.db);
  });
});
