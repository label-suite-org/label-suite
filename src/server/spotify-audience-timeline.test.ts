import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseSpotifyAudienceTimeline,
  SPOTIFY_AUDIENCE_RANGE,
} from "./spotify-audience-timeline";
import { HttpError } from "./errors";

const headers = "date,listeners,monthly listeners,monthly active listeners,super listeners,streams,playlist adds,saves,followers";
const validRow = "2026-06-24,1,2,3,4,5,6,7,8";

function parse(csv: string, fileName = "export.csv") {
  return parseSpotifyAudienceTimeline(new TextEncoder().encode(csv), fileName);
}

function expectHttpError(csv: string, message: string, status: number, fileName?: string) {
  try {
    parse(csv, fileName);
    throw new Error("Expected parser to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ message, status });
  }
}

describe("parseSpotifyAudienceTimeline", () => {
  it("parses the locked export and returns stable normalized rows", async () => {
    const bytes = await readFile(new URL("./__fixtures__/spotify-audience-timeline.csv", import.meta.url));
    const result = parseSpotifyAudienceTimeline(bytes, "Audience timeline.csv");

    expect(result).toMatchObject({
      fileName: "Audience-timeline.csv",
      rowCount: 2,
      dateFrom: "2026-06-24",
      dateThrough: "2026-06-25",
      canonicalRange: SPOTIFY_AUDIENCE_RANGE,
    });
    expect(result.rows[0]).toMatchObject({
      date: "2026-06-24",
      rowKey: "artist-date:2026-06-24",
      metrics: {
        listeners: 84,
        monthly_listeners: 1579,
        monthly_active_listeners: 686,
        super_listeners: 39,
        streams: 123,
        playlist_adds: 11,
        saves: 5,
        followers: 564,
      },
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("removes a UTF-8 BOM before reading headers", () => {
    expect(parse(`\uFEFF${headers}\n${validRow}\n`).rowCount).toBe(1);
  });

  it("parses quoted fields as raw evidence", () => {
    const result = parse(`${headers}\n2026-06-24,"1",2,3,4,5,6,7,8\n`);
    expect(result.rows[0].rawRow.listeners).toBe("1");
  });

  it("decodes RFC 4180 doubled quotes before validating the metric value", () => {
    expectHttpError(
      `${headers}\n2026-06-24,"1""2",2,3,4,5,6,7,8\n`,
      "listeners must be a non-negative whole number at row 2",
      400,
    );
  });

  it("accepts the required headers in a different order", () => {
    const reordered = "followers,date,saves,listeners,monthly active listeners,streams,monthly listeners,playlist adds,super listeners";
    const result = parse(`${reordered}\n8,2026-06-24,7,1,3,5,2,6,4\n`);
    expect(result.rows[0].metrics).toMatchObject({ listeners: 1, monthly_listeners: 2, followers: 8 });
  });

  it("rejects a blank metric instead of inventing a zero", () => {
    expectHttpError(
      `${headers}\n2026-06-24,,2,3,4,5,6,7,8\n`,
      "listeners must be a non-negative whole number at row 2",
      400,
    );
  });

  it.each([
    ["unknown header", "date,listeners,unknown\n2026-06-24,1,2\n", "Unsupported Spotify for Artists headers", 415],
    ["duplicate date", `${headers}\n${validRow}\n${validRow}\n`, "Duplicate date at row 3", 400],
    ["negative metric", `${headers}\n2026-06-24,1,2,3,4,-5,6,7,8\n`, "streams must be a non-negative whole number at row 2", 400],
    ["impossible date", `${headers}\n2026-02-30,1,2,3,4,5,6,7,8\n`, "date must be a valid ISO date at row 2", 400],
    ["unclosed quote", `${headers}\n2026-06-24,"1,2,3,4,5,6,7,8\n`, "Invalid CSV: unclosed quoted field", 400],
    ["empty file", "", "Spotify for Artists CSV is empty", 400],
    ["NUL byte", `${headers}\n${validRow}\0`, "Spotify for Artists CSV contains NUL bytes", 415],
    ["duplicate headers", `${headers},listeners\n${validRow},9\n`, "Spotify for Artists headers must be unique", 415],
  ])("rejects %s", (_label, csv, message, status) => {
    expectHttpError(csv, message, status);
  });

  it("rejects more than 100,000 data rows", () => {
    expectHttpError(`${headers}\n${Array.from({ length: 100_001 }, () => validRow).join("\n")}\n`, "Spotify for Artists CSV exceeds 100000 data rows", 413);
  });

  it("rejects files larger than 5 MiB before decoding", () => {
    expectHttpError("x".repeat(5 * 1024 * 1024 + 1), "Spotify for Artists CSV exceeds 5 MiB", 413);
  });

  it("falls back when the filename has no permitted ASCII characters", () => {
    const result = parse(`${headers}\n${validRow}\n`, "🎵");
    expect(result.fileName).toBe("spotify-audience-timeline.csv");
  });
});
