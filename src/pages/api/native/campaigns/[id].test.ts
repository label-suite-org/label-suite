import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../../server/errors";

const nativeSession = vi.hoisted(() => ({ getNativeSession: vi.fn() }));
vi.mock("../../../../lib/native-session", () => ({
  getNativeSession: nativeSession.getNativeSession,
  bearerToken: (request: Request) => request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null,
}));

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), assertNativeCampaignReadAccess: vi.fn((actor) => { if (actor.workspace.role === "payee") throw new HttpError("Insufficient permissions", 403, "insufficient_permissions"); }) }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn() }));
const service = vi.hoisted(() => ({ getNativeCampaignDetail: vi.fn(), getNativeCampaignActivity: vi.fn() }));

vi.mock("../../../../lib/native-workspace", () => native);
vi.mock("../../../../lib/db", () => database);
vi.mock("../../../../server/native-campaigns", () => service);

import { GET as detailGET } from "./[id]";
import { GET as activityGET } from "./[id]/activity";

const actor = { userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } };

beforeEach(() => {
  vi.clearAllMocks();
    nativeSession.getNativeSession.mockResolvedValue(null);
  native.resolveNativeActor.mockResolvedValue(actor);
  database.runWithDatabaseContext.mockImplementation(async (_context: unknown, callback: () => unknown) => callback());
  service.getNativeCampaignDetail.mockResolvedValue({ campaign: { id: "campaign-a" } });
  service.getNativeCampaignActivity.mockResolvedValue({ campaign_id: "campaign-a", items: [], source_states: [], next_cursor: null });
});

describe("native campaign detail route", () => {
  it("allows a read-only membership and scopes detail to its selected workspace", async () => {
    const response = await detailGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(200);
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
    expect(service.getNativeCampaignDetail).toHaveBeenCalledWith("org-a", "campaign-a");
  });

  it.each(["owner", "operator", "fundraiser", "member"])("allows the %s campaign-read role", async (role) => {
    native.resolveNativeActor.mockResolvedValueOnce({ ...actor, workspace: { ...actor.workspace, role } });
    const response = await detailGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(200);
  });

  it("denies payees before database context or campaign reads", async () => {
    native.resolveNativeActor.mockResolvedValueOnce({ ...actor, workspace: { ...actor.workspace, role: "payee" } });
    const response = await detailGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Insufficient permissions", code: "insufficient_permissions" });
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
    expect(service.getNativeCampaignDetail).not.toHaveBeenCalled();
  });

  it("rejects missing membership and blank campaign identifiers without touching services", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    const unauthorized = await detailGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a"), params: { id: "campaign-a" } } as never);
    const invalid = await detailGET({ request: new Request("https://suite.test/api/native/campaigns/%20?workspaceId=org-a"), params: { id: " " } } as never);
    expect(unauthorized.status).toBe(401);
    expect(invalid.status).toBe(400);
    expect(service.getNativeCampaignDetail).not.toHaveBeenCalled();
  });
});

describe("native campaign activity route", () => {
  it("forwards bounded pagination input only after native actor resolution", async () => {
    const response = await activityGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a/activity?workspaceId=org-a&limit=50&cursor=opaque"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(200);
    expect(service.getNativeCampaignActivity).toHaveBeenCalledWith("org-a", "campaign-a", { limit: "50", cursor: "opaque" });
  });

  it("denies payees before activity reads", async () => {
    native.resolveNativeActor.mockResolvedValueOnce({ ...actor, workspace: { ...actor.workspace, role: "payee" } });
    const response = await activityGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a/activity?workspaceId=org-a"), params: { id: "campaign-a" } } as never);
    expect(response.status).toBe(403);
    expect(service.getNativeCampaignActivity).not.toHaveBeenCalled();
  });

  it("serializes tenant-hidden, malformed, and stale cursors through the canonical error boundary", async () => {
    service.getNativeCampaignActivity
      .mockRejectedValueOnce(new HttpError("Campaign not found", 404))
      .mockRejectedValueOnce(new HttpError("Invalid activity cursor", 400, "activity_cursor_invalid"))
      .mockRejectedValueOnce(new HttpError("Activity cursor is stale; restart pagination", 409, "activity_cursor_stale"));
    const hidden = await activityGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-b/activity?workspaceId=org-a"), params: { id: "campaign-b" } } as never);
    const cursor = await activityGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a/activity?workspaceId=org-a&cursor=bad"), params: { id: "campaign-a" } } as never);
    const stale = await activityGET({ request: new Request("https://suite.test/api/native/campaigns/campaign-a/activity?workspaceId=org-a&cursor=old"), params: { id: "campaign-a" } } as never);
    expect(hidden.status).toBe(404);
    expect(cursor.status).toBe(400);
    await expect(cursor.json()).resolves.toEqual({ error: "Invalid activity cursor", code: "activity_cursor_invalid" });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: "Activity cursor is stale; restart pagination", code: "activity_cursor_stale" });
  });
});

it.each([detailGET, activityGET])("distinguishes revoked membership from expired authentication", async (handler) => {
  vi.clearAllMocks();
  native.resolveNativeActor.mockResolvedValue(null);
  nativeSession.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
  const invoke = () => handler({ request: new Request("https://suite.test/api/native/campaigns/campaign-a?workspaceId=org-a", { headers: { authorization: "Bearer valid-token" } }), params: { id: "campaign-a" } } as never);
  const revoked = await invoke();
  expect(revoked.status).toBe(403);
  await expect(revoked.json()).resolves.toMatchObject({ code: "workspace_access_removed" });
  nativeSession.getNativeSession.mockResolvedValue(null);
  expect((await invoke()).status).toBe(401);
  expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
});
