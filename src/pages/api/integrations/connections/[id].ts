import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  listIntegrationConnections,
  recordAuditEvent,
  updateIntegrationConnection,
} from "../../../../server/integrations";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

const connectionStatusSchema = z.object({
  status: z.enum(["connected", "paused"]),
}).strict();

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const userId = locals.user?.id;
    if (!userId) return json({ error: "Authenticated user is required" }, 401);
    const id = params.id?.trim();
    if (!id) return json({ error: "Connection id is required" }, 400);

    const existing = (await listIntegrationConnections(orgId)).find((connection) => connection.id === id);
    if (!existing) return json({ error: "Integration connection not found" }, 404);
    const input = await parseJson(request, connectionStatusSchema);
    const connection = await updateIntegrationConnection(orgId, { id, status: input.status });
    await recordAuditEvent(orgId, {
      actor_user_id: userId,
      event_type: input.status === "paused" ? "integration.connection_paused" : "integration.connection_resumed",
      object_type: "integration_connection",
      object_id: id,
      before: { status: existing.status },
      after: { status: input.status },
    });

    return json({ connection });
  } catch (error) {
    return handleApiError(error);
  }
};
