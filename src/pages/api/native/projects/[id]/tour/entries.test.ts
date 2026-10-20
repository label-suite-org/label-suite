import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), token: vi.fn(), session: vi.fn(), save: vi.fn(), scope: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
vi.mock("../../../../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../../../../lib/native-session", () => ({ bearerToken: mocks.token, getNativeSession: mocks.session }));
vi.mock("../../../../../../lib/db", () => ({ db: {}, runWithDatabaseContext: mocks.scope }));
vi.mock("../../../../../../server/tour-daily-flow", async original => ({ ...await original<object>(), saveTourDailyEntry: mocks.save }));
import { POST } from "./entries";
const input = () => ({ action: "expense", request_id: randomUUID(), name: "Fuel", amount: 1000, currency: "USD", date: "2026-10-19", person: "Tour member", paid: true, category: "Fuel" });
const request = (body: unknown = input()) => ({ request: new Request("https://suite.test/api/native/projects/tour/tour/entries?workspaceId=workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), params: { id: "tour" } }) as never;
beforeEach(() => { vi.clearAllMocks(); mocks.actor.mockResolvedValue({ userId: "user", workspace: { org: { id: "org" }, role: "operator" } }); mocks.save.mockResolvedValue({ saved: true }); });
it("saves only through the authenticated workspace and budget capability", async () => {
  expect((await POST(request())).status).toBe(200);
  expect(mocks.scope).toHaveBeenCalledWith({ userId: "user", orgId: "org" }, expect.any(Function));
  expect(mocks.save).toHaveBeenCalledWith("org", "tour", "user", expect.objectContaining({ action: "expense", amount: 1000 }));
});
it.each(["member", "payee"])("denies %s writes before touching the ledger", async role => {
  mocks.actor.mockResolvedValue({ userId: "user", workspace: { org: { id: "org" }, role } });
  expect((await POST(request())).status).toBe(403);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("validates integer money and the retry identity before mutation", async () => {
  expect((await POST(request({ ...input(), amount: 10.25 }))).status).toBe(400);
  expect((await POST(request({ ...input(), request_id: "" }))).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it("distinguishes removed workspace access from expired authentication", async () => {
  mocks.actor.mockResolvedValue(null); mocks.token.mockReturnValue("disposable"); mocks.session.mockResolvedValue({ userId: "user" });
  expect(await (await POST(request())).json()).toMatchObject({ code: "workspace_access_removed" });
  mocks.session.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(401);
  expect(mocks.save).not.toHaveBeenCalled();
});
