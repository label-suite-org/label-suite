import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getProjectEvent, updateProjectEvent } from "../../../server/project-events";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;
const updateBodySchema = z.record(z.string(), z.unknown());

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    if (!params.id) return json({ error: "id required" }, 400);
    const event = await getProjectEvent(requireOrgId(locals), params.id);
    return event ? json({ event }) : json({ error: "Event not found" }, 404);
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
    return json(await updateProjectEvent(orgId, { ...input, id: params.id }));
  } catch (error) {
    return handleApiError(error);
  }
};

export const PATCH = PUT;
