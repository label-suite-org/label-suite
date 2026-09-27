import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { getSamplyAvailability, listSamplyProjects } from "../../../server/samply";
import { requireOwnerRole } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireOwnerRole(locals);
    const verify = url.searchParams.get("verify") === "true";
    const availability = getSamplyAvailability(orgId);

    if (!verify || !availability.configured) {
      return json({
        configured: availability.configured,
        reason: availability.reason,
        baseUrl: availability.baseUrl,
        configuredOrgId: availability.configuredOrgId,
      });
    }

    const projects = await listSamplyProjects(orgId);
    return json({
      configured: true,
      verified: true,
      baseUrl: availability.baseUrl,
      configuredOrgId: availability.configuredOrgId,
      projectCount: projects.length,
      projects: projects.slice(0, 5).map((project) => ({
        id: project.id,
        name: project.name,
        uploadEnabled: Boolean(project.upload?.enabled),
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
};
