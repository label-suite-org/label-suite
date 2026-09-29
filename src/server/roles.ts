import { z } from "zod";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { roles, works } from "../db/schema";
import { db } from "../lib/db";
import { lockWorkRoles, persistAfterRoleChange } from "../lib/readiness";
import { assertPersonContactInOrg } from "./contacts";
import { recordAuditEvent } from "./integrations";
import { ConflictError, HttpError, NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableNumber, nullableText } from "./validation";

const SCOPES = ["Publishing", "Master", "Mechanical"];
const CLEARANCE = ["Signed", "Confirmed", "Pending", "Unknown"];
const OWNERSHIP = ["Rights", "Credit"];

export const createRoleSchema = z.object({
  id: idSchema.optional(),
  work_id: idSchema,
  contact_id: nullableText,
  role: z.string().trim().min(1, "role is required"),
  ownership_type: nullableText,
  scope: nullableText,
  percent_share: nullableNumber({ min: 0, max: 100 }),
  clearance_status: nullableText,
});

export const updateRoleSchema = z.object({
  id: idSchema,
  contact_id: nullableText,
  role: z.string().trim().min(1, "role is required").nullable().optional(),
  ownership_type: nullableText,
  scope: nullableText,
  percent_share: nullableNumber({ min: 0, max: 100 }),
  clearance_status: nullableText,
});

export const deleteRoleSchema = z.object({
  id: idSchema,
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type DeleteRoleInput = z.infer<typeof deleteRoleSchema>;

export async function createRole(orgId: string, input: CreateRoleInput, native?: { actorUserId: string; expectedWorkRevision: string }) {
  return db.transaction(async (tx) => {
    await lockWorkRoles(tx, orgId, input.work_id);
    if (native) {
      const [work] = await tx.select({ revision: sql<string>`${works.updated_at}::text` }).from(works)
        .where(and(eq(works.id, input.work_id), eq(works.org_id, orgId)));
      if (!work) throw new NotFoundError("Work not found");
      if (work.revision !== native.expectedWorkRevision) throw new ConflictError("Work changed elsewhere. Refresh before adding a role.");
    } else await assertWorkInOrg(tx, orgId, input.work_id);
    validateRole(input);
    if (input.contact_id) await assertPersonContactInOrg(tx, orgId, input.contact_id);

    const id = input.id ?? crypto.randomUUID();

    const inserted = await tx.insert(roles).values({
      id,
      org_id: orgId,
      work_id: input.work_id,
      contact_id: input.contact_id ?? null,
      role: input.role,
      ownership_type: chooseValue(input.ownership_type, OWNERSHIP, "Rights"),
      scope: chooseValue(input.scope, SCOPES, null),
      percent_share: input.percent_share ?? null,
      clearance_status: chooseValue(input.clearance_status, CLEARANCE, "Unknown"),
    }).onConflictDoNothing({ target: roles.id }).returning({ ...getTableColumns(roles), revision: sql<string>`${roles.updated_at}::text` });

    if (!inserted[0]) throw new ConflictError("Role already exists");
    await persistAfterRoleChange(input.work_id, tx, orgId);
    await touchWork(tx, orgId, input.work_id, native?.expectedWorkRevision);
    if (native) {
      await recordAuditEvent(orgId, { actor_user_id: native.actorUserId, event_type: "role.created", object_type: "role", object_id: id, after: roleAudit(inserted[0]) }, tx);
    }

    return { id, ok: true };
  });
}

export async function updateRole(orgId: string, input: UpdateRoleInput, native?: { workId: string; expectedRevision: string; actorUserId: string }) {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ work_id: roles.work_id }).from(roles).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId)));
    if (owner?.work_id) await lockWorkRoles(tx, orgId, owner.work_id);
    const existing = (
      await tx.select({ ...getTableColumns(roles), revision: sql<string>`${roles.updated_at}::text` }).from(roles).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId))).for("update")
    )[0];

    if (!existing) {
      throw new NotFoundError("Role not found");
    }

    if (native && existing.work_id !== native.workId) throw new NotFoundError("Role not found in this Work");
    if (native && existing.revision !== native.expectedRevision) throw new ConflictError("Role changed elsewhere. Refresh before saving.");
    validateRole({ ...existing, ...input });
    const updates: Partial<typeof roles.$inferInsert> = {};
    if (hasOwn(input, "contact_id")) updates.contact_id = input.contact_id as string | null;
    if (hasOwn(input, "role")) updates.role = input.role as string | null;
    if (hasOwn(input, "ownership_type")) {
      updates.ownership_type = chooseValue(input.ownership_type, OWNERSHIP, existing.ownership_type ?? "Rights");
    }
    if (hasOwn(input, "scope")) updates.scope = chooseValue(input.scope, SCOPES, null);
    if (hasOwn(input, "percent_share")) updates.percent_share = input.percent_share as number | null;
    if (hasOwn(input, "clearance_status")) {
      updates.clearance_status = chooseValue(input.clearance_status, CLEARANCE, existing.clearance_status ?? "Unknown");
    }
    const contactId = hasOwn(updates, "contact_id") ? updates.contact_id : existing.contact_id;
    if (contactId && (native || hasOwn(updates, "contact_id"))) {
      await assertPersonContactInOrg(tx, orgId, contactId);
    }

    const [saved] = await tx.update(roles).set({ ...updates, updated_at: sql`greatest(clock_timestamp(), ${existing.revision}::timestamp + interval '1 microsecond')` }).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId))).returning({ ...getTableColumns(roles), revision: sql<string>`${roles.updated_at}::text` });

    if (existing.work_id) {
      await persistAfterRoleChange(existing.work_id, tx, orgId);
      await touchWork(tx, orgId, existing.work_id);
    }

    if (native) await recordAuditEvent(orgId, { actor_user_id: native.actorUserId, event_type: "role.updated", object_type: "role", object_id: input.id, before: roleAudit(existing), after: roleAudit(saved) }, tx);
    return { ok: true };
  });
}

export async function deleteRole(orgId: string, input: DeleteRoleInput) {
  return db.transaction(async (tx) => {
    const [owner] = await tx.select({ work_id: roles.work_id }).from(roles).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId)));
    if (owner?.work_id) await lockWorkRoles(tx, orgId, owner.work_id);
    const existing = (
      await tx.select({ ...getTableColumns(roles), revision: sql<string>`${roles.updated_at}::text` }).from(roles).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId))).for("update")
    )[0];

    if (!existing) {
      throw new NotFoundError("Role not found");
    }

    await tx.delete(roles).where(and(eq(roles.id, input.id), eq(roles.org_id, orgId)));

    if (existing.work_id) {
      await persistAfterRoleChange(existing.work_id, tx, orgId);
      await touchWork(tx, orgId, existing.work_id);
    }

    return { ok: true };
  });
}

async function assertWorkInOrg(
  client: Pick<typeof db, "select">,
  orgId: string,
  workId: string,
): Promise<void> {
  const rows = await client
    .select({ id: works.id })
    .from(works)
    .where(and(eq(works.id, workId), eq(works.org_id, orgId)));

  if (!rows.length) {
    throw new NotFoundError("Work not found");
  }
}

function chooseValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T | null,
): T | null {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function validateRole(role: Partial<Pick<typeof roles.$inferSelect, "role" | "contact_id" | "ownership_type" | "scope" | "percent_share" | "clearance_status">>) {
  if (!role.role?.trim() || !OWNERSHIP.includes(role.ownership_type ?? "") || !CLEARANCE.includes(role.clearance_status ?? "")) throw new HttpError("Role, ownership and clearance status are required", 400);
  if (role.scope != null && !SCOPES.includes(role.scope)) throw new HttpError("Invalid role scope", 400);
  if (role.percent_share != null && (!Number.isFinite(role.percent_share) || role.percent_share < 0 || role.percent_share > 100)) throw new HttpError("Share must be between 0 and 100", 400);
  if (role.ownership_type === "Rights" && (!role.contact_id || !role.scope || role.percent_share == null)) throw new HttpError("Rights require a person, scope and share", 400);
}

async function touchWork(tx: Pick<typeof db, "update">, orgId: string, workId: string, expectedRevision?: string) {
  const condition = and(eq(works.org_id, orgId), eq(works.id, workId), expectedRevision === undefined ? undefined : sql`${works.updated_at}::text = ${expectedRevision}`);
  const touched = await tx.update(works).set({ updated_at: sql`greatest(clock_timestamp(), ${works.updated_at} + interval '1 microsecond')` })
    .where(condition).returning({ id: works.id });
  if (expectedRevision !== undefined && !touched.length) throw new ConflictError("Work changed elsewhere. Refresh before adding a role.");
}

function roleAudit(row: typeof roles.$inferSelect & { revision: string }) {
  return { id: row.id, work_id: row.work_id, contact_id: row.contact_id, role: row.role,
    ownership_type: row.ownership_type, scope: row.scope, percent_share: row.percent_share,
    clearance_status: row.clearance_status, updated_at: row.updated_at?.toISOString() ?? null, revision: row.revision };
}
