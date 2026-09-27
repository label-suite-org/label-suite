import { and, asc, eq, gte, isNull, lte, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { budget_projects, project_events } from "../db/schema";
import { db } from "../lib/db";
import { eventTypeSchema, normalizeProjectEventInput, projectEventRangeSchema, projectEventInputSchema } from "../lib/projects-events-core";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { assertArtistInOrg, assertContactInOrg, assertReleaseInOrg } from "./projects";
import { hasOwn, idSchema } from "./validation";

export const createProjectEventSchema = projectEventInputSchema;

export const updateProjectEventSchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1).optional(),
  event_type: eventTypeSchema.optional(),
  status: z.string().trim().min(1).optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().nullable().optional(),
  starts_at: z.iso.datetime({ offset: true }).nullable().optional(),
  ends_at: z.iso.datetime({ offset: true }).nullable().optional(),
  project_id: z.string().trim().min(1).nullable().optional(),
  artist_id: z.string().trim().min(1).nullable().optional(),
  release_id: z.string().trim().min(1).nullable().optional(),
  contact_id: z.string().trim().min(1).nullable().optional(),
  owner_contact_id: z.string().trim().min(1).nullable().optional(),
  all_day: z.boolean().optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  venue_name: z.string().trim().min(1).nullable().optional(),
  address: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  region: z.string().trim().min(1).nullable().optional(),
  country_code: z.string().trim().min(1).nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
  is_confirmed: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
  if (value.starts_at && value.ends_at && value.ends_at < value.starts_at) {
    ctx.addIssue({ code: "custom", path: ["ends_at"], message: "End time must be on or after start time" });
  }
});

export const projectEventFiltersSchema = z.object({
  project_id: z.string().trim().min(1).nullable().optional(),
  event_type: eventTypeSchema.optional(),
  status: z.string().trim().min(1).optional(),
  start_date: z.iso.date().optional(),
  end_date: z.iso.date().optional(),
});

export type ProjectEventFilters = z.infer<typeof projectEventFiltersSchema>;

export type CreateProjectEventInput = z.input<typeof createProjectEventSchema>;
export type UpdateProjectEventInput = z.input<typeof updateProjectEventSchema>;

export async function assertProjectInOrg(orgId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const [project] = await db
    .select({ id: budget_projects.id })
    .from(budget_projects)
    .where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, projectId)))
    .limit(1);
  if (!project) throw new NotFoundError("Project not found");
}

export async function listProjectEvents(orgId: string, rawFilters: ProjectEventFilters | unknown = {}) {
  const filters = projectEventFiltersSchema.parse(rawFilters);
  const conditions: SQL[] = [eq(project_events.org_id, orgId)];
  if (filters.project_id === null) conditions.push(isNull(project_events.project_id));
  else if (filters.project_id) conditions.push(eq(project_events.project_id, filters.project_id));
  if (filters.event_type) conditions.push(eq(project_events.event_type, filters.event_type));
  if (filters.status) conditions.push(eq(project_events.status, filters.status));
  if (filters.start_date) conditions.push(gte(project_events.start_date, filters.start_date));
  if (filters.end_date) conditions.push(lte(project_events.start_date, filters.end_date));

  return db
    .select()
    .from(project_events)
    .where(and(...conditions))
    .orderBy(asc(project_events.start_date), asc(project_events.starts_at), asc(project_events.title));
}

export async function getProjectEvent(orgId: string, id: string) {
  const rows = await db
    .select()
    .from(project_events)
    .where(and(eq(project_events.org_id, orgId), eq(project_events.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

type EventAuditContext = { actorUserId: string };
function inWriteTransaction<T>(work: (tx: typeof db) => Promise<T>) {
  return db.transaction((tx) => work(tx as unknown as typeof db));
}
const eventMutableFields = [
  "title", "event_type", "status", "start_date", "end_date", "starts_at", "ends_at", "project_id",
  "artist_id", "release_id", "contact_id", "owner_contact_id", "all_day", "timezone", "venue_name",
  "address", "city", "region", "country_code", "notes", "is_confirmed",
] as const;

/** The sole Event write authority; callers choose audit and optional exact PG-text CAS. */
async function writeProjectEventCreate(orgId: string, input: z.infer<typeof createProjectEventSchema>, audit?: EventAuditContext) {
  return inWriteTransaction(async (tx) => {
    await Promise.all([assertProjectInOrg(orgId, input.project_id), assertArtistInOrg(orgId, input.artist_id), assertReleaseInOrg(orgId, input.release_id), assertContactInOrg(orgId, input.contact_id), assertContactInOrg(orgId, input.owner_contact_id)]);
    const id = input.id ?? crypto.randomUUID();
    const values = { ...input, id, org_id: orgId, starts_at: input.starts_at ? new Date(input.starts_at) : null, ends_at: input.ends_at ? new Date(input.ends_at) : null };
    if (!audit) { await tx.insert(project_events).values(values); return { id }; }
    const [row] = await tx.insert(project_events).values(values).returning();
    await recordAuditEvent(orgId, { actor_user_id: audit.actorUserId, event_type: "event.created", object_type: "event", object_id: id, before: null, after: eventAudit(row) }, tx);
    return row;
  });
}

async function writeProjectEventUpdate(orgId: string, input: z.infer<typeof updateProjectEventSchema>, options: { expectedRevision?: string; audit?: EventAuditContext } = {}) {
  return inWriteTransaction(async (tx) => {
    const needsCurrent = options.audit || options.expectedRevision || hasOwn(input, "start_date") || hasOwn(input, "end_date") || hasOwn(input, "starts_at") || hasOwn(input, "ends_at");
    const current = needsCurrent ? (await tx.select().from(project_events).where(and(eq(project_events.org_id, orgId), eq(project_events.id, input.id))).limit(1).for("update"))[0] : null;
    if (needsCurrent && !current) throw new NotFoundError("Event not found");
    if (current) projectEventRangeSchema.parse({ ...current, ...input });
    if (hasOwn(input, "project_id")) await assertProjectInOrg(orgId, input.project_id);
    if (hasOwn(input, "artist_id")) await assertArtistInOrg(orgId, input.artist_id);
    if (hasOwn(input, "release_id")) await assertReleaseInOrg(orgId, input.release_id);
    if (hasOwn(input, "contact_id")) await assertContactInOrg(orgId, input.contact_id);
    if (hasOwn(input, "owner_contact_id")) await assertContactInOrg(orgId, input.owner_contact_id);
    const updates: Record<string, unknown> = { updated_at: sql`greatest(clock_timestamp(), ${project_events.updated_at} + interval '1 microsecond')` };
    for (const field of eventMutableFields) if (hasOwn(input, field)) updates[field] = input[field];
    if (hasOwn(input, "starts_at")) updates.starts_at = input.starts_at ? new Date(input.starts_at) : null;
    if (hasOwn(input, "ends_at")) updates.ends_at = input.ends_at ? new Date(input.ends_at) : null;
    const conditions = [eq(project_events.org_id, orgId), eq(project_events.id, input.id)];
    if (options.expectedRevision) conditions.push(sql`${project_events.updated_at}::text = ${options.expectedRevision}`);
    const [row] = await tx.update(project_events).set(updates).where(and(...conditions)).returning();
    if (!row) { if (options.expectedRevision) throw new ConflictError("Event changed while updating; refresh and retry"); throw new NotFoundError("Event not found"); }
    if (options.audit) await recordAuditEvent(orgId, { actor_user_id: options.audit.actorUserId, event_type: "event.updated", object_type: "event", object_id: row.id, before: eventAudit(current!), after: eventAudit(row) }, tx);
    return row;
  });
}

export async function createProjectEvent(orgId: string, raw: unknown) {
  const row = await writeProjectEventCreate(orgId, normalizeProjectEventInput(raw));
  return { ok: true, id: row.id };
}

export async function updateProjectEvent(orgId: string, raw: unknown) {
  const row = await writeProjectEventUpdate(orgId, updateProjectEventSchema.parse(raw));
  return { ok: true, id: row.id };
}

/** Native adapters only provide native input/CAS/audit context to the canonical writer. */
export async function createProjectEventForNative(orgId: string, raw: unknown, actorUserId: string) {
  const input = createProjectEventSchema.safeExtend({ id: z.never().optional() }).strict().parse(raw);
  return writeProjectEventCreate(orgId, input, { actorUserId });
}

export async function updateProjectEventForNative(orgId: string, raw: unknown, actorUserId: string) {
  const { expected_revision, ...input } = updateProjectEventSchema.safeExtend({ expected_revision: z.string().trim().min(1) }).strict().parse(raw);
  return writeProjectEventUpdate(orgId, input, { expectedRevision: expected_revision, audit: { actorUserId } });
}
function eventAudit(row: typeof project_events.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.org_id,
    ...Object.fromEntries(eventMutableFields.map((field) => {
      const value = row[field];
      return [field, value instanceof Date ? value.toISOString() : value];
    })),
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}
