import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeSession = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
vi.mock("../../../../../lib/native-session", () => ({ getNativeSession: nativeSession.getNativeSession, bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null }));
const native = vi.hoisted(() => ({ resolveNativeWorkspace: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeCampaignLeads: vi.fn() }));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../server/native-campaigns", () => service);

import { GET } from "./leads";

describe("native campaign lead queues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeWorkspace.mockResolvedValue({ org: { id: "org-a" } });
    service.listNativeCampaignLeads.mockResolvedValue({ campaign_id: "campaign-a", queue: "follow_up", items: [], next_cursor: null });
  });

  it("passes generic queue, channel, stage, and cursor filters with tenant scope", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaigns/campaign-a/leads?workspaceId=org-a&queue=follow_up&channel=youtube_channel&stage=qualified&limit=5&cursor=next"),
      params: { id: "campaign-a" },
    } as never);

    expect(response.status).toBe(200);
    expect(service.listNativeCampaignLeads).toHaveBeenCalledWith("org-a", "campaign-a", {
      queue: "follow_up", channel: "youtube_channel", stage: "qualified", limit: "5", cursor: "next",
    });
  });

  it("defaults to the Now queue and rejects unknown queues", async () => {
    const defaultResponse = await GET({
      request: new Request("https://suite.test/api/native/campaigns/campaign-a/leads?workspaceId=org-a"),
      params: { id: "campaign-a" },
    } as never);
    expect(defaultResponse.status).toBe(200);
    expect(service.listNativeCampaignLeads).toHaveBeenCalledWith("org-a", "campaign-a", expect.objectContaining({ queue: "now" }));

    const invalidResponse = await GET({
      request: new Request("https://suite.test/api/native/campaigns/campaign-a/leads?workspaceId=org-a&queue=maybe"),
      params: { id: "campaign-a" },
    } as never);
    expect(invalidResponse.status).toBe(400);
    expect(service.listNativeCampaignLeads).toHaveBeenCalledTimes(1);
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
