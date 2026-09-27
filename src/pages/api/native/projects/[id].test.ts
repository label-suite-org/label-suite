import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const service = vi.hoisted(() => ({ updateNativeProject: vi.fn(), nativeUpdateProjectSchema: { safeParse: vi.fn((value: unknown) => ({ success: true, data: value })) } }));
vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/native-session", () => sessions);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/native-events-projects", () => service);

import { GET, PATCH } from "./[id]";

describe("native Project detail mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "fundraiser" } });
    service.updateNativeProject.mockResolvedValue({ id: "url-project" });
  });

  it("uses the URL Project identity rather than a client-supplied body identity", async () => {
    const response = await PATCH({ params: { id: "url-project" }, request: new Request("https://suite.test/api/native/projects/url-project", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "body-project", name: "Changed", expected_revision: "2026-09-17 10:00:00+00" }) }) } as never);
    expect(response.status).toBe(200);
    expect(service.updateNativeProject).toHaveBeenCalledWith("org-a", expect.objectContaining({ id: "url-project", name: "Changed" }), "user-a");
  });

  it("denies read-only Project mutation without invoking the shared writer", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    const response = await PATCH({ params: { id: "url-project" }, request: new Request("https://suite.test/api/native/projects/url-project", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: "2026-09-17 10:00:00+00" }) }) } as never);
    expect(response.status).toBe(403);
    expect(service.updateNativeProject).not.toHaveBeenCalled();
  });
  it("distinguishes revoked workspace access from an expired session before reading or writing", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    sessions.bearerToken.mockReturnValue("fixture-token");
    sessions.getNativeSession.mockResolvedValue({ userId: "user-a" });
    for (const [method, handler] of [["GET", GET], ["PATCH", PATCH]] as const) {
      const response = await handler({ params: { id: "record" }, request: new Request("https://suite.test/api/native/projects/record", { method }) } as never);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    }
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
    sessions.getNativeSession.mockResolvedValue(null);
    expect((await GET({ params: { id: "record" }, request: new Request("https://suite.test/api/native/projects/record") } as never)).status).toBe(401);
  });

});
