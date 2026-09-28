import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ where: vi.fn(), fetch: vi.fn() }));
vi.mock("../../../../../lib/db", () => {
  const query = { from: vi.fn(), leftJoin: vi.fn(), where: mocks.where };
  query.from.mockReturnValue(query); query.leftJoin.mockReturnValue(query);
  return { db: { select: () => query }, runWithDatabaseContext: vi.fn() };
});
import { POST } from "./propose";
const id = "1234567890123456789012";
function request(role = "operator", origin = "https://suite.test") {
  return { locals: { orgId: "org-a", membershipRole: role }, request: new Request("https://suite.test/api/integrations/spotify/identity/propose", {
    method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify({ spotify_url: `spotify:track:${id}` }),
  }) } as never;
}
beforeEach(() => {
  vi.stubEnv("PUBLIC_SITE_URL", "https://suite.test");
  vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "true");
  vi.stubEnv("SPOTIFY_CLIENT_ID", "fixture"); vi.stubEnv("SPOTIFY_CLIENT_SECRET", "fixture");
  vi.stubGlobal("fetch", mocks.fetch); mocks.fetch.mockReset(); mocks.where.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("resolves a link into an identifier-first proposal without confirming it", async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ access_token: "fixture-token", token_type: "Bearer" }))
    .mockResolvedValueOnce(Response.json({ type: "track", id, name: "Different title", external_ids: { isrc: "DK123" } }));
  mocks.where.mockResolvedValue([{ id: "track-a", title: "Canonical title", isrc: "DK123" }]);
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ confirmation_required: true, match_method: "isrc", input: { external_id: id }, candidates: [{ object_id: "track-a", score: 100 }] });
});
it.each([["member", "https://suite.test"], ["operator", "https://foreign.test"]])("rejects role/origin before lookup: %s %s", async (role, origin) => {
  expect((await POST(request(role, origin))).status).toBe(403);
  expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.where).not.toHaveBeenCalled();
});
