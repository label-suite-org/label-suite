import type { APIRoute } from "astro";
import { assignISRCsToRelease } from "../../../../lib/isrc";
import { handleApiError, json } from "../../../../server/api";
import { triggerCatalogSweep } from "../../../../server/catalog-maintenance";
import { NotFoundError } from "../../../../server/errors";
import { getReleaseDetail } from "../../../../server/releases";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const releaseId = params.id;
    if (!releaseId) throw new NotFoundError("Release not found");

    const release = await getReleaseDetail(orgId, releaseId);
    if (!release) throw new NotFoundError("Release not found");

    const result = await assignISRCsToRelease(orgId, releaseId);
    await triggerCatalogSweep(orgId, "release ISRC assignment");
    return json(result);
  } catch (error) {
    return handleApiError(error);
  }
};
