import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), session: vi.fn(), preferences: vi.fn() }));
vi.mock("../../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../../server/native-notification-preferences", async (original) => ({
  ...await original<typeof import("../../../../server/native-notification-preferences")>(), nativeNotificationPreferences: mocks.preferences,
}));
import { GET, POST } from "./preferences";
const context = (body?: unknown) => ({ request: new Request("https://suite.test/api/native/notifications/preferences?workspaceId=untrusted", body === undefined ? {} : {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}) }) as never;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ userId: "verified-user", workspace: { org: { id: "verified-workspace" } } });
  mocks.token.mockReturnValue(null); mocks.session.mockResolvedValue(null);
  mocks.preferences.mockResolvedValue({ workspaceId: "verified-workspace", categories: [] });
});
it("uses verified identity for reads and category writes and prevents caching", async () => {
  const response = await GET(context());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.preferences).toHaveBeenCalledWith("verified-workspace", "verified-user", undefined);
  const input = { category: "assignments", enabled: true, expectedGeneration: 0 };
  expect((await POST(context(input))).status).toBe(200);
  expect(mocks.preferences).toHaveBeenLastCalledWith("verified-workspace", "verified-user", input);
  expect((await POST(context({ ...input, userId: "forged" }))).status).toBe(400);
  expect(mocks.preferences).toHaveBeenCalledTimes(2);
});
it("rejects expired sessions and removed membership before reading preferences", async () => {
  mocks.actor.mockResolvedValue(null);
  expect((await GET(context())).status).toBe(401);
  mocks.token.mockReturnValue("local-fixture"); mocks.session.mockResolvedValue({ user: { id: "verified-user" } });
  const response = await POST(context({ category: "assignments", enabled: true, expectedGeneration: 0 }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
  expect(mocks.preferences).not.toHaveBeenCalled();
});
