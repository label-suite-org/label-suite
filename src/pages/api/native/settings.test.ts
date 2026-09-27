import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), session: vi.fn(), settings: vi.fn(), context: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: () => "fixture", getNativeSession: mocks.session }));
vi.mock("../../../lib/db", () => ({ runWithDatabaseContext: mocks.context }));
vi.mock("../../../server/native-settings", () => ({ getNativeSettings: mocks.settings }));
import { GET } from "./settings";
const context = () => {
  const url = new URL("https://suite.test/api/native/settings?workspaceId=untrusted&membersOffset=50");
  return { request: new Request(url), url } as never;
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ userId: "verified-user", workspace: { org: { id: "verified-workspace" } } });
  mocks.context.mockImplementation(async (_scope, callback) => callback());
  mocks.settings.mockResolvedValue({ account: { name: "Example" } });
  mocks.session.mockResolvedValue(null);
});
it("uses verified tenant context and never caches account data", async () => {
  const response = await GET(context());
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.context).toHaveBeenCalledWith({ orgId: "verified-workspace", userId: "verified-user" }, expect.any(Function), { isolationLevel: "repeatable read" });
  expect(mocks.settings).toHaveBeenCalledWith("verified-workspace", "verified-user", { membersOffset: "50", integrationsOffset: undefined });
});
it("distinguishes signed out from removed workspace access without loading settings", async () => {
  mocks.actor.mockResolvedValue(null);
  expect((await GET(context())).status).toBe(401);
  mocks.session.mockResolvedValue({ user: { id: "verified-user" } });
  const response = await GET(context());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
  expect(mocks.settings).not.toHaveBeenCalled();
});
