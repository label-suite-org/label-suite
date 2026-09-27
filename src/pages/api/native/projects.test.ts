import { beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const service = vi.hoisted(() => ({ listNativeProjects: vi.fn(), createNativeProject: vi.fn(), nativeCreateProjectSchema: { safeParse: vi.fn((value: unknown) => ({ success: true, data: value })) } }));
vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/native-session", () => sessions);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/native-events-projects", () => service);
import { GET, POST } from "./projects";
describe("native Project root", () => {
  beforeEach(() => { vi.clearAllMocks(); sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null); native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } }); service.listNativeProjects.mockResolvedValue({ items: [{ record_type: "project", id: "same-id", name: "Workstream", goal: "Ship", status: "active", next_action: null }], next_cursor: null }); });
  it("uses a distinct Project contract rather than inferring type from a shared id", async () => { const response = await GET({ request: new Request("https://suite.test/api/native/projects") } as never); expect(response.status).toBe(200); expect((await response.json()).items[0].record_type).toBe("project"); expect(service.listNativeProjects).toHaveBeenCalledWith("org-a", expect.any(Object)); });
  it("does not let read-only members create a project", async () => { native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } }); const response = await POST({ request: new Request("https://suite.test/api/native/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "No" }) }) } as never); expect(response.status).toBe(403); expect(service.createNativeProject).not.toHaveBeenCalled(); });
  it("allows fundraiser create through the canonical projects capability", async () => { native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "fundraiser" } }); service.createNativeProject.mockResolvedValue({ id: "project-new" }); const response = await POST({ request: new Request("https://suite.test/api/native/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Fundraiser project" }) }) } as never); expect(response.status).toBe(201); expect(service.createNativeProject).toHaveBeenCalledWith("org-a", expect.objectContaining({ name: "Fundraiser project" }), "user-a"); });
  it("distinguishes revoked workspace access from an expired session before reading or writing", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    sessions.bearerToken.mockReturnValue("fixture-token");
    sessions.getNativeSession.mockResolvedValue({ userId: "user-a" });
    for (const [method, handler] of [["GET", GET], ["POST", POST]] as const) {
      const response = await handler({ params: { id: "record" }, request: new Request("https://suite.test/api/native/projects", { method }) } as never);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    }
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
    sessions.getNativeSession.mockResolvedValue(null);
    expect((await GET({ params: { id: "record" }, request: new Request("https://suite.test/api/native/projects") } as never)).status).toBe(401);
  });

});
