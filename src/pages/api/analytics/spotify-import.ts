import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import {
  createSpotifyAnalyticsImportService,
  type SpotifyImportInput,
} from "../../../server/spotify-analytics-import";
import {
  parseSpotifyAudienceTimeline,
  SPOTIFY_AUDIENCE_MAX_BYTES,
  type SpotifyAudienceTimelinePreview,
} from "../../../server/spotify-audience-timeline";
import { requireCapability } from "../../../server/tenant";
import { boundedMultipartRequest } from "../../../server/upload-security";

export const prerender = false;

type RouteDependencies = {
  requireCapability: typeof requireCapability;
  boundedMultipartRequest: typeof boundedMultipartRequest;
  apply: (input: SpotifyImportInput) => ReturnType<ReturnType<typeof createSpotifyAnalyticsImportService>["applySpotifyAudienceTimeline"]>;
};

const productionDependencies: RouteDependencies = {
  requireCapability,
  boundedMultipartRequest,
  apply: (input) => createSpotifyAnalyticsImportService().applySpotifyAudienceTimeline(input),
};

function assertSpotifyCsvFile(file: File): void {
  const isCsvName = file.name.toLowerCase().endsWith(".csv");
  const mime = file.type.trim().toLowerCase();
  const isAcceptedMime = mime === "" || mime === "text/csv" || mime === "application/csv";
  if (!isCsvName || !isAcceptedMime) {
    throw new HttpError("Spotify audience import requires a CSV file", 415);
  }
}

function toPreviewResponse(artistId: string, preview: SpotifyAudienceTimelinePreview) {
  return {
    kind: "preview" as const,
    artistId,
    fileName: preview.fileName,
    sha256: preview.sha256,
    byteSize: preview.byteSize,
    rowCount: preview.rowCount,
    dateFrom: preview.dateFrom,
    dateThrough: preview.dateThrough,
    canonicalRange: preview.canonicalRange,
  };
}

export function createSpotifyImportRoute(dependencies: RouteDependencies = productionDependencies) {
  const POST: APIRoute = async ({ request, locals }) => {
    try {
      const orgId = dependencies.requireCapability(locals, "operations.mutate");
      const bounded = await dependencies.boundedMultipartRequest(request, SPOTIFY_AUDIENCE_MAX_BYTES + 64 * 1024);
      const form = await bounded.formData();
      const action = form.get("action");
      const artistId = form.get("artist_id");
      const file = form.get("file");

      if (action !== "preview" && action !== "apply") throw new HttpError("Action must be preview or apply", 400);
      if (typeof artistId !== "string" || !artistId.trim()) throw new HttpError("Artist is required", 400);
      if (!(file instanceof File)) throw new HttpError("CSV file is required", 400);
      assertSpotifyCsvFile(file);

      const bytes = new Uint8Array(await file.arrayBuffer());
      const preview = parseSpotifyAudienceTimeline(bytes, file.name);
      if (action === "preview") return json(toPreviewResponse(artistId, preview));

      const expectedSha256 = form.get("expected_sha256");
      if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new HttpError("A valid preview SHA-256 is required", 400);
      }
      return json(await dependencies.apply({ orgId, artistId, expectedSha256, bytes, fileName: file.name }));
    } catch (error) {
      return handleApiError(error);
    }
  };

  return { POST };
}

export const { POST } = createSpotifyImportRoute();
