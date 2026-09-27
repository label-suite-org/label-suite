import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const getNativeAnalytics = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: auth.resolveNativeActor }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: auth.bearerToken, getNativeSession: auth.getNativeSession }));
vi.mock("../../../lib/db", () => ({ runWithDatabaseContext: async (_: unknown, operation: () => Promise<unknown>) => operation() }));
vi.mock("../../../server/native-analytics", async original => ({ ...await original<typeof import("../../../server/native-analytics")>(), getNativeAnalytics }));
import * as route from "./analytics";
const url = new URL("https://suite.test/api/native/analytics?workspaceId=foreign&artist=artist-a&release=release-a");
const context = { url, request: new Request(url) } as never;
beforeEach(() => {
  vi.clearAllMocks();
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { role: "member", org: { id: "org" } } });
  auth.bearerToken.mockReturnValue(null); auth.getNativeSession.mockResolvedValue(null);
  getNativeAnalytics.mockResolvedValue({ periods: [] });
});
it("reads only the authenticated workspace and forwards explicit filters without mutation routes", async () => {
  const response = await route.GET(context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(getNativeAnalytics).toHaveBeenCalledWith("org", { artist_id: "artist-a", release_id: "release-a" });
  expect(Object.keys(route).sort()).toEqual(["GET", "prerender"]);
});
it("denies payees and distinguishes expiry from removed workspace membership", async () => {
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { role: "payee", org: { id: "org" } } });
  expect((await route.GET(context)).status).toBe(403);
  auth.resolveNativeActor.mockResolvedValue(null);
  expect((await route.GET(context)).status).toBe(401);
  auth.bearerToken.mockReturnValue("fixture"); auth.getNativeSession.mockResolvedValue({ user: { id: "actor" } });
  const response = await route.GET(context);
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
  expect(getNativeAnalytics).not.toHaveBeenCalled();
});
