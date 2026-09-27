import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../server/errors";
import { SISENSE_TRACK_MAX_BYTES } from "../../../server/sisense-track-snapshot";
import { SisenseTrackSnapshotPreviewAmbiguityError } from "../../../server/sisense-track-snapshot-preview";
import { boundedMultipartRequest } from "../../../server/upload-security";

vi.mock("../../../server/tenant", () => ({ requireCapability: vi.fn() }));

import { createSisenseTrackImportRoute } from "./sisense-track-import";

const validCsv = "track_title,primary_artist,combined_streams,spotify_streams\nTrack A,Artist A,10,10\n";

function requestFor(form: FormData, headers: HeadersInit = {}): Request {
  return new Request("https://labels.example/api/analytics/sisense-track-import", {
    method: "POST",
    headers,
    body: form,
  });
}

function previewForm(): FormData {
  const form = new FormData();
  form.set("action", "preview");
  form.set("artist_id", "artist-a");
  form.set("reporting_from", "2026-08-01");
  form.set("reporting_through", "2026-08-08");
  form.set("aggregation", "Daily");
  form.set("file", new File([validCsv], "Tracks by Growth Rate.csv", { type: "text/csv" }));
  return form;
}

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    requireCapability: vi.fn(() => "org-from-capability"),
    boundedMultipartRequest: vi.fn(boundedMultipartRequest),
    preview: vi.fn().mockResolvedValue({
      kind: "preview",
      artistId: "artist-a",
      artistName: "Artist A",
      fileName: "Tracks by Growth Rate.csv",
      sha256: "a".repeat(64),
      previewFingerprint: "b".repeat(64),
      requestedDateRange: "2026-08-01 to 2026-08-08",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      aggregation: "Daily",
      counts: { sourceRows: 2, uniqueTracks: 2, matched: 2, unmatched: 0, ambiguous: 0, exactDuplicates: 0 },
      totals: { combinedStreams: 30, combinedViews: 0 },
      identitySamples: {
        total: 2,
        truncated: false,
        items: [
          {
            sourceRow: 2,
            trackTitle: "Track A",
            primaryArtist: "Artist A",
            releaseTitle: null,
            isrc: null,
            matchStatus: "matched",
            trackId: "track-a",
          },
          {
            sourceRow: 3,
            trackTitle: "Track B",
            primaryArtist: "Artist A",
            releaseTitle: null,
            isrc: null,
            matchStatus: "matched",
            trackId: "track-b",
          },
        ],
      },
    }),
    apply: vi.fn(),
    ...overrides,
  };
}

describe("Sisense track snapshot import route", () => {
  it("returns a private preview without applying it", async () => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("org_id", "attacker-controlled-org");
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      kind: "preview",
      artistId: "artist-a",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      previewFingerprint: "b".repeat(64),
      counts: { uniqueTracks: 2 },
    });
    expect(body).not.toHaveProperty("rows");
    expect(JSON.stringify(body)).not.toContain("rawRow");
    expect(dependencies.requireCapability).toHaveBeenCalledWith({}, "operations.mutate");
    expect(dependencies.preview).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-from-capability",
      artistId: "artist-a",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      aggregation: "Daily",
      fileName: "Tracks by Growth Rate.csv",
    }));
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing reporting start", (form: FormData) => form.delete("reporting_from"), "reportingFrom must be a valid ISO date"],
    ["invalid reporting end", (form: FormData) => form.set("reporting_through", "2026-02-30"), "reportingThrough must be a valid ISO date"],
    ["reversed reporting period", (form: FormData) => form.set("reporting_from", "2026-08-09"), "reportingFrom must not be after reportingThrough"],
    ["blank aggregation", (form: FormData) => form.set("aggregation", "  "), "aggregation must be a non-empty string"],
  ])("rejects %s before preview", async (_label, adjust, expectedError) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    adjust(form);
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing action", (form: FormData) => form.delete("action"), "Action must be preview or apply"],
    ["invalid action", (form: FormData) => form.set("action", "commit"), "Action must be preview or apply"],
    ["missing artist", (form: FormData) => form.delete("artist_id"), "Artist is required"],
    ["missing file", (form: FormData) => form.delete("file"), "CSV file is required"],
  ])("rejects %s before either service operation", async (_label, adjust, expectedError) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    adjust(form);
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: expectedError });
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["non-CSV extension", new File([validCsv], "Tracks by Growth Rate.txt", { type: "text/csv" })],
    ["non-CSV MIME type", new File([validCsv], "Tracks by Growth Rate.csv", { type: "text/plain" })],
  ])("rejects a %s before reading the file", async (_label, file) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("file", file);
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ error: "Sisense track import requires a CSV file" });
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("rejects a CSV above the five MiB file boundary", async () => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("file", new File(
      [new Uint8Array(SISENSE_TRACK_MAX_BYTES + 1)],
      "Tracks by Growth Rate.csv",
      { type: "text/csv" },
    ));
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Sisense CSV exceeds 5 MiB" });
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("applies with the full preview binding and only the capability-derived organization", async () => {
    const applied = {
      kind: "imported",
      runId: "run-a",
      inserted: 2,
      updated: 0,
      unchanged: 0,
      latest: {},
    };
    const dependencies = routeDependencies({ apply: vi.fn().mockResolvedValue(applied) });
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("expected_preview_fingerprint", "b".repeat(64));
    form.set("include_unmatched", "true");
    form.set("org_id", "attacker-controlled-org");
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(applied);
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).toHaveBeenCalledWith({
      orgId: "org-from-capability",
      artistId: "artist-a",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      aggregation: "Daily",
      bytes: new TextEncoder().encode(validCsv),
      fileName: "Tracks by Growth Rate.csv",
      expectedSha256: "a".repeat(64),
      expectedPreviewFingerprint: "b".repeat(64),
      includeUnmatched: true,
    });
  });

  it("keeps an older duplicate run id while returning newer authoritative latest evidence", async () => {
    const applied = {
      kind: "duplicate",
      runId: "run-older-duplicate",
      latest: {
        artistId: "artist-a",
        artistName: "Artist A",
        runId: "run-newer-correction",
        fileName: "Correction.csv",
        sha256: "c".repeat(64),
        rowCount: 3,
        importedAt: "2026-08-12T09:00:00.000Z",
        reportingFrom: "2026-08-01",
        reportingThrough: "2026-08-08",
        requestedDateRange: "2026-08-01 to 2026-08-08",
        aggregation: "Daily",
        counts: { sourceRows: 3, uniqueTracks: 3, matched: 3, unmatched: 0, ambiguous: 0, exactDuplicates: 0 },
        totals: { combinedStreams: 45, combinedViews: 4 },
      },
    };
    const dependencies = routeDependencies({ apply: vi.fn().mockResolvedValue(applied) });
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("expected_preview_fingerprint", "b".repeat(64));
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(applied);
  });

  it.each([
    ["missing file hash", "expected_sha256", null, "A valid preview SHA-256 is required"],
    ["upper-case file hash", "expected_sha256", "A".repeat(64), "A valid preview SHA-256 is required"],
    ["missing preview fingerprint", "expected_preview_fingerprint", null, "A valid preview fingerprint is required"],
    ["upper-case preview fingerprint", "expected_preview_fingerprint", "B".repeat(64), "A valid preview fingerprint is required"],
  ])("rejects a %s before apply", async (_label, field, value, expectedError) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("expected_preview_fingerprint", "b".repeat(64));
    if (value === null) form.delete(field);
    else form.set(field, value);
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expectedError });
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("rejects an invalid unmatched acknowledgement value", async () => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("expected_preview_fingerprint", "b".repeat(64));
    form.set("include_unmatched", "yes");
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "include_unmatched must be true when provided" });
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("returns bounded typed ambiguity details without exposing row payloads", async () => {
    const dependencies = routeDependencies({
      preview: vi.fn().mockRejectedValue(new SisenseTrackSnapshotPreviewAmbiguityError([
        {
          identity: "isrc:DKABC2600001",
          sourceRows: [2, 4],
          reason: "Identity resolves to multiple canonical tracks",
        },
      ], 3)),
    });
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(previewForm()), locals: {} } as never);

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: "Sisense snapshot preview has identity ambiguities",
      ambiguities: [{
        identity: "isrc:DKABC2600001",
        sourceRows: [2, 4],
        reason: "Identity resolves to multiple canonical tracks",
      }],
      totalAmbiguityCount: 3,
    });
  });

  it.each([
    [
      "stale preview fingerprint",
      "Sisense snapshot preview no longer matches the selected artist, file, reporting form, or catalog resolution",
      true,
    ],
    [
      "unacknowledged unmatched rows",
      "Acknowledge unmatched Sisense source rows before importing this snapshot",
      false,
    ],
  ])("preserves the bounded service error for %s", async (_label, message, includeUnmatched) => {
    const dependencies = routeDependencies({
      apply: vi.fn().mockRejectedValue(new HttpError(message, 409)),
    });
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("expected_preview_fingerprint", "b".repeat(64));
    if (includeUnmatched) form.set("include_unmatched", "true");
    const { POST } = createSisenseTrackImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(409);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: message });
    expect(dependencies.apply).toHaveBeenCalledWith(expect.objectContaining({ includeUnmatched }));
  });

  it("rejects an oversized multipart request before FormData parsing", async () => {
    const dependencies = routeDependencies();
    const { POST } = createSisenseTrackImportRoute(dependencies as never);
    const request = new Request("https://labels.example/api/analytics/sisense-track-import", {
      method: "POST",
      headers: { "content-length": String(SISENSE_TRACK_MAX_BYTES + 64 * 1024 + 1) },
      body: "unread body",
    });

    const response = await POST({ request, locals: {} } as never);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Upload body is too large" });
    expect(dependencies.boundedMultipartRequest).toHaveBeenCalledWith(
      request,
      SISENSE_TRACK_MAX_BYTES + 64 * 1024,
    );
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("returns a private safe 400 for malformed multipart syntax", async () => {
    const dependencies = routeDependencies();
    const { POST } = createSisenseTrackImportRoute(dependencies as never);
    const request = new Request("https://labels.example/api/analytics/sisense-track-import", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=broken" },
      body: "--broken\r\nContent-Disposition: form-data; name=\"action\"\r\n\r\npreview",
    });

    const response = await POST({ request, locals: {} } as never);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: "Malformed multipart form data" });
    expect(dependencies.preview).not.toHaveBeenCalled();
    expect(dependencies.apply).not.toHaveBeenCalled();
  });
});
