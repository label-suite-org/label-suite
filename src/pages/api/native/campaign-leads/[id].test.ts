import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeSession = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
vi.mock("../../../../lib/native-session", () => ({ getNativeSession: nativeSession.getNativeSession, bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: { userId: string; orgId: string }, operation: () => Promise<unknown>) => operation()) }));
vi.mock("../../../../lib/db", () => database);

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const service = vi.hoisted(() => ({ getNativeLeadWorkbench: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../server/native-lead-workbench", () => service);
vi.mock("../../../../server/tenant", () => ({ hasCapability: vi.fn((role: string, capability: string) => role === "operator" && capability === "operations.mutate") }));

import { GET } from "./[id]";

describe("native lead workbench projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    service.getNativeLeadWorkbench.mockResolvedValue({ campaign: { id: "campaign-a" }, lead: { id: "lead-a" }, activity: { items: [], next_cursor: null } });
  });

  it("loads a bounded, tenant-scoped lead projection and exposes operator capability", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a?workspaceId=org-a&campaignId=campaign-a&activityLimit=5"),
      params: { id: "lead-a" },
    } as never);

    expect(response.status).toBe(200);
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
    expect(service.getNativeLeadWorkbench).toHaveBeenCalledWith("org-a", "campaign-a", "lead-a", { activityCursor: null, activityLimit: "5" });
    await expect(response.json()).resolves.toMatchObject({ can_mutate: true });
  });

  it("exposes the same permitted context without mutation capability for a member", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a?workspaceId=org-a&campaignId=campaign-a"),
      params: { id: "lead-a" },
    } as never);
    expect(response.status).toBe(200);
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
    await expect(response.json()).resolves.toMatchObject({ can_mutate: false, lead: { id: "lead-a" } });
  });

  it("rejects a missing campaign relation before reading a lead", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a?workspaceId=org-a"),
      params: { id: "lead-a" },
    } as never);
    expect(response.status).toBe(400);
    expect(service.getNativeLeadWorkbench).not.toHaveBeenCalled();
  });
});

it("preserves valid sessions on workspace revocation and denies payee reads", async () => {
  vi.clearAllMocks();
  const invoke = () => GET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a", { headers: { authorization: "Bearer token" } }), params: { id: "campaign-a" } } as never);
  native.resolveNativeActor.mockResolvedValue(null);
  nativeSession.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
  const revoked = await invoke();
  expect(revoked.status).toBe(403);
  await expect(revoked.json()).resolves.toMatchObject({ code: "workspace_access_removed" });
  nativeSession.getNativeSession.mockResolvedValue(null);
  expect((await invoke()).status).toBe(401);
  native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "payee" } });
  const denied = await invoke();
  expect(denied.status).toBe(403);
  await expect(denied.json()).resolves.toMatchObject({ code: "insufficient_permissions" });
  for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
});
