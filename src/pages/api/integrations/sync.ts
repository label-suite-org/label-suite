import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  createSyncJob,
  listIntegrationConnections,
} from "../../../server/integrations";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

const syncNowSchema = z.object({
  connection_id: z.string().trim().min(1),
  idempotency_key: z.string().trim().min(1).max(200).optional(),
}).strict();

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const userId = locals.user?.id;
    if (!userId) return json({ error: "Authenticated user is required" }, 401);

    const input = await parseJson(request, syncNowSchema);
    const connection = (await listIntegrationConnections(orgId))
      .find((candidate) => candidate.id === input.connection_id);
    if (!connection) return json({ error: "Integration connection not found" }, 404);

    const job = await createSyncJob(orgId, {
      connection_id: connection.id,
      provider_key: connection.provider_key,
      job_type: "pull",
      status: "queued",
      triggered_by: userId,
      idempotency_key: input.idempotency_key ?? `manual:${connection.id}:${crypto.randomUUID()}`,
    });

    return json({ job }, 202);
  } catch (error) {
    return handleApiError(error);
  }
};
