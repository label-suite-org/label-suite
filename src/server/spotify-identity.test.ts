import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ limit: vi.fn(), link: vi.fn(), audit: vi.fn() }));
vi.mock("../lib/db", () => {
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), limit: mocks.limit };
  for (const method of [query.from, query.innerJoin, query.where]) method.mockReturnValue(query);
  const tx = { select: () => query };
  return { db: { transaction: async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx) } };
});
vi.mock("./integrations", () => ({ upsertExternalObjectLink: mocks.link, recordAuditEvent: mocks.audit }));
import { confirmSpotifyIdentity } from "./spotify-identity";
afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "true");
  mocks.limit.mockReset().mockResolvedValueOnce([{ id: "connection-a", provider_key: "spotify" }]);
  mocks.link.mockResolvedValue({ id: "link-a" });
});

it("records a confirmed workspace target and its audit", async () => {
  mocks.limit.mockResolvedValueOnce([{ id: "track-a" }]);
  await expect(confirmSpotifyIdentity("org-a", {
    connection_id: "connection-a", object_type: "track", external_id: "spotify-id",
    label_suite_object_type: "track", label_suite_object_id: "track-a",
    match_method: "isrc", match_confidence: 100,
  }, "actor-a")).resolves.toEqual({ id: "link-a" });
  expect(mocks.link).toHaveBeenCalledWith("org-a", expect.objectContaining({ label_suite_object_id: "track-a" }), expect.anything());
  expect(mocks.audit).toHaveBeenCalledWith("org-a", expect.objectContaining({ actor_user_id: "actor-a", object_id: "track-a" }), mocks.link.mock.calls[0][2]);
});

it.each(["artist", "release", "track"] as const)("rejects a missing or foreign %s before writing a link or audit", async (type) => {
  mocks.limit.mockResolvedValueOnce([]);
  await expect(confirmSpotifyIdentity("org-a", {
    connection_id: "connection-a", object_type: type === "release" ? "album" : type,
    external_id: "spotify-id", label_suite_object_type: type, label_suite_object_id: "foreign-id",
    match_method: "title_artist", match_confidence: 82,
  }, "actor-a")).rejects.toMatchObject({ status: 404 });
  expect(mocks.link).not.toHaveBeenCalled();
  expect(mocks.audit).not.toHaveBeenCalled();
});
