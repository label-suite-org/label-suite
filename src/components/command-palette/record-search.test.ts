import { describe, expect, it, vi } from "vitest";
import { fetchRecordSearchResults } from "./record-search";

describe("fetchRecordSearchResults", () => {
  it("returns deduplicated record matches for matching latest request", async () => {
    const recordsResponse = [
      { id: "artist-1", kind: "artist", title: "Artist", href: "/artists/artist-1" },
      { id: "artist-1", kind: "artist", title: "Artist duplicate", href: "/artists/artist-1" },
      { id: "track-1", kind: "track", title: "Artist", href: "/tracks/track-1" },
    ];

    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ records: recordsResponse }), { headers: { "content-type": "application/json" } }),
    );

    const result = await fetchRecordSearchResults({
      query: "artist",
      isLatestRequest: () => true,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith("/api/search/records?q=artist", {
      signal: expect.any(AbortSignal),
      headers: { Accept: "application/json" },
    });
    expect(result).toEqual({
      status: "success",
      records: [
        { id: "artist-1", kind: "artist", title: "Artist", href: "/artists/artist-1" },
        { id: "track-1", kind: "track", title: "Artist", href: "/tracks/track-1" },
      ],
    });
  });

  it("returns stale when a response resolves after a newer request supersedes it", async () => {
    let latest = true;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      latest = false;
      return new Response(JSON.stringify({ records: [] }), { headers: { "content-type": "application/json" } });
    });

    const result = await fetchRecordSearchResults({
      query: "artist",
      isLatestRequest: () => latest,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(result).toEqual({ status: "stale" });
  });

  it("returns aborted when latest request is cancelled while fetching", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    const result = await fetchRecordSearchResults({
      query: "artist",
      isLatestRequest: () => true,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(result).toEqual({ status: "aborted" });
  });

  it("returns empty records for malformed payloads", async () => {
    const fetchImpl: typeof fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ records: null }), { headers: { "content-type": "application/json" } }),
    );

    const result = await fetchRecordSearchResults({
      query: "artist",
      isLatestRequest: () => true,
      signal: new AbortController().signal,
      fetchImpl,
    });

    expect(result).toEqual({ status: "success", records: [] });
  });
});
