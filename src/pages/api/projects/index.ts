import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { createProject, createProjectSchema, listProjects } from "../../../server/projects";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    return json({ projects: await listProjects(requireOrgId(locals)) });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "projects.mutate");
    const input = await parseJson(request, createProjectSchema);
    return json(await createProject(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};
