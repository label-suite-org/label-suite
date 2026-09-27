import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getProject, updateProject } from "../../../server/projects";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;
const updateBodySchema = z.record(z.string(), z.unknown());

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    if (!params.id) return json({ error: "id required" }, 400);
    const project = await getProject(requireOrgId(locals), params.id);
    return project ? json({ project }) : json({ error: "Project not found" }, 404);
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ params, request, locals }) => {
  try {
    if (!params.id) return json({ error: "id required" }, 400);
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "projects.mutate");
    const input = await parseJson(request, updateBodySchema);
    return json(await updateProject(orgId, { ...input, id: params.id }));
  } catch (error) {
    return handleApiError(error);
  }
};
