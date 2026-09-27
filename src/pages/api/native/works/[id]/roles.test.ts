import { beforeEach, describe, expect, it, vi } from "vitest";
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const service = vi.hoisted(() => ({ createNativeWorkRole: vi.fn(), updateNativeWorkRole: vi.fn() }));
vi.mock("../../../../../lib/native-workspace", () => actor);
vi.mock("../../../../../lib/native-session", () => sessions);
vi.mock("../../../../../lib/db", () => database);
vi.mock("../../../../../server/native-works", async (original) => ({ ...await original<typeof import("../../../../../server/native-works")>(), ...service }));
import { POST } from "./roles";
import { PATCH } from "./roles/[roleId]";
const create = { contact_id: "person-a", role: "Writer", ownership_type: "Rights", scope: "Publishing", percent_share: 50, clearance_status: "Unknown", expected_work_revision: "work-r1" };
const context = (method: string, body: unknown) => ({ params: { id: "work-a", roleId: "role-a" }, request: new Request("https://suite.test/api/native/works/work-a/roles/role-a?workspaceId=ignored", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) }) as never;
describe("native Work role mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actor.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    service.createNativeWorkRole.mockResolvedValue({ work: { id: "work-a" } });
    service.updateNativeWorkRole.mockResolvedValue({ work: { id: "work-a" } });
  });
  it("takes workspace and actor from authentication and canonical identities from the route", async () => {
    expect((await POST(context("POST", create))).status).toBe(201);
    expect(service.createNativeWorkRole).toHaveBeenCalledWith("org-a", "work-a", create, "actor-a");
    const update = { role: "Co-writer", expected_revision: "role-r1" };
    expect((await PATCH(context("PATCH", update))).status).toBe(200);
    expect(service.updateNativeWorkRole).toHaveBeenCalledWith("org-a", "work-a", "role-a", update, "actor-a");
  });
  it("rejects invalid ownership, injected identities, missing revisions and empty updates", async () => {
    expect((await POST(context("POST", { ...create, ownership_type: "Invalid" }))).status).toBe(400);
    for (const update of [{ role: "Missing revision" }, { expected_revision: "r1" }, { expected_revision: "r1", work_id: "other" }, { expected_revision: "r1", percent_share: 101 }]) expect((await PATCH(context("PATCH", update))).status).toBe(400);
    expect(service.createNativeWorkRole).not.toHaveBeenCalled(); expect(service.updateNativeWorkRole).not.toHaveBeenCalled();
  });
  it("denies non-operators and distinguishes removed workspace access from expired sign-in", async () => {
    actor.resolveNativeActor.mockResolvedValue({ userId: "actor-a", workspace: { org: { id: "org-a" }, role: "member" } });
    expect((await POST(context("POST", create))).status).toBe(403);
    expect((await PATCH(context("PATCH", { role: "Denied", expected_revision: "r1" }))).status).toBe(403);
    actor.resolveNativeActor.mockResolvedValue(null);
    expect((await POST(context("POST", create))).status).toBe(401);
    sessions.bearerToken.mockReturnValue("fixture-token"); sessions.getNativeSession.mockResolvedValue({ user: { id: "actor-a" } });
    const denied = await PATCH(context("PATCH", { role: "Denied", expected_revision: "r1" }));
    expect(denied.status).toBe(403); expect(await denied.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  });
});
