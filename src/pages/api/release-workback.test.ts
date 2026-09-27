import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ capability: vi.fn(), apply: vi.fn() }));
vi.mock("../../server/tenant", () => ({ requireCapability: mocks.capability }));
vi.mock("../../lib/db", () => ({ db: {} }));
vi.mock("../../server/release-workback", async (importOriginal) => ({ ...await importOriginal<typeof import("../../server/release-workback")>(), applyReleaseWorkback: mocks.apply }));
import { POST } from "./release-workback";
import { HttpError } from "../../server/errors";
const payload = { action: "apply", releaseId: "release", releaseDate: "2026-10-23", items: [{ key: "masters", title: "Approve masters", phase: "assets_metadata", owner: null, dueDate: "2026-09-11", offsetDays: -42 }] };
const request = (body: unknown) => ({ request: new Request("http://localhost/api/release-workback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), locals: {} }) as Parameters<typeof POST>[0];
describe("workback API boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.capability.mockReturnValue("org-a"); mocks.apply.mockResolvedValue({ created: 1 }); });
  it("uses the authenticated workspace and rejects users without operations capability", async () => {
    expect((await POST(request(payload))).status).toBe(200);
    expect(mocks.capability).toHaveBeenCalledWith({}, "operations.mutate");
    expect(mocks.apply).toHaveBeenCalledWith("org-a", payload);
    mocks.apply.mockClear(); mocks.capability.mockImplementation(() => { throw new HttpError("Forbidden", 403); });
    expect((await POST(request(payload))).status).toBe(403); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("rejects an invalid calendar date without writing", async () => {
    expect((await POST(request({ ...payload, releaseDate: "2026-02-30" }))).status).toBe(400);
    expect(mocks.apply).not.toHaveBeenCalled();
  });
});
