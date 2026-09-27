import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import {
  listIntegrationConnections,
  listIntegrationErrors,
  listIntegrationProviders,
  listSyncJobs,
} from "../../../server/integrations";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const [providers, connections, syncJobs, errors] = await Promise.all([
      listIntegrationProviders(orgId),
      listIntegrationConnections(orgId),
      listSyncJobs(orgId),
      listIntegrationErrors(orgId),
    ]);

    return json({
      providers,
      connections: connections.map(({ auth_ref: _authRef, ...connection }) => connection),
      syncJobs: syncJobs.slice(0, 25),
      errors: errors.slice(0, 25),
    });
  } catch (error) {
    return handleApiError(error);
  }
};
