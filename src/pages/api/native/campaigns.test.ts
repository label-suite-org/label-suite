import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeSession = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
vi.mock("../../../lib/native-session", () => ({ getNativeSession: nativeSession.getNativeSession, bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null }));
const native = vi.hoisted(() => ({ resolveNativeWorkspace: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeCampaignSummaries: vi.fn() }));

vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../server/native-campaigns", () => service);

import { GET } from "./campaigns";

describe("native campaign summaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeWorkspace.mockResolvedValue({ org: { id: "org-a" } });
    service.listNativeCampaignSummaries.mockResolvedValue({ items: [], next_cursor: null });
  });

  it("lists active campaigns in the explicitly selected workspace", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaigns?workspaceId=org-a&limit=10"),
    } as never);

    expect(response.status).toBe(200);
    expect(service.listNativeCampaignSummaries).toHaveBeenCalledWith("org-a", { archived: false, cursor: null, limit: "10" });
  });

  it("passes the archived filter and cursor without loading a workspace", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaigns?workspaceId=org-a&archived=true&cursor=next"),
    } as never);

    expect(response.status).toBe(200);
    expect(service.listNativeCampaignSummaries).toHaveBeenCalledWith("org-a", { archived: true, cursor: "next", limit: null });
  });

  it("rejects missing or removed native workspace access", async () => {
    native.resolveNativeWorkspace.mockResolvedValueOnce(null);
    const response = await GET({ request: new Request("https://suite.test/api/native/campaigns") } as never);
    expect(response.status).toBe(401);
    expect(service.listNativeCampaignSummaries).not.toHaveBeenCalled();
  });
});

it("preserves valid sessions on workspace revocation and denies payee reads", async () => {
  vi.clearAllMocks();
  const invoke = () => GET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a", { headers: { authorization: "Bearer token" } }), params: { id: "campaign-a" } } as never);
  native.resolveNativeWorkspace.mockResolvedValue(null);
  nativeSession.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
  const revoked = await invoke();
  expect(revoked.status).toBe(403);
  await expect(revoked.json()).resolves.toMatchObject({ code: "workspace_access_removed" });
  nativeSession.getNativeSession.mockResolvedValue(null);
  expect((await invoke()).status).toBe(401);
  native.resolveNativeWorkspace.mockResolvedValue({ org: { id: "org-a" }, role: "payee" });
  const denied = await invoke();
  expect(denied.status).toBe(403);
  await expect(denied.json()).resolves.toMatchObject({ code: "insufficient_permissions" });
  for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
});
