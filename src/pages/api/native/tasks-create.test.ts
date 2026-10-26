import { beforeEach, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const context = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, fn: () => unknown) => fn()), db: {} }));
const tasks = vi.hoisted(() => ({ createOpsTask: vi.fn(), nativeTaskCreateOptions: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => actor);
vi.mock("../../../lib/db", () => context);
vi.mock("../../../lib/native-session", () => ({ bearerToken: () => null, getNativeSession: vi.fn() }));
vi.mock("../../../server/ops-tasks", async importOriginal => ({ ...await importOriginal<typeof import("../../../server/ops-tasks")>(), createOpsTask: tasks.createOpsTask }));
vi.mock("../../../server/native-tasks", async importOriginal => ({ ...await importOriginal<typeof import("../../../server/native-tasks")>(), nativeTaskCreateOptions: tasks.nativeTaskCreateOptions }));
import { GET, POST } from "./tasks";
const id = "029ed384-d12a-4c6c-a7f6-9fa0130b0946";
const request = (input: unknown) => ({ request: new Request("https://suite.test/api/native/tasks?workspaceId=foreign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }) }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  actor.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { org: { id: "org" }, role: "operator" } });
  tasks.createOpsTask.mockResolvedValue({ id, ok: true });
  tasks.nativeTaskCreateOptions.mockResolvedValue({ artists: [], truncated: false });
});
it("uses selected workspace actor, canonical creation and stable acknowledgement", async () => {
  const response = await POST(request({ id, task_name: "  Book rehearsal  ", due_date: "2027-01-02", assignee_ids: ["member"] }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id, ok: true });
  expect(tasks.createOpsTask).toHaveBeenCalledWith("org", { id, task_name: "Book rehearsal", due_date: "2027-01-02", priority: "P2", assignee_ids: ["member"] }, "actor");
  expect(context.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "actor", orgId: "org" }, expect.any(Function));
});
it.each([{ task_name: "Task" }, { id, task_name: "Task", org_id: "other" }, { id, task_name: "Task", priority: "urgent" }, { id, task_name: "Task", due_date: "2027-02-30" }, { id, task_name: "Task", status: "done" }])("rejects unsupported or invalid creation input", async input => {
  expect((await POST(request(input))).status).toBe(400);
  expect(tasks.createOpsTask).not.toHaveBeenCalled();
});
it("restricts choices and creation to operators", async () => {
  const get = { request: new Request("https://suite.test/api/native/tasks") } as never;
  expect((await GET(get)).status).toBe(200);
  expect(tasks.nativeTaskCreateOptions).toHaveBeenCalledWith("org");
  actor.resolveNativeActor.mockResolvedValue({ userId: "member", workspace: { org: { id: "org" }, role: "member" } });
  expect((await POST(request({ id, task_name: "Task" }))).status).toBe(403);
  expect((await GET(get)).status).toBe(403);
  expect(tasks.createOpsTask).not.toHaveBeenCalled();
});
it("maps collision without an acknowledgement", async () => {
  const { HttpError } = await import("../../../server/errors");
  tasks.createOpsTask.mockRejectedValueOnce(new HttpError("Collision", 409));
  expect((await POST(request({ id, task_name: "Task" }))).status).toBe(409);
});
