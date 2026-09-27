import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { listLinkableSamplyProjects } from "../../../server/samply-release";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const projects = await listLinkableSamplyProjects(orgId);
    return json({ projects });
  } catch (err) {
    return handleApiError(err);
  }
};
