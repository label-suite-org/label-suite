import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { linkReleaseToSamplyProject } from "../../../../../server/samply-release";
import { normalizeSamplyProjectId } from "../../../../../server/samply";
import { requireCapability } from "../../../../../server/tenant";

export const prerender = false;

const linkReleaseSchema = z.object({
  remoteProjectId: z.string().trim().min(1, "remoteProjectId is required"),
});

export const POST: APIRoute = async ({ params, locals, request }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const releaseId = params.id;
    if (!releaseId) {
      return json({ error: "Release id is required" }, 400);
    }

    const input = await parseJson(request, linkReleaseSchema);
    const remoteProjectId = normalizeSamplyProjectId(input.remoteProjectId);
    if (!remoteProjectId) {
      return json({ error: "A valid Samply project id or project URL is required" }, 400);
    }
    const result = await linkReleaseToSamplyProject(orgId, releaseId, remoteProjectId);
    return json(result, 201);
  } catch (err) {
    return handleApiError(err);
  }
};
