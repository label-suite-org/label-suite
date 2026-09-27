import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../../server/api";
import { requireCapability } from "../../../../../server/tenant";
import { NotFoundError } from "../../../../../server/errors";
import {
  assertDataQualityTarget,
  dataQualityObjectTypes,
  getDataQualityIssue,
  listIntegrationConnections,
  recordAuditEvent,
  updateDataQualityIssue,
  upsertExternalObjectLink,
} from "../../../../../server/integrations";
import { externalObjectMatchMethods } from "../../../../../server/integration-object-links";

export const prerender = false;

const linkSchema = z.object({
  connection_id: z.string().trim().min(1),
  external_object_type: z.string().trim().min(1),
  external_object_id: z.string().trim().min(1),
  external_object_url: z.string().trim().url().nullable().optional(),
  label_suite_object_type: z.enum(dataQualityObjectTypes),
  label_suite_object_id: z.string().trim().min(1),
  match_method: z.enum(externalObjectMatchMethods).default("manual"),
  match_confidence: z.number().int().min(0).max(100).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const issue = await getDataQualityIssue(orgId, params.id ?? "");
    const input = await parseJson(request, linkSchema);
    const connection = (await listIntegrationConnections(orgId)).find((row) => row.id === input.connection_id);
    if (!connection) throw new NotFoundError("Integration connection not found in active workspace");
    await assertDataQualityTarget(orgId, input.label_suite_object_type, input.label_suite_object_id);
    const link = await upsertExternalObjectLink(orgId, {
      ...input,
      provider_key: connection.provider_key,
      status: "active",
    });
    const updated = await updateDataQualityIssue(orgId, {
      id: issue.id,
      status: "resolved",
      label_suite_object_type: input.label_suite_object_type,
      label_suite_object_id: input.label_suite_object_id,
      details: { ...issue.details, resolution: "linked", link_id: link.id },
    });
    await recordAuditEvent(orgId, {
      actor_user_id: locals.user?.id ?? null,
      actor_type: "user",
      event_type: "data_quality_issue.resolved",
      object_type: "data_quality_issue",
      object_id: issue.id,
      before: { status: issue.status, label_suite_object_type: issue.label_suite_object_type, label_suite_object_id: issue.label_suite_object_id },
      after: { status: updated.status, link_id: link.id, label_suite_object_type: input.label_suite_object_type, label_suite_object_id: input.label_suite_object_id },
      metadata: { action: "link_external_object" },
    });
    return json({ issue: updated, link });
  } catch (error) {
    return handleApiError(error);
  }
};
