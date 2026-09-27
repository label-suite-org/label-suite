import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  createProjectEvent,
  createProjectEventSchema,
  listProjectEvents,
} from "../../../server/project-events";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability, requireOrgId } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const projectId = url.searchParams.get("project_id");
    const filters = {
      project_id: projectId === "standalone" ? null : projectId ?? undefined,
      event_type: url.searchParams.get("event_type") ?? undefined,
      status: url.searchParams.get("status") ?? undefined,
      start_date: url.searchParams.get("start_date") ?? undefined,
      end_date: url.searchParams.get("end_date") ?? undefined,
    };
    return json({ events: await listProjectEvents(requireOrgId(locals), filters) });
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "projects.mutate");
    const input = await parseJson(request, createProjectEventSchema);
    return json(await createProjectEvent(orgId, input), 201);
  } catch (error) {
    return handleApiError(error);
  }
};
