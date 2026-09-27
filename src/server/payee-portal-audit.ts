import { getRequestId } from "./request-context";
import { writeAuditLog } from "./audit";
import { logEvent } from "./observability";
import { HttpError } from "./errors";

/** Require a durable audit record before releasing sensitive payee data. */
export async function auditPayeeRead(input: {
  orgId: string;
  userId: string;
  entityType: string;
  entityId?: string | null;
  action: "payee_portal.read" | "payee_portal.statement_download";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await writeAuditLog({
      orgId: input.orgId,
      actorUserId: input.userId,
      requestId: getRequestId() ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    logEvent({
      severity: "warn",
      event: "payee_portal.audit_failed",
      orgId: input.orgId,
      operation: input.action,
      errorClass: error instanceof Error ? error.name : "UnknownError",
    });
    throw new HttpError("Payee data is temporarily unavailable. Please try again.", 503);
  }
}
