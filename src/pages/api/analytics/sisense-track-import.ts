import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import {
  createProductionSisenseTrackSnapshotService,
  type SisenseTrackSnapshotApplyInput,
  type SisenseTrackSnapshotPreviewRequest,
} from "../../../server/sisense-track-snapshot-import";
import {
  SISENSE_TRACK_MAX_BYTES,
  validateSisenseTrackPeriod,
} from "../../../server/sisense-track-snapshot";
import { SisenseTrackSnapshotPreviewAmbiguityError } from "../../../server/sisense-track-snapshot-preview";
import { requireCapability } from "../../../server/tenant";
import { boundedMultipartRequest } from "../../../server/upload-security";

export const prerender = false;

type ProductionService = ReturnType<typeof createProductionSisenseTrackSnapshotService>;

type RouteDependencies = {
  requireCapability: typeof requireCapability;
  boundedMultipartRequest: typeof boundedMultipartRequest;
  preview: (input: SisenseTrackSnapshotPreviewRequest) => ReturnType<ProductionService["preview"]>;
  apply: (input: SisenseTrackSnapshotApplyInput) => ReturnType<ProductionService["apply"]>;
};

const productionDependencies: RouteDependencies = {
  requireCapability,
  boundedMultipartRequest,
  preview: (input) => createProductionSisenseTrackSnapshotService().preview(input),
  apply: (input) => createProductionSisenseTrackSnapshotService().apply(input),
};

function assertSisenseCsvFile(file: File): void {
  const isCsvName = file.name.toLowerCase().endsWith(".csv");
  const mime = file.type.trim().toLowerCase();
  const isAcceptedMime = mime === "" || mime === "text/csv" || mime === "application/csv";
  if (!isCsvName || !isAcceptedMime) {
    throw new HttpError("Sisense track import requires a CSV file", 415);
  }
}

async function parseMultipartForm(request: Request): Promise<FormData> {
  try {
    return await request.formData();
  } catch {
    throw new HttpError("Malformed multipart form data", 400);
  }
}

export function createSisenseTrackImportRoute(dependencies: RouteDependencies = productionDependencies) {
  const POST: APIRoute = async ({ request, locals }) => {
    try {
      const orgId = dependencies.requireCapability(locals, "operations.mutate");
      const bounded = await dependencies.boundedMultipartRequest(request, SISENSE_TRACK_MAX_BYTES + 64 * 1024);
      const form = await parseMultipartForm(bounded);
      const action = form.get("action");
      const artistId = form.get("artist_id");
      const file = form.get("file");

      if (action !== "preview" && action !== "apply") {
        throw new HttpError("Action must be preview or apply", 400);
      }
      if (typeof artistId !== "string" || !artistId.trim()) {
        throw new HttpError("Artist is required", 400);
      }
      if (!(file instanceof File)) throw new HttpError("CSV file is required", 400);
      assertSisenseCsvFile(file);
      if (file.size > SISENSE_TRACK_MAX_BYTES) {
        throw new HttpError("Sisense CSV exceeds 5 MiB", 413);
      }

      const period = validateSisenseTrackPeriod({
        reportingFrom: form.get("reporting_from"),
        reportingThrough: form.get("reporting_through"),
        aggregation: form.get("aggregation"),
      });

      const input = {
        orgId,
        artistId,
        ...period,
        bytes: new Uint8Array(await file.arrayBuffer()),
        fileName: file.name,
      };

      if (action === "preview") return json(await dependencies.preview(input));

      const expectedSha256 = form.get("expected_sha256");
      if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
        throw new HttpError("A valid preview SHA-256 is required", 400);
      }
      const expectedPreviewFingerprint = form.get("expected_preview_fingerprint");
      if (
        typeof expectedPreviewFingerprint !== "string"
        || !/^[a-f0-9]{64}$/.test(expectedPreviewFingerprint)
      ) {
        throw new HttpError("A valid preview fingerprint is required", 400);
      }
      const includeUnmatchedValue = form.get("include_unmatched");
      if (includeUnmatchedValue !== null && includeUnmatchedValue !== "true") {
        throw new HttpError("include_unmatched must be true when provided", 400);
      }

      return json(await dependencies.apply({
        ...input,
        expectedSha256,
        expectedPreviewFingerprint,
        includeUnmatched: includeUnmatchedValue === "true",
      }));
    } catch (error) {
      if (error instanceof SisenseTrackSnapshotPreviewAmbiguityError) {
        return json({
          error: error.message,
          ambiguities: error.ambiguities,
          totalAmbiguityCount: error.totalAmbiguityCount,
        }, error.status);
      }
      return handleApiError(error);
    }
  };

  return { POST };
}

export const { POST } = createSisenseTrackImportRoute();
