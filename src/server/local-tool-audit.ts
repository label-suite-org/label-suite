import { z } from "zod";
import type { AuditLogInput, AuditLogWriter } from "./audit";
import { HttpError } from "./errors";
import { LocalToolError } from "./local-tools-api";

const boundedId = z.string().trim().min(1).max(128);

export const localToolNameSchema = z.enum([
  "create_local_tool_token",
  "revoke_local_tool_token",
  "list_enrichment_queue",
  "get_enrichment_item",
  "claim_enrichment_item",
  "release_enrichment_item",
  "submit_enrichment_proposal",
  "label_suite_jobs_health",
  "label_suite_operations_brief",
]);

export const localToolOperationSchema = z.enum([
  "token_create",
  "token_revoke",
  "authenticate",
  "queue_list",
  "item_get",
  "claim",
  "release",
  "proposal_submit",
  "jobs_health",
  "operations_brief",
]);

export const localToolResultCategorySchema = z.enum([
  "created",
  "revoked",
  "authenticated",
  "authentication_failed",
  "scope_forbidden",
  "listed",
  "found",
  "claimed",
  "renewed",
  "reclaimed",
  "released",
  "release_noop",
  "submitted",
  "replayed",
  "invalid_request",
  "not_found",
  "stale_revision",
  "claim_conflict",
  "idempotency_conflict",
  "service_unavailable",
  "internal_error",
  "authorization_failed",
]);

export const localToolOperationEventSchema = z.object({
  requestId: boundedId,
  tokenId: boundedId.optional(),
  orgId: boundedId.optional(),
  userId: boundedId.optional(),
  tool: localToolNameSchema,
  operation: localToolOperationSchema,
  campaignId: boundedId.optional(),
  leadId: boundedId.optional(),
  resourceType: z.enum(["release", "campaign"]).optional(),
  resourceId: boundedId.optional(),
  resultCategory: localToolResultCategorySchema,
  durationMs: z.number().int().min(0).max(86_400_000),
  proposalCount: z.number().int().min(0).max(8),
}).strict();

export type LocalToolOperationEvent = z.infer<typeof localToolOperationEventSchema>;
export type LocalToolResultCategory = z.infer<typeof localToolResultCategorySchema>;

export type LocalToolAuditDependencies = AuditLogWriter & {
  emitTelemetry(event: Record<string, unknown>): void;
};

const defaultDependencies: LocalToolAuditDependencies = {
  async insertAuditLog(input) {
    const { writeAuditLog } = await import("./audit");
    await writeAuditLog(input);
  },
  emitTelemetry(event) {
    console.info(JSON.stringify(event));
  },
};

export function buildLocalToolAuditLogInput(input: unknown): AuditLogInput {
  const event = localToolOperationEventSchema.extend({ orgId: boundedId }).parse(input);
  const metadata: Record<string, unknown> = {
    ...(event.tokenId ? { token_id: event.tokenId } : {}),
    tool: event.tool,
    operation: event.operation,
    ...(event.campaignId ? { campaign_id: event.campaignId } : {}),
    ...(event.leadId ? { lead_id: event.leadId } : {}),
    ...(event.resourceType ? { resource_type: event.resourceType } : {}),
    ...(event.resourceId ? { resource_id: event.resourceId } : {}),
    result_category: event.resultCategory,
    duration_ms: event.durationMs,
    proposal_count: event.proposalCount,
  };
  return {
    orgId: event.orgId,
    actorUserId: event.userId ?? null,
    requestId: event.requestId,
    action: `local_tool.${event.operation}`,
    entityType: event.leadId
      ? "campaign_lead"
      : event.resourceType
        ? event.resourceType
      : event.tokenId
        ? "local_tool_token"
        : "local_tool_operation",
    entityId: event.leadId ?? event.resourceId ?? event.tokenId ?? null,
    metadata,
  };
}

export async function recordLocalToolOperation(
  input: LocalToolOperationEvent,
  dependencies: LocalToolAuditDependencies = defaultDependencies,
): Promise<void> {
  const parsed = localToolOperationEventSchema.safeParse(input);
  if (!parsed.success) return;
  const event = parsed.data;
  const telemetry = {
    event: "local_tool_operation",
    request_id: event.requestId,
    ...(event.tokenId ? { token_id: event.tokenId } : {}),
    ...(event.orgId ? { org_id: event.orgId } : {}),
    ...(event.userId ? { user_id: event.userId } : {}),
    tool: event.tool,
    operation: event.operation,
    ...(event.campaignId ? { campaign_id: event.campaignId } : {}),
    ...(event.leadId ? { lead_id: event.leadId } : {}),
    ...(event.resourceType ? { resource_type: event.resourceType } : {}),
    ...(event.resourceId ? { resource_id: event.resourceId } : {}),
    result_category: event.resultCategory,
    duration_ms: event.durationMs,
    proposal_count: event.proposalCount,
  };

  try {
    dependencies.emitTelemetry(telemetry);
  } catch {
    // Telemetry must never change the primary operation or its safe envelope.
  }
  if (!event.orgId) return;
  try {
    await dependencies.insertAuditLog(buildLocalToolAuditLogInput(event));
  } catch {
    // Audit persistence is awaited best-effort and never exposes storage errors.
  }
}

export function localToolResultCategoryForError(error: unknown): LocalToolResultCategory {
  if (error instanceof LocalToolError) return error.code;
  if (error instanceof z.ZodError) return "invalid_request";
  if (error instanceof HttpError) {
    if (error.status === 400) return "invalid_request";
    if (error.status === 401 || error.status === 403) return "authorization_failed";
    if (error.status === 404) return "not_found";
  }
  return "internal_error";
}

export function boundedLocalToolDurationMs(startedAt: number, endedAt = Date.now()): number {
  return Math.min(Math.max(Math.trunc(endedAt - startedAt), 0), 86_400_000);
}
