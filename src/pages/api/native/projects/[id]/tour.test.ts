import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), session: vi.fn(), read: vi.fn(), enqueue: vi.fn(), scope: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
vi.mock("../../../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../../../lib/db", () => ({ runWithDatabaseContext: mocks.scope }));
vi.mock("../../../../../server/native-tour-dashboard", () => ({ getNativeTourDashboard: mocks.read }));
vi.mock("../../../../../server/jobs", () => ({ jobStore: { enqueue: mocks.enqueue } }));
import { GET, POST } from "./tour";
const request = (method = "GET") => ({ request: new Request("https://suite.test/api/native/projects/tour-1/tour?workspaceId=workspace", { method }), params: { id: "tour-1" } }) as never;
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ userId: "user", workspace: { org: { id: "org" }, role: "owner" } }); mocks.read.mockResolvedValue({ sync: { enabled: true } }); });
it("scopes reads to the authenticated workspace and disables response caching", async () => {
  const result = await GET(request());
  expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toContain("no-store");
  expect(mocks.scope).toHaveBeenCalledWith({ userId: "user", orgId: "org" }, expect.any(Function));
  expect(mocks.read).toHaveBeenCalledWith("org", "tour-1");
});
it("denies payee reads and read-only member sync", async () => {
  mocks.actor.mockResolvedValue({ userId: "user", workspace: { org: { id: "org" }, role: "payee" } });
  expect((await GET(request())).status).toBe(403);
  mocks.actor.mockResolvedValue({ userId: "user", workspace: { org: { id: "org" }, role: "member" } });
  expect((await POST(request("POST"))).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled();
});
it("queues a deduplicated server job only for an enabled tour", async () => {
  expect((await POST(request("POST"))).status).toBe(202);
  expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ orgId: "org", jobType: "tour_square_sync", payload: { projectId: "tour-1" }, idempotencyKey: expect.stringMatching(/^tour-1:/) }));
  mocks.enqueue.mockClear(); mocks.read.mockResolvedValue(null);
  expect((await POST(request("POST"))).status).toBe(404); expect(mocks.enqueue).not.toHaveBeenCalled();
});
it("distinguishes revoked workspace access from signed out", async () => {
  mocks.actor.mockResolvedValue(null); mocks.token.mockReturnValue("fixture"); mocks.session.mockResolvedValue({ userId: "user" });
  expect(await (await GET(request())).json()).toMatchObject({ code: "workspace_access_removed" });
  mocks.session.mockResolvedValue(null); expect((await GET(request())).status).toBe(401);
  expect(mocks.read).not.toHaveBeenCalled();
});
