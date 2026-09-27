import { and, desc, eq } from "drizzle-orm";
import { audit_logs } from "../db/schema";
import { db } from "../lib/db";

export interface AuditLogInput {
  orgId: string;
  actorUserId?: string | null;
  requestId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  id?: string;
}

export interface AuditLogWriter {
  insertAuditLog(input: AuditLogInput): Promise<void>;
}

type DrizzleAuditExecutor = Pick<typeof db, "insert">;

export async function writeAuditLog(
  input: AuditLogInput,
  executor: DrizzleAuditExecutor | AuditLogWriter = db,
): Promise<void> {
  if ("insertAuditLog" in executor) {
    await executor.insertAuditLog(input);
    return;
  }

  await executor.insert(audit_logs).values({
    id: input.id ?? crypto.randomUUID(),
    org_id: input.orgId,
    actor_user_id: input.actorUserId ?? null,
    request_id: input.requestId ?? null,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before_data: input.beforeData ?? null,
    after_data: input.afterData ?? null,
    metadata: input.metadata ?? null,
  });
}

export interface AuditLogFilter {
  entityType?: string;
  entityId?: string;
  actorUserId?: string;
  limit?: number;
}

export async function listAuditLogs(orgId: string, filter: AuditLogFilter = {}) {
  const conditions = [eq(audit_logs.org_id, orgId)];
  if (filter.entityType) conditions.push(eq(audit_logs.entity_type, filter.entityType));
  if (filter.entityId) conditions.push(eq(audit_logs.entity_id, filter.entityId));
  if (filter.actorUserId) conditions.push(eq(audit_logs.actor_user_id, filter.actorUserId));

  return db
    .select()
    .from(audit_logs)
    .where(and(...conditions))
    .orderBy(desc(audit_logs.created_at))
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
}
