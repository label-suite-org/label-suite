import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { HttpError } from "./errors";
import {
  parseSisenseTrackSnapshot,
  SISENSE_TRACK_MAX_BYTES,
  SISENSE_TRACK_MAX_COLUMNS,
  SISENSE_TRACK_MAX_CELL_LENGTH,
  SISENSE_TRACK_MAX_HEADER_LENGTH,
  validateSisenseTrackPeriod,
} from "./sisense-track-snapshot";

const period = {
  reportingFrom: "2026-08-01",
  reportingThrough: "2026-08-08",
  aggregation: "Daily",
};
const headers = "track_title,primary_artist,release_title,isrc,spotify_streams,combined_streams,streams_growth";
const validRow = "Cherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,12.5";

function parse(csv: string, fileName = "Tracks by Growth Rate.csv") {
  return parseSisenseTrackSnapshot(new TextEncoder().encode(csv), fileName, period);
}

function expectHttpError(
  callback: () => unknown,
  message: string,
  status: number,
) {
  try {
    callback();
    throw new Error("Expected parser to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ message, status });
  }
}

describe("parseSisenseTrackSnapshot", () => {
  it("parses the dated export, preserving evidence and collapsing only its exact duplicate", async () => {
    const fixtureBytes = await readFile(new URL("./__fixtures__/sisense-tracks-by-growth.csv", import.meta.url));

    const parsed = parseSisenseTrackSnapshot(fixtureBytes, "Tracks by Growth Rate.csv", period);

    expect(parsed).toMatchObject({
      fileName: "Tracks-by-Growth-Rate.csv",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      aggregation: "Daily",
      sourceRowCount: 3,
      exactDuplicateCount: 1,
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      sourceRow: 2,
      trackTitle: "Cherry-coloured Funk",
      primaryArtist: "Cocteau Twins",
      releaseTitle: "Heaven or Las Vegas",
      isrc: "GBAYE9000123",
      metrics: { combined_streams: 54294, spotify_streams: 51575, apple_streams: 2719, streams_growth: 12.5 },
      rawRow: { track_title: "Cherry-coloured Funk", spotify_streams: "51575" },
      rowHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      sourceIdentity: "source:7141f93dc58c45453e8cc8d546d684d76e6feebffa4db713c098f6aeb01d7612",
    });
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts a UTF-8 BOM and reordered supported aliases", () => {
    const csv = "\uFEFFstreams,artist,title,spotify_streams\n54294,Cocteau Twins,Cherry-coloured Funk,51575\n";

    expect(parse(csv).rows[0]).toMatchObject({
      trackTitle: "Cherry-coloured Funk",
      primaryArtist: "Cocteau Twins",
      metrics: { combined_streams: 54294, spotify_streams: 51575 },
    });
  });

  it("retains unknown columns as raw evidence without treating them as metrics", () => {
    const csv = "track_title,primary_artist,spotify_streams,combined_streams,sisense_rank\nCherry-coloured Funk,Cocteau Twins,51575,54294,11\n";

    const row = parse(csv).rows[0];

    expect(row).toMatchObject({
      rawRow: { sisense_rank: "11" },
    });
    expect(row.metrics).toEqual({ spotify_streams: 51575, combined_streams: 54294 });
  });

  it("rejects schemas above the explicit column boundary", () => {
    const evidenceHeaders = Array.from(
      { length: SISENSE_TRACK_MAX_COLUMNS - 4 },
      (_, index) => `evidence_${index}`,
    );
    const maximumHeaders = [
      "track_title",
      "primary_artist",
      "spotify_streams",
      "combined_streams",
      ...evidenceHeaders,
    ];
    const maximumRow = ["Track", "Artist", "1", "1", ...evidenceHeaders.map(() => "")];
    expect(parse(`${maximumHeaders.join(",")}\n${maximumRow.join(",")}\n`).headers)
      .toHaveLength(SISENSE_TRACK_MAX_COLUMNS);

    expectHttpError(
      () => parse(`${maximumHeaders.join(",")},one_too_many\n${maximumRow.join(",")},\n`),
      `Sisense CSV exceeds ${SISENSE_TRACK_MAX_COLUMNS} columns`,
      413,
    );
  });

  it("rejects evidence header names above the explicit length boundary", () => {
    const maximumHeader = `e${"x".repeat(SISENSE_TRACK_MAX_HEADER_LENGTH - 1)}`;
    expect(parse(
      `track_title,primary_artist,spotify_streams,combined_streams,${maximumHeader}\nTrack,Artist,1,1,evidence\n`,
    ).headers.at(-1)).toBe(maximumHeader);

    const oversizedHeader = `${maximumHeader}x`;
    expectHttpError(
      () => parse(
        `track_title,primary_artist,spotify_streams,combined_streams,${oversizedHeader}\nTrack,Artist,1,1,evidence\n`,
      ),
      `Sisense CSV header names must not exceed ${SISENSE_TRACK_MAX_HEADER_LENGTH} characters`,
      413,
    );
  });

  it("rejects cells above the explicit length boundary", () => {
    const prefix = "track_title,primary_artist,release_title,spotify_streams,combined_streams\nTrack,Artist,\"";
    const suffix = "\",1,1\n";
    expect(parse(`${prefix}${"x".repeat(SISENSE_TRACK_MAX_CELL_LENGTH)}${suffix}`).rows[0].releaseTitle)
      .toHaveLength(SISENSE_TRACK_MAX_CELL_LENGTH);

    expectHttpError(
      () => parse(`${prefix}${"x".repeat(SISENSE_TRACK_MAX_CELL_LENGTH + 1)}${suffix}`),
      `Sisense CSV cells must not exceed ${SISENSE_TRACK_MAX_CELL_LENGTH} characters`,
      413,
    );
  });

  it("uses artist, title, and release—but not ISRC—for source identity", () => {
    const csv = `${headers}\n${validRow}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000999,51575,54294,12.5\n`;

    const rows = parse(csv).rows;

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.isrc)).toEqual(["GBAYE9000123", "GBAYE9000999"]);
    expect(rows.map((row) => row.sourceIdentity)).toEqual([
      "source:7141f93dc58c45453e8cc8d546d684d76e6feebffa4db713c098f6aeb01d7612",
      "source:7141f93dc58c45453e8cc8d546d684d76e6feebffa4db713c098f6aeb01d7612",
    ]);
  });

  it("keeps delimiter-colliding identity parts distinct", () => {
    const csv = "track_title,primary_artist,release_title,spotify_streams,combined_streams\nc,a|b,d,1,1\nb|c,a,d,1,1\n";

    expect(parse(csv).rows.map((row) => row.sourceIdentity)).toEqual([
      "source:9180321629c560ce9e5d33930503de03b9f6ea357e1527faab1a742ec505be94",
      "source:3d2ec34f18bd6580cffbd10b4a29c4a204fc179c3564c681b4e9b206c53206e3",
    ]);
  });

  it("keeps conflicting rows for the same normalized source identity for preview resolution", () => {
    const csv = `${headers}\n${validRow}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51576,54295,12.5\n`;

    const parsed = parse(csv);

    expect(parsed.rows).toHaveLength(2);
    expect(parsed.exactDuplicateCount).toBe(0);
    expect(parsed.rows.map((row) => row.sourceIdentity)).toEqual([
      "source:7141f93dc58c45453e8cc8d546d684d76e6feebffa4db713c098f6aeb01d7612",
      "source:7141f93dc58c45453e8cc8d546d684d76e6feebffa4db713c098f6aeb01d7612",
    ]);
  });

  it.each([
    ["invalid reporting date", { ...period, reportingFrom: "2026-02-30" }, "reportingFrom must be a valid ISO date"],
    ["reversed reporting dates", { ...period, reportingFrom: "2026-08-09" }, "reportingFrom must not be after reportingThrough"],
  ])("rejects %s", (_label, invalidPeriod, message) => {
    expectHttpError(() => validateSisenseTrackPeriod(invalidPeriod), message, 400);
  });

  it("defaults the reporting aggregation to Daily", () => {
    expect(validateSisenseTrackPeriod({
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
    })).toEqual(period);
  });

  it.each([
    ["blank required identity", `${headers}\n,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,12.5\n`, "track_title is required at row 2", 400],
    ["blank platform or view metric", `${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,,54294,12.5\n`, "A platform or view metric is required at row 2", 400],
    ["negative cumulative metric", `${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,-1,54294,12.5\n`, "spotify_streams must be a non-negative whole number at row 2", 400],
    ["fractional cumulative metric", `${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575.5,54294,12.5\n`, "spotify_streams must be a non-negative whole number at row 2", 400],
    ["unsafe cumulative metric", `${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,9007199254740992,54294,12.5\n`, "spotify_streams must be a non-negative whole number at row 2", 400],
    ["invalid growth metric", `${headers}\nCherry-coloured Funk,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,nope\n`, "streams_growth must be a finite decimal at row 2", 400],
    ["malformed quoting", `${headers}\nCherry-coloured Funk,"Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,12.5\n`, "Invalid CSV: unclosed quoted field", 400],
    ["letters after a closing quote", `${headers}\n"Cherry-coloured Funk"x,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,12.5\n`, "Invalid CSV: unexpected character after closing quote", 400],
    ["spaces after a closing quote", `${headers}\n"Cherry-coloured Funk" ,Cocteau Twins,Heaven or Las Vegas,GBAYE9000123,51575,54294,12.5\n`, "Invalid CSV: unexpected character after closing quote", 400],
    ["NUL bytes", `${headers}\n${validRow}\0`, "Sisense CSV contains NUL bytes", 415],
    ["unsupported headers", "track_title,primary_artist,combined_streams,unrecognized_metric\nCherry-coloured Funk,Cocteau Twins,54294,1\n", "Unsupported Sisense Tracks by Growth Rate headers", 415],
  ])("rejects %s", (_label, csv, message, status) => {
    expectHttpError(() => parse(csv), message, status);
  });

  it("accepts a valid file at exactly the 5 MiB byte limit", () => {
    const header = "track_title,primary_artist,release_title,spotify_streams,combined_streams\n";
    const rowFrames = Array.from({ length: 100 }, (_, index) => ({
      prefix: `Track ${index},Artist,\"`,
      suffix: "\",0,0\n",
    }));
    const frameBytes = new TextEncoder().encode(
      header + rowFrames.map(({ prefix, suffix }) => prefix + suffix).join(""),
    ).byteLength;
    const payloadBytes = SISENSE_TRACK_MAX_BYTES - frameBytes;
    const baseCellLength = Math.floor(payloadBytes / rowFrames.length);
    const remainder = payloadBytes % rowFrames.length;
    const csv = header + rowFrames.map(({ prefix, suffix }, index) => (
      prefix + "A".repeat(baseCellLength + (index < remainder ? 1 : 0)) + suffix
    )).join("");

    expect(baseCellLength + 1).toBeLessThanOrEqual(SISENSE_TRACK_MAX_CELL_LENGTH);
    expect(parse(csv).byteSize).toBe(SISENSE_TRACK_MAX_BYTES);
  });

  it("rejects files larger than 5 MiB before decoding", () => {
    expectHttpError(
      () => parseSisenseTrackSnapshot(new Uint8Array(SISENSE_TRACK_MAX_BYTES + 1), "Tracks by Growth Rate.csv", period),
      "Sisense CSV exceeds 5 MiB",
      413,
    );
  });

  it("accepts 100,000 source rows and rejects the 100,001st while parsing", () => {
    const compactHeaders = "track_title,primary_artist,spotify_streams,combined_streams";
    const compactRow = "t,a,0,0";
    const maximum = `${compactHeaders}\n${Array.from({ length: 100_000 }, () => compactRow).join("\n")}\n`;
    expect(parse(maximum).sourceRowCount).toBe(100_000);

    expectHttpError(
      () => parse(`${compactHeaders}\n${Array.from({ length: 100_001 }, () => compactRow).join("\n")}\n`),
      "Sisense CSV exceeds 100000 data rows",
      413,
    );
  });
});
