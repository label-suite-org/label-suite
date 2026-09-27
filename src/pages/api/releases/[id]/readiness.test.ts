import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../../../lib/db", () => ({ db: {} }));
const service = vi.hoisted(() => ({ getReleaseReadinessSnapshot: vi.fn(), correctReleaseField: vi.fn() }));
vi.mock("../../../../server/release-correction", async (original) => ({ ...await original<typeof import("../../../../server/release-correction")>(), ...service }));
import { GET, PUT } from "./readiness";
import { ConflictError, NotFoundError } from "../../../../server/errors";
const input = { field: "upc_ean", value: "193436442374", expected_updated_at: "2026-09-27T01:00:00.000Z" };
const snapshot = { release: { id: "release", title: "Fixture" }, readiness: { isReady: false, missing: ["No tracks"] } };
function context(body: unknown = input, role = "operator") {
  return { params: { id: "release" }, request: new Request("https://suite.test/api/releases/release/readiness", { method: "PUT", body: JSON.stringify(body) }), locals: { user: { id: "actor" }, orgId: "workspace", membershipRole: role } };
}
beforeEach(() => { vi.clearAllMocks(); service.getReleaseReadinessSnapshot.mockResolvedValue(snapshot); service.correctReleaseField.mockResolvedValue(snapshot); });
it("allows member reading but keeps writes and payee reads outside their authority", async () => {
  expect((await GET(context(input, "member") as never)).status).toBe(200);
  expect((await PUT(context(input, "member") as never)).status).toBe(403);
  expect((await GET(context(input, "payee") as never)).status).toBe(403);
  const expired = context(); delete (expired.locals as { user?: unknown }).user;
  expect((await PUT(expired as never)).status).toBe(401);
  expect(service.correctReleaseField).not.toHaveBeenCalled();
});
it("writes only the selected field with server workspace, actor and explicit revision", async () => {
  const response = await PUT(context() as never);
  expect(await response.json()).toEqual({ ok: true, ...snapshot });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(service.correctReleaseField).toHaveBeenCalledWith("workspace", "release", "actor", input);
  service.correctReleaseField.mockClear();
  for (const body of [{ ...input, orgId: "foreign" }, { ...input, format: "album" }, { ...input, expected_updated_at: undefined }, { ...input, field: "release_date", value: "2026-02-30" }]) {
    expect((await PUT(context(body) as never)).status).toBe(400);
  }
  expect(service.correctReleaseField).not.toHaveBeenCalled();
});
it("does not acknowledge missing or conflicting records as saved", async () => {
  service.correctReleaseField.mockRejectedValueOnce(new ConflictError("Release changed"));
  const conflict = await PUT(context() as never);
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).not.toHaveProperty("ok", true);
  service.getReleaseReadinessSnapshot.mockRejectedValueOnce(new NotFoundError("Release not found"));
  expect((await GET(context() as never)).status).toBe(404);
});
