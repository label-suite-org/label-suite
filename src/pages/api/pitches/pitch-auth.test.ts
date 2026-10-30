import { beforeEach, expect, it, vi } from "vitest";
const service = vi.hoisted(() => ({ getPitch: vi.fn(), pitchOptions: vi.fn(), savePitch: vi.fn(), savePitchFollowup: vi.fn(), changePitchLink: vi.fn() }));
vi.mock("../../../server/pitches", () => service);
vi.mock("../../../lib/db", () => ({ db: {}, runWithDatabaseContext: vi.fn() }));
import { GET } from "./index";
import { POST } from "./link";
beforeEach(() => vi.clearAllMocks());
it("denies members access to pitch data and provider writes", async () => {
  const ctx = { locals: { orgId: "org", membershipRole: "member", user: { id: "user" } }, url: new URL("https://example.test/api/pitches?id=one") } as never;
  expect((await GET(ctx)).status).toBe(403); expect((await POST(ctx)).status).toBe(403);
  expect(service.getPitch).not.toHaveBeenCalled(); expect(service.changePitchLink).not.toHaveBeenCalled();
});
it("uses the authenticated workspace and actor for link creation", async () => {
  const id = crypto.randomUUID();
  const response = await POST({ locals: { orgId: "org", membershipRole: "operator", user: { id: "user" } }, request: new Request("https://example.test/api/pitches/link", { method: "POST", body: JSON.stringify({ id, action: "create", expected_version: 1 }) }) } as never);
  expect(response.status).toBe(200);
  expect(service.changePitchLink).toHaveBeenCalledWith("org", "user", id, "create", 1);
});
