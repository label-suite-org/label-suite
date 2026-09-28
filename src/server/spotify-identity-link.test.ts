import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveSpotifyIdentityLink } from "./spotify-identity-link";
const id = "1234567890123456789012";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "true");
  vi.stubEnv("SPOTIFY_CLIENT_ID", "fixture-id");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "fixture-secret");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it.each(["artist", "album", "track"])("resolves %s metadata through fixed endpoints", async type => {
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "fixture-token", token_type: "Bearer" }))
    .mockResolvedValueOnce(Response.json({ id, type, name: "Fixture", artists: [{ name: "Artist" }], external_ids: { isrc: "TEST123", upc: "12345" } }));
  const result = await resolveSpotifyIdentityLink(`https://open.spotify.com/${type}/${id}?si=ignored`);
  expect(result).toMatchObject({ object_type: type, external_id: id, external_url: `https://open.spotify.com/${type}/${id}`, isrc: "TEST123", upc_ean: "12345" });
  expect(fetchMock.mock.calls[1][0]).toBe(`https://api.spotify.com/v1/${type}s/${id}`);
  expect(fetchMock.mock.calls[1][1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
});
it.each([`https://evil.example/track/${id}`, `https://open.spotify.com@evil.example/track/${id}`, `spotify:playlist:${id}`, "spotify:track:short"])("rejects unsafe or unsupported input before network: %s", async value => {
  await expect(resolveSpotifyIdentityLink(value)).rejects.toMatchObject({ status: 400 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("keeps disabled and unconfigured enrichment unavailable", async () => {
  vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "false");
  await expect(resolveSpotifyIdentityLink(`spotify:track:${id}`)).rejects.toMatchObject({ status: 404 });
  vi.stubEnv("SPOTIFY_IDENTITY_ENRICHMENT_ENABLED", "true");
  vi.stubEnv("SPOTIFY_CLIENT_SECRET", "");
  await expect(resolveSpotifyIdentityLink(`spotify:track:${id}`)).rejects.toMatchObject({ status: 503 });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("rejects substituted metadata and sanitizes transport errors", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ access_token: "fixture-token", token_type: "Bearer" }))
    .mockResolvedValueOnce(Response.json({ id: "other", type: "track", name: "Wrong" }));
  await expect(resolveSpotifyIdentityLink(`spotify:track:${id}`)).rejects.toMatchObject({ status: 502 });
  fetchMock.mockRejectedValueOnce(new Error("fixture-secret"));
  await expect(resolveSpotifyIdentityLink(`spotify:track:${id}`)).rejects.toMatchObject({ message: "Spotify metadata could not be retrieved", status: 502 });
});
