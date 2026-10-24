import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), context: vi.fn(), save: vi.fn(), publish: vi.fn(), audience: vi.fn(), messageSave: vi.fn(), schedule: vi.fn(), test: vi.fn() }));
vi.mock("../../../server/audit", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: mocks.actor }));
vi.mock("../../../lib/db", () => ({ db: {}, runWithDatabaseContext: mocks.context }));
vi.mock("../../../server/fan-drops", () => ({ listFanDrops: vi.fn(), saveFanDrop: mocks.save, publishFanDrop: mocks.publish, fanAudience: mocks.audience, publicDropPath: vi.fn() }));
vi.mock("../../../server/fan-messages", () => ({ listFanMessages: vi.fn(), saveFanMessage: mocks.messageSave, previewFanMessage: vi.fn(), scheduleFanMessage: mocks.schedule, cancelFanMessage: vi.fn(), reconcileFanMessage: vi.fn(), testFanMessage: mocks.test, fanTestRecipient: vi.fn() }));
vi.mock("../../../server/fan-feedback", () => ({ listFans: vi.fn(), fanHistory: vi.fn(), tagFan: vi.fn() }));
import { GET, POST } from "./fan-drops";
const actor = (role: string) => ({ userId: "operator-a", workspace: { role, org: { id: "org-a" } } });
const context = (body?: unknown) => ({ request: new Request("https://suite.test/api/native/fan-drops?workspaceId=other&artist_id=artist-a", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined) }) as never;
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor.mockResolvedValue(actor("operator")); mocks.context.mockImplementation((_context, action) => action()); mocks.audience.mockResolvedValue([]); mocks.save.mockResolvedValue({ id: "drop-a" });
});
it("denies anonymous and non-operator access before reading fan identities", async () => {
  for (const value of [null, actor("member"), actor("payee"), actor("fundraiser")]) { mocks.actor.mockResolvedValue(value); expect((await GET(context())).status).toBe(403); }
  expect(mocks.audience).not.toHaveBeenCalled();
});
it("always uses the authenticated org and private caching", async () => {
  const result = await GET(context()); expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.context).toHaveBeenCalledWith({ userId: "operator-a", orgId: "org-a" }, expect.any(Function));
  expect(mocks.audience).toHaveBeenCalledWith("org-a", { artist_id: "artist-a" });
});
it("allows operator drafts but reserves publication and delivery decisions for owners", async () => {
  expect((await POST(context({ action: "save", input: { title: "Draft" } }))).status).toBe(200);
  for (const action of ["publish", "message_schedule", "message_cancel", "message_test"]) expect((await POST(context({ action, input: {} }))).status).toBe(403);
  expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue(actor("owner")); mocks.schedule.mockResolvedValue({ status: "scheduled" });
  expect((await POST(context({ action: "message_schedule", input: { id: "message-a" } }))).status).toBe(200);
  expect(mocks.schedule).toHaveBeenCalledWith("org-a", { id: "message-a" });
  expect((await POST(context({ action: "send_now", input: {} }))).status).toBe(400);
});

it("routes owner tests with the authenticated identity and never an arbitrary recipient", async () => {
  mocks.actor.mockResolvedValue(actor("owner")); mocks.test.mockResolvedValue({ id: "test-a", status: "scheduled" });
  expect((await POST(context({ action: "message_test", input: { id: "message-a", expected_revision: 1 } }))).status).toBe(200);
  expect(mocks.test).toHaveBeenCalledWith("org-a", { id: "message-a", expected_revision: 1 }, "operator-a");
});
