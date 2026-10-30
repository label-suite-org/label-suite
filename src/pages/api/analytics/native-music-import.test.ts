import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../server/errors";
vi.mock("../../../server/tenant", () => ({ requireCapability: vi.fn(() => "active-org") }));
vi.mock("../../../server/native-music-import", () => ({ importNativeMusicSnapshot: vi.fn(async () => ({ kind: "imported", runId: "fixture-run" })) }));
import { requireCapability } from "../../../server/tenant";
import { importNativeMusicSnapshot } from "../../../server/native-music-import";
import { POST } from "./native-music-import";

const form = () => {
  const artist = "A".repeat(22), song = "B".repeat(22);
  const value = new FormData();
  value.set("artist_id", "local-artist");
  value.set("org_id", "untrusted-org");
  value.set("action", "preview");
  value.set("file", new File([JSON.stringify({ version: 1, provider: "spotify_for_artists", providerArtistId: artist,
    artistName: "Fixture", capturedAt: "2026-01-03T12:00:00Z", dateFrom: "2026-01-01", dateThrough: "2026-01-02",
    territory: "worldwide", metric: "audio_streams", artistTotal: null, acquisition: "signed_in_browser_capture",
    sourceUrl: `https://artists.spotify.com/c/artist/${artist}/music/songs`,
    rows: [{ recordingId: song, title: "Song", value: 7, sourceUrl: `https://artists.spotify.com/c/artist/${artist}/song/${song}/stats` }],
  })], "native.json", { type: "application/json" }));
  return value;
};
const call = (body: FormData) => POST({ request: new Request("https://example.test/api/analytics/native-music-import", { method: "POST", body }), locals: {} } as never);
beforeEach(() => vi.clearAllMocks());
describe("native music import route", () => {
  it("previews without writing and applies using authenticated tenant scope", async () => {
    const body = form();
    const preview = await call(body);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    const result = await preview.json();
    expect(result).toMatchObject({ kind: "preview", rowCount: 1, total: 7,
      capturedAt: "2026-01-03T12:00:00Z", metric: "audio_streams", artistTotal: null });
    expect(importNativeMusicSnapshot).not.toHaveBeenCalled();
    body.set("action", "apply"); body.set("expected_sha256", result.sha256);
    expect((await call(body)).status).toBe(200);
    expect(requireCapability).toHaveBeenCalledWith({}, "operations.mutate");
    expect(importNativeMusicSnapshot).toHaveBeenCalledWith(expect.objectContaining({ orgId: "active-org", expectedSha256: result.sha256 }));
  });
  it("rejects unauthorized writes and apply without preview", async () => {
    vi.mocked(requireCapability).mockImplementationOnce(() => { throw new HttpError("Forbidden", 403); });
    expect((await call(form())).status).toBe(403);
    const body = form(); body.set("action", "apply");
    expect((await call(body)).status).toBe(400);
    expect(importNativeMusicSnapshot).not.toHaveBeenCalled();
  });
});
