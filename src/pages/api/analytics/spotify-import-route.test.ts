import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../../server/errors";
import { SPOTIFY_AUDIENCE_MAX_BYTES } from "../../../server/spotify-audience-timeline";
import { boundedMultipartRequest } from "../../../server/upload-security";

vi.mock("../../../server/tenant", () => ({ requireCapability: vi.fn() }));

import { createSpotifyImportRoute } from "./spotify-import";

const validCsv = readFileSync(new URL("../../../server/__fixtures__/spotify-audience-timeline.csv", import.meta.url));

function requestFor(form: FormData, headers: HeadersInit = {}): Request {
  return new Request("https://labels.example/api/analytics/spotify-import", {
    method: "POST",
    headers,
    body: form,
  });
}

function previewForm(): FormData {
  const form = new FormData();
  form.set("action", "preview");
  form.set("artist_id", "artist-a");
  form.set("file", new File([validCsv], "Audience timeline.csv", { type: "text/csv" }));
  return form;
}

function routeDependencies(overrides: Record<string, unknown> = {}) {
  return {
    requireCapability: vi.fn(() => "org-from-capability"),
    boundedMultipartRequest: vi.fn(boundedMultipartRequest),
    apply: vi.fn(),
    ...overrides,
  };
}

describe("Spotify analytics import route", () => {
  it("returns a parsed preview without applying it", async () => {
    const dependencies = routeDependencies();
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(previewForm()), locals: {} } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({
      kind: "preview",
      artistId: "artist-a",
      rowCount: 2,
      dateFrom: "2026-06-24",
      dateThrough: "2026-06-25",
    });
    expect(dependencies.requireCapability).toHaveBeenCalledWith({}, "operations.mutate");
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing action", (form: FormData) => form.delete("action")],
    ["invalid action", (form: FormData) => form.set("action", "commit")],
    ["missing artist", (form: FormData) => form.delete("artist_id")],
  ])("rejects %s before any apply", async (_label, adjust) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    adjust(form);
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it.each([
    ["missing file", (form: FormData) => form.delete("file"), 400],
    ["non-CSV extension", (form: FormData) => form.set("file", new File([validCsv], "Audience timeline.txt", { type: "text/csv" })), 415],
    ["non-CSV MIME type", (form: FormData) => form.set("file", new File([validCsv], "Audience timeline.csv", { type: "text/plain" })), 415],
  ])("rejects %s", async (_label, adjust, expectedStatus) => {
    const dependencies = routeDependencies();
    const form = previewForm();
    adjust(form);
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(expectedStatus);
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("rejects a declared multipart body that exceeds the route limit before parsing", async () => {
    const dependencies = routeDependencies();
    const { POST } = createSpotifyImportRoute(dependencies as never);
    const request = new Request("https://labels.example/api/analytics/spotify-import", {
      method: "POST",
      headers: { "content-length": String(SPOTIFY_AUDIENCE_MAX_BYTES + 64 * 1024 + 1) },
      body: "unread body",
    });

    const response = await POST({ request, locals: {} } as never);

    expect(response.status).toBe(413);
    expect(dependencies.boundedMultipartRequest).toHaveBeenCalledWith(request, SPOTIFY_AUDIENCE_MAX_BYTES + 64 * 1024);
  });

  it("rejects a streamed CSV file above the five MiB file boundary", async () => {
    const dependencies = routeDependencies();
    const form = new FormData();
    form.set("action", "preview");
    form.set("artist_id", "artist-a");
    form.set("file", new File([new Uint8Array(SPOTIFY_AUDIENCE_MAX_BYTES + 1)], "Audience timeline.csv", { type: "text/csv" }));
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(413);
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("requires a lower-case preview hash before applying", async () => {
    const dependencies = routeDependencies();
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "A".repeat(64));
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A valid preview SHA-256 is required" });
    expect(dependencies.apply).not.toHaveBeenCalled();
  });

  it("applies only with the organization derived from capability", async () => {
    const applied = { kind: "imported", runId: "run-a", inserted: 2, updated: 0, unchanged: 0, reportingThrough: "2026-06-25", latest: {} };
    const dependencies = routeDependencies({ apply: vi.fn().mockResolvedValue(applied) });
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    form.set("org_id", "attacker-controlled-org");
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(applied);
    expect(dependencies.apply).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-from-capability",
      artistId: "artist-a",
      expectedSha256: "a".repeat(64),
      fileName: "Audience timeline.csv",
    }));
  });

  it("preserves a bounded service error", async () => {
    const dependencies = routeDependencies({ apply: vi.fn().mockRejectedValue(new HttpError("Artist not found in active workspace", 404)) });
    const form = previewForm();
    form.set("action", "apply");
    form.set("expected_sha256", "a".repeat(64));
    const { POST } = createSpotifyImportRoute(dependencies as never);

    const response = await POST({ request: requestFor(form), locals: {} } as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Artist not found in active workspace" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
