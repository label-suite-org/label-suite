import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  audit_events,
  data_quality_issues,
  external_object_links,
  integration_connections,
  integration_errors,
  integration_providers,
  raw_integration_events,
  sync_jobs,
  releases,
  tracks,
  works,
  radio_stations,
} from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import {
  chooseExternalObjectMatchCandidate,
  externalObjectMatchMethods,
  type ExternalObjectMatchCandidate,
  type ExternalObjectMatchOptions,
} from "./integration-object-links";
import { hasOwn, idSchema, nullableInteger, nullableText, requiredText } from "./validation";

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const integrationProviderAuthTypes = ["api_key", "oauth", "manual_import", "webhook", "none"] as const;
export const integrationProviderStatuses = ["planned", "private_beta", "active", "deprecated"] as const;
export const integrationConnectionStatuses = ["connected", "needs_attention", "paused", "revoked"] as const;
export const externalObjectLinkStatuses = ["active", "needs_review", "ignored", "archived"] as const;
export const syncJobTypes = ["pull", "push", "webhook", "manual_import", "export", "reconcile"] as const;
export const syncJobStatuses = ["queued", "running", "succeeded", "failed", "partial", "cancelled"] as const;
export const rawIntegrationProcessingStatuses = ["pending", "processed", "failed", "ignored"] as const;
export const integrationErrorSeverities = ["info", "warning", "error", "critical"] as const;
export const dataQualityPriorities = ["P0", "P1", "P2", "P3"] as const;
export const dataQualityStatuses = ["open", "triaged", "resolved", "ignored"] as const;
export const dataQualityObjectTypes = ["release", "track", "work", "station"] as const;
export const auditEventActorTypes = ["user", "system", "integration"] as const;

const providerKeySchema = z.string().trim().min(1).regex(/^[a-z0-9][a-z0-9_-]*$/, {
  message: "Provider key must be lowercase letters, numbers, underscores, or hyphens",
});

export const upsertIntegrationProviderSchema = z.object({
  id: idSchema.optional(),
  key: providerKeySchema,
  name: requiredText,
  category: requiredText,
  capabilities: z.array(z.string().trim().min(1)).optional(),
  auth_type: z.enum(integrationProviderAuthTypes).optional(),
  status: z.enum(integrationProviderStatuses).optional(),
}).strict();

export const createIntegrationConnectionSchema = z.object({
  id: idSchema.optional(),
  provider_id: idSchema,
  label: requiredText,
  status: z.enum(integrationConnectionStatuses).optional(),
  auth_ref: nullableText,
  settings: jsonRecordSchema.optional(),
  created_by: nullableText,
}).strict();

export const updateIntegrationConnectionSchema = z.object({
  id: idSchema,
  label: requiredText.optional(),
  status: z.enum(integrationConnectionStatuses).optional(),
  auth_ref: nullableText.optional(),
  settings: jsonRecordSchema.optional(),
  last_checked_at: z.coerce.date().nullable().optional(),
  last_successful_sync_at: z.coerce.date().nullable().optional(),
}).strict();

export const deleteIntegrationConnectionSchema = z.object({
  id: idSchema,
}).strict();

export const upsertExternalObjectLinkSchema = z.object({
  id: idSchema.optional(),
  connection_id: idSchema,
  provider_key: providerKeySchema,
  external_object_type: requiredText,
  external_object_id: requiredText,
  external_object_url: nullableText,
  label_suite_object_type: requiredText,
  label_suite_object_id: idSchema,
  match_method: z.enum(externalObjectMatchMethods),
  match_confidence: nullableInteger({ min: 0, max: 100 }),
  status: z.enum(externalObjectLinkStatuses).optional(),
  metadata: jsonRecordSchema.optional(),
}).strict();

export const createSyncJobSchema = z.object({
  id: idSchema.optional(),
  connection_id: idSchema,
  provider_key: providerKeySchema,
  job_type: z.enum(syncJobTypes),
  status: z.enum(syncJobStatuses).optional(),
  cursor_before: nullableText,
  cursor_after: nullableText,
  records_seen: nullableInteger({ min: 0 }),
  records_created: nullableInteger({ min: 0 }),
  records_updated: nullableInteger({ min: 0 }),
  records_failed: nullableInteger({ min: 0 }),
  triggered_by: nullableText,
  idempotency_key: nullableText,
  error_summary: nullableText,
  started_at: z.coerce.date().nullable().optional(),
  finished_at: z.coerce.date().nullable().optional(),
}).strict();

export const updateSyncJobSchema = z.object({
  id: idSchema,
  status: z.enum(syncJobStatuses).optional(),
  cursor_after: nullableText.optional(),
  records_seen: nullableInteger({ min: 0 }).optional(),
  records_created: nullableInteger({ min: 0 }).optional(),
  records_updated: nullableInteger({ min: 0 }).optional(),
  records_failed: nullableInteger({ min: 0 }).optional(),
  error_summary: nullableText.optional(),
  started_at: z.coerce.date().nullable().optional(),
  finished_at: z.coerce.date().nullable().optional(),
}).strict();

export const recordRawIntegrationEventSchema = z.object({
  id: idSchema.optional(),
  connection_id: idSchema,
  sync_job_id: idSchema.optional(),
  provider_key: providerKeySchema,
  event_type: requiredText,
  external_object_type: nullableText,
  external_object_id: nullableText,
  idempotency_key: nullableText,
  occurred_at: z.coerce.date().nullable().optional(),
  received_at: z.coerce.date().optional(),
  payload: jsonRecordSchema,
  payload_hash: z.string().trim().min(1).optional(),
  processing_status: z.enum(rawIntegrationProcessingStatuses).optional(),
  processing_error: nullableText,
}).strict();

export const updateRawIntegrationEventSchema = z.object({
  id: idSchema,
  processing_status: z.enum(rawIntegrationProcessingStatuses),
  processing_error: nullableText,
}).strict();

export const recordIntegrationErrorSchema = z.object({
  id: idSchema.optional(),
  connection_id: idSchema,
  sync_job_id: idSchema.optional(),
  severity: z.enum(integrationErrorSeverities).optional(),
  code: nullableText,
  message: requiredText,
  external_object_type: nullableText,
  external_object_id: nullableText,
  resolved_at: z.coerce.date().nullable().optional(),
  resolved_by: nullableText,
  metadata: jsonRecordSchema.optional(),
}).strict();

export const resolveIntegrationErrorSchema = z.object({
  id: idSchema,
  resolved_by: nullableText,
}).strict();

export const createDataQualityIssueSchema = z.object({
  id: idSchema.optional(),
  connection_id: idSchema.optional(),
  sync_job_id: idSchema.optional(),
  source: requiredText,
  issue_type: requiredText,
  idempotency_key: nullableText,
  priority: z.enum(dataQualityPriorities).optional(),
  status: z.enum(dataQualityStatuses).optional(),
  label_suite_object_type: nullableText,
  label_suite_object_id: nullableText,
  external_object_type: nullableText,
  external_object_id: nullableText,
  details: jsonRecordSchema.optional(),
}).strict();

export const updateDataQualityIssueSchema = z.object({
  id: idSchema,
  priority: z.enum(dataQualityPriorities).optional(),
  status: z.enum(dataQualityStatuses).optional(),
  label_suite_object_type: nullableText,
  label_suite_object_id: nullableText,
  details: jsonRecordSchema.optional(),
}).strict();

export const dataQualityObjectTypeSchema = z.enum(dataQualityObjectTypes);

export const recordAuditEventSchema = z.object({
  id: idSchema.optional(),
  actor_user_id: nullableText,
  actor_type: z.enum(auditEventActorTypes).optional(),
  event_type: requiredText,
  object_type: requiredText,
  object_id: nullableText,
  before: jsonRecordSchema.nullable().optional(),
  after: jsonRecordSchema.nullable().optional(),
  metadata: jsonRecordSchema.optional(),
}).strict();

export type UpsertIntegrationProviderInput = z.infer<typeof upsertIntegrationProviderSchema>;
export type CreateIntegrationConnectionInput = z.infer<typeof createIntegrationConnectionSchema>;
export type UpdateIntegrationConnectionInput = z.infer<typeof updateIntegrationConnectionSchema>;
export type UpsertExternalObjectLinkInput = z.infer<typeof upsertExternalObjectLinkSchema>;
export type CreateSyncJobInput = z.infer<typeof createSyncJobSchema>;
export type UpdateSyncJobInput = z.infer<typeof updateSyncJobSchema>;
export type RecordRawIntegrationEventInput = z.infer<typeof recordRawIntegrationEventSchema>;
export type RecordIntegrationErrorInput = z.infer<typeof recordIntegrationErrorSchema>;
export type CreateDataQualityIssueInput = z.infer<typeof createDataQualityIssueSchema>;
export type RecordAuditEventInput = z.infer<typeof recordAuditEventSchema>;

export function chooseBestExternalObjectLinkCandidate(
  orgId: string,
  candidates: ExternalObjectMatchCandidate[],
  options: Omit<ExternalObjectMatchOptions, "orgId"> = {},
) {
  return chooseExternalObjectMatchCandidate(candidates, { ...options, orgId });
}

function safeIdPart(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "integration";
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJsonStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function hashIntegrationPayload(payload: Record<string, unknown>) {
  return createHash("sha256").update(stableJsonStringify(payload)).digest("hex");
}

export function deriveSyncJobIdempotencyKey(input: Pick<CreateSyncJobInput, "connection_id" | "provider_key" | "job_type" | "cursor_before" | "triggered_by" | "idempotency_key">) {
  if (input.idempotency_key) return input.idempotency_key;
  return [
    "sync",
    input.connection_id,
    input.provider_key,
    input.job_type,
    input.cursor_before ?? "initial",
    input.triggered_by ?? "system",
  ].join(":");
}

export function deriveRawEventIdempotencyKey(
  input: Pick<RecordRawIntegrationEventInput, "provider_key" | "event_type" | "external_object_type" | "external_object_id" | "idempotency_key">,
  payloadHash: string,
) {
  if (input.idempotency_key) return input.idempotency_key;
  return [
    "raw",
    input.provider_key,
    input.event_type,
    input.external_object_type ?? "event",
    input.external_object_id ?? payloadHash,
    payloadHash,
  ].join(":");
}

export function deriveDataQualityIssueIdempotencyKey(input: Pick<
  CreateDataQualityIssueInput,
  | "source"
  | "issue_type"
  | "idempotency_key"
  | "label_suite_object_type"
  | "label_suite_object_id"
  | "external_object_type"
  | "external_object_id"
  | "details"
>) {
  if (input.idempotency_key) return input.idempotency_key;
  return [
    "dq",
    input.source,
    input.issue_type,
    input.label_suite_object_type ?? "no_label_suite_object",
    input.label_suite_object_id ?? "no_label_suite_object_id",
    input.external_object_type ?? "no_external_object",
    input.external_object_id ?? "no_external_object_id",
  ].join(":");
}

async function findExistingSyncJobByIdempotency(orgId: string, connectionId: string, idempotencyKey: string) {
  const [row] = await db
    .select()
    .from(sync_jobs)
    .where(and(
      eq(sync_jobs.org_id, orgId),
      eq(sync_jobs.connection_id, connectionId),
      eq(sync_jobs.idempotency_key, idempotencyKey),
    ))
    .limit(1);

  if (!row) throw new NotFoundError("Sync job not found after idempotent replay");
  return row;
}

async function findExistingRawIntegrationEventByIdempotency(
  orgId: string,
  connectionId: string,
  idempotencyKey: string,
) {
  const [row] = await db
    .select()
    .from(raw_integration_events)
    .where(and(
      eq(raw_integration_events.org_id, orgId),
      eq(raw_integration_events.connection_id, connectionId),
      eq(raw_integration_events.idempotency_key, idempotencyKey),
    ))
    .limit(1);

  if (!row) throw new NotFoundError("Raw integration event not found after idempotent replay");
  return row;
}

export async function listIntegrationProviders(orgId: string) {
  return db
    .select()
    .from(integration_providers)
    .where(and(eq(integration_providers.org_id, orgId), ne(integration_providers.key, "warm")))
    .orderBy(asc(integration_providers.category), asc(integration_providers.name));
}

export async function upsertIntegrationProvider(orgId: string, raw: z.input<typeof upsertIntegrationProviderSchema>) {
  const input = upsertIntegrationProviderSchema.parse(raw);
  const id = input.id ?? `provider_${safeIdPart(orgId)}_${safeIdPart(input.key)}`;
  const [row] = await db
    .insert(integration_providers)
    .values({
      id,
      org_id: orgId,
      key: input.key,
      name: input.name,
      category: input.category,
      capabilities: input.capabilities ?? [],
      auth_type: input.auth_type ?? "none",
      status: input.status ?? "planned",
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [integration_providers.org_id, integration_providers.key],
      set: {
        name: input.name,
        category: input.category,
        capabilities: input.capabilities ?? [],
        auth_type: input.auth_type ?? "none",
        status: input.status ?? "planned",
        updated_at: new Date(),
      },
    })
    .returning();

  return row;
}

export async function getIntegrationProvider(orgId: string, id: string) {
  const [provider] = await db
    .select()
    .from(integration_providers)
    .where(and(eq(integration_providers.org_id, orgId), eq(integration_providers.id, id)))
    .limit(1);

  if (!provider) throw new NotFoundError("Integration provider not found in active workspace");
  return provider;
}

export async function listIntegrationConnections(orgId: string) {
  return db
    .select({
      id: integration_connections.id,
      org_id: integration_connections.org_id,
      provider_id: integration_connections.provider_id,
      provider_key: integration_providers.key,
      provider_name: integration_providers.name,
      provider_category: integration_providers.category,
      label: integration_connections.label,
      status: integration_connections.status,
      auth_ref: integration_connections.auth_ref,
      settings: integration_connections.settings,
      last_checked_at: integration_connections.last_checked_at,
      last_successful_sync_at: integration_connections.last_successful_sync_at,
      created_by: integration_connections.created_by,
      created_at: integration_connections.created_at,
      updated_at: integration_connections.updated_at,
    })
    .from(integration_connections)
    .innerJoin(integration_providers, eq(integration_connections.provider_id, integration_providers.id))
    .where(and(eq(integration_connections.org_id, orgId), eq(integration_providers.org_id, orgId)))
    .orderBy(asc(integration_providers.name), asc(integration_connections.label));
}

export async function getIntegrationConnection(orgId: string, id: string) {
  const [connection] = await db
    .select()
    .from(integration_connections)
    .where(and(eq(integration_connections.org_id, orgId), eq(integration_connections.id, id)))
    .limit(1);

  if (!connection) throw new NotFoundError("Integration connection not found in active workspace");
  return connection;
}

export async function createIntegrationConnection(orgId: string, raw: z.input<typeof createIntegrationConnectionSchema>) {
  const input = createIntegrationConnectionSchema.parse(raw);
  const id = input.id ?? `iconn_${crypto.randomUUID()}`;
  const [row] = await db
    .insert(integration_connections)
    .values({
      id,
      org_id: orgId,
      provider_id: input.provider_id,
      label: input.label,
      status: input.status ?? "connected",
      auth_ref: input.auth_ref ?? null,
      settings: input.settings ?? {},
      created_by: input.created_by ?? null,
      updated_at: new Date(),
    })
    .returning();

  return row;
}

export async function updateIntegrationConnection(orgId: string, raw: z.input<typeof updateIntegrationConnectionSchema>) {
  const input = updateIntegrationConnectionSchema.parse(raw);
  const patch: Record<string, unknown> = { updated_at: new Date() };

  for (const key of [
    "label",
    "status",
    "auth_ref",
    "settings",
    "last_checked_at",
    "last_successful_sync_at",
  ] as const) {
    if (hasOwn(input, key)) patch[key] = input[key] ?? null;
  }

  const rows = await db
    .update(integration_connections)
    .set(patch)
    .where(and(eq(integration_connections.org_id, orgId), eq(integration_connections.id, input.id)))
    .returning();

  if (!rows.length) throw new NotFoundError("Integration connection not found in active workspace");
  return rows[0];
}

export async function deleteIntegrationConnection(orgId: string, raw: z.input<typeof deleteIntegrationConnectionSchema>) {
  const input = deleteIntegrationConnectionSchema.parse(raw);
  const rows = await db
    .delete(integration_connections)
    .where(and(eq(integration_connections.org_id, orgId), eq(integration_connections.id, input.id)))
    .returning({ id: integration_connections.id });

  if (!rows.length) throw new NotFoundError("Integration connection not found in active workspace");
  return { ok: true };
}

export async function listExternalObjectLinks(
  orgId: string,
  filter: {
    connection_id?: string;
    provider_key?: string;
    status?: typeof externalObjectLinkStatuses[number];
  } = {},
) {
  const conditions = [eq(external_object_links.org_id, orgId)];
  if (filter.connection_id) conditions.push(eq(external_object_links.connection_id, filter.connection_id));
  if (filter.provider_key) conditions.push(eq(external_object_links.provider_key, filter.provider_key));
  if (filter.status) conditions.push(eq(external_object_links.status, filter.status));

  return db
    .select()
    .from(external_object_links)
    .where(and(...conditions))
    .orderBy(desc(external_object_links.updated_at));
}

export async function upsertExternalObjectLink(orgId: string, raw: z.input<typeof upsertExternalObjectLinkSchema>) {
  const input = upsertExternalObjectLinkSchema.parse(raw);
  const id = input.id ?? `xlink_${crypto.randomUUID()}`;
  const [row] = await db
    .insert(external_object_links)
    .values({
      id,
      org_id: orgId,
      connection_id: input.connection_id,
      provider_key: input.provider_key,
      external_object_type: input.external_object_type,
      external_object_id: input.external_object_id,
      external_object_url: input.external_object_url ?? null,
      label_suite_object_type: input.label_suite_object_type,
      label_suite_object_id: input.label_suite_object_id,
      match_method: input.match_method,
      match_confidence: input.match_confidence ?? null,
      status: input.status ?? "active",
      metadata: input.metadata ?? {},
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        external_object_links.org_id,
        external_object_links.connection_id,
        external_object_links.external_object_type,
        external_object_links.external_object_id,
      ],
      set: {
        provider_key: input.provider_key,
        external_object_url: input.external_object_url ?? null,
        label_suite_object_type: input.label_suite_object_type,
        label_suite_object_id: input.label_suite_object_id,
        match_method: input.match_method,
        match_confidence: input.match_confidence ?? null,
        status: input.status ?? "active",
        metadata: input.metadata ?? {},
        updated_at: new Date(),
      },
    })
    .returning();

  return row;
}

export async function createSyncJob(orgId: string, raw: z.input<typeof createSyncJobSchema>) {
  const input = createSyncJobSchema.parse(raw);
  const id = input.id ?? `sync_${crypto.randomUUID()}`;
  const idempotencyKey = deriveSyncJobIdempotencyKey(input);
  const rows = await db
    .insert(sync_jobs)
    .values({
      id,
      org_id: orgId,
      connection_id: input.connection_id,
      provider_key: input.provider_key,
      job_type: input.job_type,
      status: input.status ?? "queued",
      cursor_before: input.cursor_before ?? null,
      cursor_after: input.cursor_after ?? null,
      records_seen: input.records_seen ?? 0,
      records_created: input.records_created ?? 0,
      records_updated: input.records_updated ?? 0,
      records_failed: input.records_failed ?? 0,
      triggered_by: input.triggered_by ?? null,
      idempotency_key: idempotencyKey,
      error_summary: input.error_summary ?? null,
      started_at: input.started_at ?? null,
      finished_at: input.finished_at ?? null,
      updated_at: new Date(),
    })
    .onConflictDoNothing({
      target: [sync_jobs.org_id, sync_jobs.connection_id, sync_jobs.idempotency_key],
    })
    .returning();

  return rows[0] ?? findExistingSyncJobByIdempotency(orgId, input.connection_id, idempotencyKey);
}

export async function updateSyncJob(orgId: string, raw: z.input<typeof updateSyncJobSchema>) {
  const input = updateSyncJobSchema.parse(raw);
  const patch: Record<string, unknown> = { updated_at: new Date() };

  for (const key of [
    "status",
    "cursor_after",
    "records_seen",
    "records_created",
    "records_updated",
    "records_failed",
    "error_summary",
    "started_at",
    "finished_at",
  ] as const) {
    if (hasOwn(input, key)) patch[key] = input[key] ?? null;
  }

  const rows = await db
    .update(sync_jobs)
    .set(patch)
    .where(and(eq(sync_jobs.org_id, orgId), eq(sync_jobs.id, input.id)))
    .returning();

  if (!rows.length) throw new NotFoundError("Sync job not found in active workspace");
  return rows[0];
}

export async function listSyncJobs(
  orgId: string,
  filter: {
    connection_id?: string;
    status?: typeof syncJobStatuses[number];
  } = {},
) {
  const conditions = [eq(sync_jobs.org_id, orgId)];
  if (filter.connection_id) conditions.push(eq(sync_jobs.connection_id, filter.connection_id));
  if (filter.status) conditions.push(eq(sync_jobs.status, filter.status));

  return db
    .select()
    .from(sync_jobs)
    .where(and(...conditions))
    .orderBy(desc(sync_jobs.created_at));
}

export async function recordRawIntegrationEvent(orgId: string, raw: z.input<typeof recordRawIntegrationEventSchema>) {
  const input = recordRawIntegrationEventSchema.parse(raw);
  const id = input.id ?? `rawevt_${crypto.randomUUID()}`;
  const payloadHash = input.payload_hash ?? hashIntegrationPayload(input.payload);
  const idempotencyKey = deriveRawEventIdempotencyKey(input, payloadHash);
  const rows = await db
    .insert(raw_integration_events)
    .values({
      id,
      org_id: orgId,
      connection_id: input.connection_id,
      sync_job_id: input.sync_job_id ?? null,
      provider_key: input.provider_key,
      event_type: input.event_type,
      external_object_type: input.external_object_type ?? null,
      external_object_id: input.external_object_id ?? null,
      idempotency_key: idempotencyKey,
      occurred_at: input.occurred_at ?? null,
      received_at: input.received_at ?? new Date(),
      payload: input.payload,
      payload_hash: payloadHash,
      processing_status: input.processing_status ?? "pending",
      processing_error: input.processing_error ?? null,
    })
    .onConflictDoNothing({
      target: [
        raw_integration_events.org_id,
        raw_integration_events.connection_id,
        raw_integration_events.idempotency_key,
      ],
    })
    .returning();

  return rows[0] ?? findExistingRawIntegrationEventByIdempotency(orgId, input.connection_id, idempotencyKey);
}

export async function updateRawIntegrationEventProcessingStatus(
  orgId: string,
  raw: z.input<typeof updateRawIntegrationEventSchema>,
) {
  const input = updateRawIntegrationEventSchema.parse(raw);
  const rows = await db
    .update(raw_integration_events)
    .set({
      processing_status: input.processing_status,
      processing_error: input.processing_error ?? null,
    })
    .where(and(eq(raw_integration_events.org_id, orgId), eq(raw_integration_events.id, input.id)))
    .returning();

  if (!rows.length) throw new NotFoundError("Raw integration event not found in active workspace");
  return rows[0];
}

export async function listRawIntegrationEvents(
  orgId: string,
  filter: {
    connection_id?: string;
    sync_job_id?: string;
    processing_status?: typeof rawIntegrationProcessingStatuses[number];
  } = {},
) {
  const conditions = [eq(raw_integration_events.org_id, orgId)];
  if (filter.connection_id) conditions.push(eq(raw_integration_events.connection_id, filter.connection_id));
  if (filter.sync_job_id) conditions.push(eq(raw_integration_events.sync_job_id, filter.sync_job_id));
  if (filter.processing_status) conditions.push(eq(raw_integration_events.processing_status, filter.processing_status));

  return db
    .select()
    .from(raw_integration_events)
    .where(and(...conditions))
    .orderBy(desc(raw_integration_events.received_at));
}

export async function recordIntegrationError(orgId: string, raw: z.input<typeof recordIntegrationErrorSchema>) {
  const input = recordIntegrationErrorSchema.parse(raw);
  const id = input.id ?? `ierr_${crypto.randomUUID()}`;
  const [row] = await db
    .insert(integration_errors)
    .values({
      id,
      org_id: orgId,
      connection_id: input.connection_id,
      sync_job_id: input.sync_job_id ?? null,
      severity: input.severity ?? "warning",
      code: input.code ?? null,
      message: input.message,
      external_object_type: input.external_object_type ?? null,
      external_object_id: input.external_object_id ?? null,
      resolved_at: input.resolved_at ?? null,
      resolved_by: input.resolved_by ?? null,
      metadata: input.metadata ?? {},
      updated_at: new Date(),
    })
    .returning();

  return row;
}

export async function resolveIntegrationError(orgId: string, raw: z.input<typeof resolveIntegrationErrorSchema>) {
  const input = resolveIntegrationErrorSchema.parse(raw);
  const rows = await db
    .update(integration_errors)
    .set({
      resolved_at: new Date(),
      resolved_by: input.resolved_by ?? null,
      updated_at: new Date(),
    })
    .where(and(eq(integration_errors.org_id, orgId), eq(integration_errors.id, input.id)))
    .returning();

  if (!rows.length) throw new NotFoundError("Integration error not found in active workspace");
  return rows[0];
}

export async function listIntegrationErrors(
  orgId: string,
  filter: {
    connection_id?: string;
    include_resolved?: boolean;
  } = {},
) {
  const conditions = [eq(integration_errors.org_id, orgId)];
  if (filter.connection_id) conditions.push(eq(integration_errors.connection_id, filter.connection_id));
  if (!filter.include_resolved) conditions.push(isNull(integration_errors.resolved_at));

  return db
    .select()
    .from(integration_errors)
    .where(and(...conditions))
    .orderBy(desc(integration_errors.created_at));
}

export async function createDataQualityIssue(orgId: string, raw: z.input<typeof createDataQualityIssueSchema>) {
  const input = createDataQualityIssueSchema.parse(raw);
  const id = input.id ?? `dq_${crypto.randomUUID()}`;
  const status = input.status ?? "open";
  const idempotencyKey = deriveDataQualityIssueIdempotencyKey(input);
  const [row] = await db
    .insert(data_quality_issues)
    .values({
      id,
      org_id: orgId,
      connection_id: input.connection_id ?? null,
      sync_job_id: input.sync_job_id ?? null,
      source: input.source,
      issue_type: input.issue_type,
      idempotency_key: idempotencyKey,
      priority: input.priority ?? "P2",
      status,
      label_suite_object_type: input.label_suite_object_type ?? null,
      label_suite_object_id: input.label_suite_object_id ?? null,
      external_object_type: input.external_object_type ?? null,
      external_object_id: input.external_object_id ?? null,
      details: input.details ?? {},
      updated_at: new Date(),
    })
    .onConflictDoUpdate({
      target: [data_quality_issues.org_id, data_quality_issues.idempotency_key],
      set: {
        priority: input.priority ?? "P2",
        status: sql`case when ${data_quality_issues.status} in ('resolved', 'ignored') then ${data_quality_issues.status} else ${status} end`,
        label_suite_object_type: sql`case when ${data_quality_issues.status} in ('resolved', 'ignored') then ${data_quality_issues.label_suite_object_type} else ${input.label_suite_object_type ?? null} end`,
        label_suite_object_id: sql`case when ${data_quality_issues.status} in ('resolved', 'ignored') then ${data_quality_issues.label_suite_object_id} else ${input.label_suite_object_id ?? null} end`,
        details: sql`case when ${data_quality_issues.status} in ('resolved', 'ignored') then ${data_quality_issues.details} else ${input.details ?? {}} end`,
        updated_at: new Date(),
      },
    })
    .returning();

  return row;
}

export async function updateDataQualityIssue(orgId: string, raw: z.input<typeof updateDataQualityIssueSchema>) {
  const input = updateDataQualityIssueSchema.parse(raw);
  const patch: Record<string, unknown> = { updated_at: new Date() };

  for (const key of ["priority", "status", "label_suite_object_type", "label_suite_object_id", "details"] as const) {
    if (hasOwn(input, key)) patch[key] = input[key];
  }

  const rows = await db
    .update(data_quality_issues)
    .set(patch)
    .where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.id, input.id)))
    .returning();

  if (!rows.length) throw new NotFoundError("Data quality issue not found in active workspace");
  return rows[0];
}

export async function getDataQualityIssue(orgId: string, id: string) {
  const [row] = await db
    .select()
    .from(data_quality_issues)
    .where(and(eq(data_quality_issues.org_id, orgId), eq(data_quality_issues.id, id)))
    .limit(1);

  if (!row) throw new NotFoundError("Data quality issue not found in active workspace");
  return row;
}

export async function listDataQualityIssues(
  orgId: string,
  filter: {
    connection_id?: string;
    source?: string;
    priority?: typeof dataQualityPriorities[number];
    status?: typeof dataQualityStatuses[number];
    label_suite_object_type?: string;
  } = {},
) {
  const conditions = [eq(data_quality_issues.org_id, orgId)];
  if (filter.connection_id) conditions.push(eq(data_quality_issues.connection_id, filter.connection_id));
  if (filter.source) conditions.push(eq(data_quality_issues.source, filter.source));
  if (filter.priority) conditions.push(eq(data_quality_issues.priority, filter.priority));
  if (filter.status) conditions.push(eq(data_quality_issues.status, filter.status));
  if (filter.label_suite_object_type) conditions.push(eq(data_quality_issues.label_suite_object_type, filter.label_suite_object_type));

  return db
    .select()
    .from(data_quality_issues)
    .where(and(...conditions))
    .orderBy(asc(data_quality_issues.priority), desc(data_quality_issues.created_at));
}

export async function listDataQualityTargetOptions(orgId: string) {
  const [releaseRows, trackRows, workRows, stationRows] = await Promise.all([
    db.select({ id: releases.id, label: releases.title }).from(releases).where(eq(releases.org_id, orgId)).orderBy(asc(releases.title)),
    db.select({ id: tracks.id, label: tracks.title }).from(tracks).where(eq(tracks.org_id, orgId)).orderBy(asc(tracks.title)),
    db.select({ id: works.id, label: works.title }).from(works).where(eq(works.org_id, orgId)).orderBy(asc(works.title)),
    db.select({ id: radio_stations.id, label: radio_stations.name }).from(radio_stations).where(eq(radio_stations.org_id, orgId)).orderBy(asc(radio_stations.name)),
  ]);
  return {
    release: releaseRows,
    track: trackRows,
    work: workRows,
    station: stationRows,
  };
}

/** Validates a canonical target in the active workspace before an external link is persisted. */
export async function assertDataQualityTarget(
  orgId: string,
  objectType: z.input<typeof dataQualityObjectTypeSchema>,
  objectId: string,
) {
  const type = dataQualityObjectTypeSchema.parse(objectType);
  const table = type === "release" ? releases : type === "track" ? tracks : type === "work" ? works : radio_stations;
  const [row] = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.org_id, orgId), eq(table.id, objectId)))
    .limit(1).for("share");

  if (!row) throw new NotFoundError(`Target ${type} was not found in active workspace`);
  return row;
}

type AuditEventDbClient = Pick<typeof db, "insert">;

export async function recordAuditEvent(
  orgId: string,
  raw: z.input<typeof recordAuditEventSchema>,
  client: AuditEventDbClient = db,
) {
  const input = recordAuditEventSchema.parse(raw);
  const id = input.id ?? `auditevt_${crypto.randomUUID()}`;
  const [row] = await client
    .insert(audit_events)
    .values({
      id,
      org_id: orgId,
      actor_user_id: input.actor_user_id ?? null,
      actor_type: input.actor_type ?? "user",
      event_type: input.event_type,
      object_type: input.object_type,
      object_id: input.object_id ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata ?? {},
    })
    .returning();

  return row;
}

export async function listAuditEvents(
  orgId: string,
  filter: {
    object_type?: string;
    object_id?: string;
    actor_user_id?: string;
    limit?: number;
  } = {},
) {
  const conditions = [eq(audit_events.org_id, orgId)];
  if (filter.object_type) conditions.push(eq(audit_events.object_type, filter.object_type));
  if (filter.object_id) conditions.push(eq(audit_events.object_id, filter.object_id));
  if (filter.actor_user_id) conditions.push(eq(audit_events.actor_user_id, filter.actor_user_id));

  return db
    .select()
    .from(audit_events)
    .where(and(...conditions))
    .orderBy(desc(audit_events.created_at))
    .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500));
}
