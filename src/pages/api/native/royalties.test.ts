import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const service = vi.hoisted(() => ({ getNativeRoyaltyPage: vi.fn(), getNativeRoyaltyStatement: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: auth.resolveNativeActor }));
vi.mock("../../../lib/native-session", () => ({ bearerToken: auth.bearerToken, getNativeSession: auth.getNativeSession }));
vi.mock("../../../lib/db", () => ({ runWithDatabaseContext: async (_: unknown, operation: () => Promise<unknown>) => operation() }));
vi.mock("../../../server/native-royalties", () => service);
import * as list from "./royalties";
import * as detail from "./royalties/[id]";
const url = new URL("https://suite.test/api/native/royalties?workspaceId=foreign&section=earnings&offset=50");
const context = { url, request: new Request(url), params: { id: "statement" } } as never;
beforeEach(() => {
  vi.clearAllMocks();
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { role: "member", org: { id: "org" } } });
  auth.bearerToken.mockReturnValue(null); auth.getNativeSession.mockResolvedValue(null);
  service.getNativeRoyaltyPage.mockResolvedValue({ rows: [], payment_execution: false });
  service.getNativeRoyaltyStatement.mockResolvedValue({ statement: { id: "statement" }, payment_execution: false });
});
it("uses resolved workspace authority and exposes evidence without mutation routes", async () => {
  const response = await list.GET(context);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ can_review_payouts: false, payment_execution: false });
  expect(service.getNativeRoyaltyPage).toHaveBeenCalledWith("org", { section: "earnings", offset: "50" });
  expect((await detail.GET(context)).status).toBe(200);
  expect(service.getNativeRoyaltyStatement).toHaveBeenCalledWith("org", "statement", "50");
  expect(Object.keys(list).sort()).toEqual(["GET", "prerender"]);
  expect(Object.keys(detail).sort()).toEqual(["GET", "prerender"]);
  auth.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { role: "operator", org: { id: "org" } } });
  expect(await (await detail.GET(context)).json()).toMatchObject({ can_review_payouts: true, payment_execution: false });
});
it("denies payee access and distinguishes expiry from removed membership on both routes", async () => {
  for (const route of [list, detail]) {
    auth.resolveNativeActor.mockResolvedValue({ userId: "actor", workspace: { role: "payee", org: { id: "org" } } });
    expect((await route.GET(context)).status).toBe(403);
    auth.resolveNativeActor.mockResolvedValue(null); auth.bearerToken.mockReturnValue(null);
    expect((await route.GET(context)).status).toBe(401);
    auth.bearerToken.mockReturnValue("fixture"); auth.getNativeSession.mockResolvedValue({ user: { id: "actor" } });
    expect(await (await route.GET(context)).json()).toMatchObject({ code: "workspace_access_removed" });
  }
  expect(service.getNativeRoyaltyPage).not.toHaveBeenCalled();
  expect(service.getNativeRoyaltyStatement).not.toHaveBeenCalled();
});
