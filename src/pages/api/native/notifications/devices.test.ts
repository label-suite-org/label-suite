import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ token: vi.fn(), session: vi.fn(), register: vi.fn(), remove: vi.fn() }));
vi.mock("../../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../../server/native-notification-devices", async (original) => ({
  ...await original<typeof import("../../../../server/native-notification-devices")>(), registerNotificationDevice: mocks.register, removeNotificationDevice: mocks.remove,
}));
import { DELETE, POST } from "./devices";
const context = (body: unknown) => ({ request: new Request("https://suite.test/api/native/notifications/devices?workspaceId=workspace", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}) }) as never;
const id = "de4f8ddd-b939-4cda-ab0e-a7950da26175";
beforeEach(() => {
  vi.clearAllMocks(); mocks.token.mockReturnValue("session-bearer");
  mocks.session.mockResolvedValue({ user: { id: "verified-user" }, session: { id: "verified-session" } });
  mocks.register.mockResolvedValue({ id, generation: 1 }); mocks.remove.mockResolvedValue({ ok: true });
});
it("binds registration/removal to verified identity and accepts only explicit authorized permission", async () => {
  const body = { attemptId: id, token: "AB".repeat(32), permission: "authorized" };
  const response = await POST(context(body));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.register).toHaveBeenCalledWith("workspace", "verified-user", "verified-session", { ...body, token: body.token.toLowerCase() });
  expect((await POST(context({ ...body, userId: "forged" }))).status).toBe(400);
  expect((await POST(context({ ...body, permission: "provisional" }))).status).toBe(400);
  expect((await DELETE(context({ attemptId: id }))).status).toBe(200);
  expect(mocks.remove).toHaveBeenCalledWith("verified-user", "verified-session", { attemptId: id });
});
it("rejects missing sessions before accessing device registrations", async () => {
  mocks.session.mockResolvedValue(null);
  expect((await DELETE(context({ attemptId: id }))).status).toBe(401);
  expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.register).not.toHaveBeenCalled();
});
it("does not log or return device tokens from unexpected database errors", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const privateToken = "ab".repeat(32);
    mocks.register.mockRejectedValue(new Error(`Database query failed with parameter ${privateToken}`));
    const response = await POST(context({ attemptId: id, token: privateToken, permission: "authorized" }));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain(privateToken);
    expect(log).toHaveBeenCalled();
    expect(log.mock.calls.flat().map(String).join(" ")).not.toContain(privateToken);
  } finally { log.mockRestore(); }
});
