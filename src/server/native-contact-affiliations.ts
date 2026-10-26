import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { contact_organizations, organizations } from "../db/schema";
import { db } from "../lib/db";
import { assertPersonContactInOrg, createContactOrganizationSchema } from "./contacts";
import { revisionSql } from "./contact-authority";
import { ConflictError, NotFoundError } from "./errors";
import { recordAuditEvent } from "./integrations";

export const nativeAffiliationCreateSchema = createContactOrganizationSchema.omit({ contact_id: true })
  .extend({ id: z.uuid() }).strict();
export const nativeAffiliationUpdateSchema = createContactOrganizationSchema.pick({ title: true, department: true, relationship_type: true, is_primary: true })
  .extend({ id: z.string().min(1), expected_revision: z.string().datetime() }).strict()
  .refine(input => ["title", "department", "relationship_type", "is_primary"].some(key => Object.hasOwn(input, key)), "At least one change is required");
export const nativeAffiliationDeleteSchema = z.object({ id: z.string().min(1), expected_revision: z.string().datetime() }).strict();
const revision = sql<string>`to_char(${contact_organizations.updated_at}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export async function listNativeAffiliations(orgId: string, contactId: string, input: { id?: string | null; cursor?: string | null }) {
  await assertPersonContactInOrg(db, orgId, contactId);
  const conditions = [eq(contact_organizations.org_id, orgId), eq(contact_organizations.contact_id, contactId)];
  if (input.id) conditions.push(eq(contact_organizations.id, input.id));
  else if (input.cursor) conditions.push(gt(contact_organizations.id, input.cursor));
  const rows = await db.select({ id: contact_organizations.id, organization_id: organizations.id, organization_name: organizations.name,
    title: contact_organizations.title, department: contact_organizations.department, relationship_type: contact_organizations.relationship_type,
    is_primary: contact_organizations.is_primary, source: contact_organizations.source, revision })
    .from(contact_organizations).innerJoin(organizations, and(eq(organizations.id, contact_organizations.organization_id), eq(organizations.org_id, orgId)))
    .where(and(...conditions)).orderBy(asc(contact_organizations.id)).limit(51);
  if (input.id && !rows.length) throw new NotFoundError("Affiliation not found");
  return { items: rows.slice(0, 50), next_cursor: rows.length > 50 ? rows[49].id : null };
}

export async function mutateNativeAffiliation(orgId: string, contactId: string, input: z.infer<typeof nativeAffiliationUpdateSchema> | z.infer<typeof nativeAffiliationDeleteSchema>, actorUserId: string, remove: boolean) {
  return db.transaction(async tx => {
    await assertPersonContactInOrg(tx, orgId, contactId);
    const scope = and(eq(contact_organizations.org_id, orgId), eq(contact_organizations.contact_id, contactId), eq(contact_organizations.id, input.id));
    const [before] = await tx.select().from(contact_organizations).where(scope).limit(1).for("update");
    if (!before) throw new NotFoundError("Affiliation not found");
    const expected = and(scope, eq(revision, input.expected_revision));
    let after: typeof before | undefined;
    if (remove) [after] = await tx.delete(contact_organizations).where(expected).returning();
    else {
      const fields = input as z.infer<typeof nativeAffiliationUpdateSchema>;
      const changes: Partial<typeof contact_organizations.$inferInsert> = { updated_at: revisionSql as never };
      for (const key of ["title", "department", "relationship_type", "is_primary"] as const) {
        if (Object.hasOwn(fields, key)) Object.assign(changes, { [key]: fields[key] });
      }
      [after] = await tx.update(contact_organizations).set(changes).where(expected).returning();
    }
    if (!after) throw new ConflictError("Affiliation changed; reload and review your changes");
    await recordAuditEvent(orgId, { actor_user_id: actorUserId, event_type: remove ? "contact.affiliation_unlinked" : "contact.affiliation_updated",
      object_type: "contact_organization", object_id: input.id, before, after: remove ? null : after }, tx);
    return { id: input.id, ok: true };
  });
}
