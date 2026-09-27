import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), session: vi.fn(), resolve: vi.fn() }));
vi.mock("../../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../../server/native-notification-resolution", () => ({ resolveNativeNotification: mocks.resolve }));
import { GET } from "./[id]";
const id = "de4f8ddd-b939-4cda-ab0e-a7950da26175";
const context = { request: new Request("https://suite.test/api/native/notifications/" + id + "?workspaceId=forged&userId=forged"), params: { id } } as never;
beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockReturnValue("bearer");
  mocks.session.mockResolvedValue({ user: { id: "verified-user" }, session: { id: "verified-session" } });
  mocks.resolve.mockResolvedValue({ status: "unavailable" });
});
it("uses authenticated identity without trusting a payload workspace and never caches resolution", async () => {
  const response = await GET(context);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ status: "unavailable" });
  expect(mocks.resolve).toHaveBeenCalledWith("verified-user", "verified-session", id);
});
it("requires sign-in before looking up the notification", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await GET(context)).status).toBe(401);
  expect(mocks.resolve).not.toHaveBeenCalled();
});
