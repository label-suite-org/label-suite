import { beforeEach, describe, expect, it, vi } from "vitest";

const sessions = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
const members = vi.hoisted(() => ({ listWorkspaceMembers: vi.fn(async () => [{ userId: "member-a", name: "Maya", email: "private@example.test" }]) }));
vi.mock("../../../../server/member-invitations", () => members);
vi.mock("../../../../lib/native-session", () => ({ getNativeSession: sessions.getNativeSession, bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null }));
const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const tasks = vi.hoisted(() => ({ canonicalTask: vi.fn(), executeNativeTaskAction: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/native-tasks", async () => {
  const { z } = await import("zod");
  return {
    ...tasks,
    nativeTaskActionSchema: z.discriminatedUnion("action", [
      z.object({ action: z.literal("complete"), expected_revision: z.number().int().nonnegative() }),
      z.object({ action: z.literal("defer"), expected_revision: z.number().int().nonnegative(), due_date: z.string().date() }),
      z.object({ action: z.literal("reschedule"), expected_revision: z.number().int().nonnegative(), due_date: z.string().date() }),
      z.object({ action: z.literal("reassign"), expected_revision: z.number().int().nonnegative(), assignee_ids: z.array(z.string()).min(1) }),
    ]),
  };
});

import { GET, POST } from "./[id]";

describe("native Task detail and actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    tasks.canonicalTask.mockResolvedValue({ task: { id: "task-a", revision: 4 }, relationships: [] });
    tasks.executeNativeTaskAction.mockResolvedValue({ task: { id: "task-a", revision: 5 }, action: "complete", consequence: { status: "done" } });
  });

  const request = (method: string, body?: unknown) => new Request("https://suite.test/api/native/tasks/task-a?workspaceId=org-a", {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });

  it("returns only the tenant-scoped canonical task detail", async () => {
    const response = await GET({ request: request("GET"), params: { id: "task-a" } } as never);
    expect(response.status).toBe(200);
    expect(tasks.canonicalTask).toHaveBeenCalledWith("org-a", "task-a");
    expect(members.listWorkspaceMembers).toHaveBeenCalledWith("org-a");
    await expect(response.json()).resolves.toMatchObject({ assignee_options: [{ id: "member-a", name: "Maya" }] });
  });

  it("uses canonical task action authority and returns explicit consequence metadata", async () => {
    const response = await POST({ request: request("POST", { action: "complete", expected_revision: 4 }), params: { id: "task-a" } } as never);
    expect(response.status).toBe(200);
    expect(tasks.executeNativeTaskAction).toHaveBeenCalledWith("org-a", "task-a", { action: "complete", expected_revision: 4 }, "user-a");
    await expect(response.json()).resolves.toMatchObject({ action: "complete", consequence: { status: "done" } });
  });

  it("does not invoke canonical mutations for a read-only workspace member", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    const response = await POST({ request: request("POST", { action: "complete", expected_revision: 4 }), params: { id: "task-a" } } as never);
    expect(response.status).toBe(403);
    expect(tasks.executeNativeTaskAction).not.toHaveBeenCalled();
  });

  it("maps a rejected canonical service promise to its API error response", async () => {
    const { HttpError } = await import("../../../../server/errors");
    tasks.executeNativeTaskAction.mockRejectedValueOnce(new HttpError("Task changed before this action could be saved", 409));
    const response = await POST({ request: request("POST", { action: "complete", expected_revision: 4 }), params: { id: "task-a" } } as never);
    expect(response.status).toBe(409);
  });
});

it.each([GET, POST])("distinguishes lost workspace access and denies payees", async (handler) => {
  vi.clearAllMocks();
  const invoke = () => handler({ request: new Request("https://suite.test/api/native/tasks/task-a?workspaceId=org-a", { headers: { authorization: "Bearer token" } }), params: { id: "task-a" } } as never);
  native.resolveNativeActor.mockResolvedValue(null);
  sessions.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
  const revoked = await invoke();
  expect(revoked.status).toBe(403);
  await expect(revoked.json()).resolves.toMatchObject({ code: "workspace_access_removed" });
  sessions.getNativeSession.mockResolvedValue(null);
  expect((await invoke()).status).toBe(401);
  native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "payee" } });
  expect((await invoke()).status).toBe(403);
  expect(tasks.canonicalTask).not.toHaveBeenCalled();
  expect(tasks.executeNativeTaskAction).not.toHaveBeenCalled();
});
