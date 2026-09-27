import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { artists, budget_projects, contacts, releases } from "../db/schema";
import { db } from "../lib/db";
import { normalizeProjectInput, projectDateRangeSchema, projectInputSchema, projectTypeSchema } from "../lib/projects-events-core";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";
import { hasOwn, idSchema } from "./validation";

export const createProjectSchema = projectInputSchema;

export const updateProjectSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, "name is required").optional(),
  project_type: projectTypeSchema.optional(),
  artist_id: z.string().trim().min(1).nullable().optional(),
  release_id: z.string().trim().min(1).nullable().optional(),
  description: z.string().trim().min(1).nullable().optional(),
  owner_contact_id: z.string().trim().min(1).nullable().optional(),
  status: z.string().trim().min(1).optional(),
  start_date: z.iso.date().nullable().optional(),
  end_date: z.iso.date().nullable().optional(),
  location_name: z.string().trim().min(1).nullable().optional(),
  country_code: z.string().trim().min(1).nullable().optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  health: z.string().trim().min(1).optional(),
  cover_image_url: z.string().trim().min(1).nullable().optional(),
  currency: z.string().trim().min(1).optional(),
  total_planned: z.number().optional(),
  baseline_funding: z.number().optional(),
  track_count: z.number().nullable().optional(),
  singles_count: z.number().nullable().optional(),
  notes: z.string().trim().min(1).nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.start_date && value.end_date && value.end_date < value.start_date) {
    ctx.addIssue({ code: "custom", path: ["end_date"], message: "End date must be on or after start date" });
  }
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export async function assertArtistInOrg(orgId: string, artistId: string | null | undefined) {
  if (!artistId) return;
  const [artist] = await db
    .select({ id: artists.id })
    .from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
    .limit(1);
  if (!artist) throw new NotFoundError("Artist not found in active workspace");
}

export async function assertReleaseInOrg(orgId: string, releaseId: string | null | undefined) {
  if (!releaseId) return;
  const [release] = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)))
    .limit(1);
  if (!release) throw new NotFoundError("Release not found in active workspace");
}

export async function assertContactInOrg(orgId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.org_id, orgId), eq(contacts.id, contactId)))
    .limit(1);
  if (!contact) throw new NotFoundError("Contact not found in active workspace");
}

export async function listProjects(orgId: string) {
  return db
    .select()
    .from(budget_projects)
    .where(eq(budget_projects.org_id, orgId))
    .orderBy(asc(budget_projects.name));
}

export async function getProject(orgId: string, id: string) {
  const rows = await db
    .select()
    .from(budget_projects)
    .where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

type ProjectAuditContext = { actorUserId: string };
function inWriteTransaction<T>(work: (tx: typeof db) => Promise<T>) {
  return db.transaction((tx) => work(tx as unknown as typeof db));
}
const projectMutableFields = [
  "name", "project_type", "artist_id", "release_id", "description", "owner_contact_id", "status",
  "start_date", "end_date", "location_name", "country_code", "timezone", "health", "cover_image_url",
  "currency", "total_planned", "baseline_funding", "track_count", "singles_count", "notes",
] as const;

/** The sole Project write authority; callers choose audit and optional exact PG-text CAS. */
async function writeProjectCreate(orgId: string, input: z.infer<typeof createProjectSchema>, audit?: ProjectAuditContext) {
  return inWriteTransaction(async (tx) => {
    await Promise.all([assertArtistInOrg(orgId, input.artist_id), assertReleaseInOrg(orgId, input.release_id), assertContactInOrg(orgId, input.owner_contact_id)]);
    const id = input.id ?? crypto.randomUUID();
    const values = { ...input, id, org_id: orgId };
    if (!audit) { await tx.insert(budget_projects).values(values); return { id }; }
    const [row] = await tx.insert(budget_projects).values(values).returning();
    await recordAuditEvent(orgId, { actor_user_id: audit.actorUserId, event_type: "project.created", object_type: "project", object_id: id, before: null, after: projectAudit(row) }, tx);
    return row;
  });
}

async function writeProjectUpdate(orgId: string, input: z.infer<typeof updateProjectSchema>, options: { expectedRevision?: string; audit?: ProjectAuditContext } = {}) {
  return inWriteTransaction(async (tx) => {
    const needsCurrent = options.audit || options.expectedRevision || hasOwn(input, "start_date") || hasOwn(input, "end_date");
    const current = needsCurrent ? (await tx.select().from(budget_projects).where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, input.id))).limit(1).for("update"))[0] : null;
    if (needsCurrent && !current) throw new NotFoundError("Project not found");
    if (current) projectDateRangeSchema.parse({ ...current, ...input });
    if (hasOwn(input, "artist_id")) await assertArtistInOrg(orgId, input.artist_id);
    if (hasOwn(input, "release_id")) await assertReleaseInOrg(orgId, input.release_id);
    if (hasOwn(input, "owner_contact_id")) await assertContactInOrg(orgId, input.owner_contact_id);
    const updates: Record<string, unknown> = { updated_at: sql`greatest(clock_timestamp(), ${budget_projects.updated_at} + interval '1 microsecond')` };
    for (const field of projectMutableFields) if (hasOwn(input, field)) updates[field] = input[field];
    const conditions = [eq(budget_projects.org_id, orgId), eq(budget_projects.id, input.id)];
    if (options.expectedRevision) conditions.push(sql`${budget_projects.updated_at}::text = ${options.expectedRevision}`);
    const [row] = await tx.update(budget_projects).set(updates).where(and(...conditions)).returning();
    if (!row) { if (options.expectedRevision) throw new ConflictError("Project changed while updating; refresh and retry"); throw new NotFoundError("Project not found"); }
    if (options.audit) await recordAuditEvent(orgId, { actor_user_id: options.audit.actorUserId, event_type: "project.updated", object_type: "project", object_id: row.id, before: projectAudit(current!), after: projectAudit(row) }, tx);
    return row;
  });
}

export async function createProject(orgId: string, raw: unknown) {
  const row = await writeProjectCreate(orgId, normalizeProjectInput(raw));
  return { ok: true, id: row.id };
}

export async function updateProject(orgId: string, raw: unknown) {
  const row = await writeProjectUpdate(orgId, updateProjectSchema.parse(raw));
  return { ok: true, id: row.id };
}

/** Native adapters only provide native input/CAS/audit context to the canonical writer. */
export async function createProjectForNative(orgId: string, raw: unknown, actorUserId: string) {
  const input = createProjectSchema.safeExtend({ id: z.never().optional() }).strict().parse(raw);
  return writeProjectCreate(orgId, input, { actorUserId });
}

export async function updateProjectForNative(orgId: string, raw: unknown, actorUserId: string) {
  const { expected_revision, ...input } = updateProjectSchema.safeExtend({ expected_revision: z.string().trim().min(1) }).strict().parse(raw);
  return writeProjectUpdate(orgId, input, { expectedRevision: expected_revision, audit: { actorUserId } });
}
function projectAudit(row: typeof budget_projects.$inferSelect): Record<string, unknown> {
  return {
    id: row.id,
    org_id: row.org_id,
    ...Object.fromEntries(projectMutableFields.map((field) => [field, row[field]])),
    updated_at: row.updated_at?.toISOString() ?? null,
  };
}
