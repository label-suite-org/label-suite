import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  artists,
  calls,
  contact_organizations,
  contacts,
  documents,
  organizations,
  ops_tasks,
  radio_stations,
  roles,
  royalties_revenue,
} from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableText } from "./validation";
import { personDirectoryContacts } from "./contacts-directory-core";
import { createCanonicalContact, updateCanonicalContact } from "./contact-authority";

const contactBaseSchema = {
  name: z.string().trim().min(1, "Name is required"),
  email: nullableText,
  phone: nullableText,
  image_url: nullableText,
  website: nullableText,
  linkedin_url: nullableText,
  address: nullableText,
  role: nullableText,
  company: nullableText,
  notes: nullableText,
};

export const createContactSchema = z.object({
  id: idSchema.optional(),
  ...contactBaseSchema,
});

export const updateContactSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(contactBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteContactSchema = z.object({
  id: idSchema,
});

const organizationBaseSchema = {
  name: z.string().trim().min(1, "Name is required"),
  type: nullableText,
  email: nullableText,
  phone: nullableText,
  website: nullableText,
  linkedin_url: nullableText,
  address: nullableText,
  image_url: nullableText,
  notes: nullableText,
};

export const createOrganizationSchema = z.object({
  id: idSchema.optional(),
  ...organizationBaseSchema,
});

export const updateOrganizationSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(organizationBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteOrganizationSchema = z.object({
  id: idSchema,
});

const contactOrganizationBaseSchema = {
  contact_id: idSchema,
  organization_id: idSchema,
  title: nullableText,
  department: nullableText,
  relationship_type: nullableText,
  is_primary: z.boolean().optional(),
};

export const createContactOrganizationSchema = z.object({
  id: idSchema.optional(),
  ...contactOrganizationBaseSchema,
});

export const updateContactOrganizationSchema = z.object({
  id: idSchema,
  contact_id: idSchema.optional(),
  organization_id: idSchema.optional(),
  title: nullableText.optional(),
  department: nullableText.optional(),
  relationship_type: nullableText.optional(),
  is_primary: z.boolean().optional(),
});

export const deleteContactOrganizationSchema = z.object({
  id: idSchema,
});

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type DeleteContactInput = z.infer<typeof deleteContactSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type DeleteOrganizationInput = z.infer<typeof deleteOrganizationSchema>;
export type CreateContactOrganizationInput = z.infer<typeof createContactOrganizationSchema>;
export type UpdateContactOrganizationInput = z.infer<typeof updateContactOrganizationSchema>;
export type DeleteContactOrganizationInput = z.infer<typeof deleteContactOrganizationSchema>;

export interface ContactOrganizationLink {
  id: string;
  contact_id: string;
  organization_id: string;
  organization_name: string;
  organization_type: string | null;
  organization_website: string | null;
  organization_linkedin_url: string | null;
  title: string | null;
  department: string | null;
  relationship_type: string | null;
  is_primary: boolean;
  source: string | null;
  confidence: number | null;
}

export interface ContactDirectoryContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  image_url: string | null;
  website: string | null;
  linkedin_url: string | null;
  address: string | null;
  role: string | null;
  company: string | null;
  notes: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  organization_links: ContactOrganizationLink[];
}

export interface ContactDirectoryOrganization {
  id: string;
  name: string;
  type: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  linkedin_url: string | null;
  address: string | null;
  image_url: string | null;
  notes: string | null;
  source: string | null;
  created_at: Date | null;
  updated_at: Date | null;
  contact_count: number;
}

export async function listContacts(orgId: string) {
  return db
    .select()
    .from(contacts)
    .where(eq(contacts.org_id, orgId))
    .orderBy(asc(contacts.name));
}

export async function listContactDirectory(orgId: string) {
  const [contactRows, organizationRows, artistRows, stationRows, linkRows] = await Promise.all([
    listContacts(orgId),
    listOrganizations(orgId),
    db
      .select({ id: artists.id })
      .from(artists)
      .where(eq(artists.org_id, orgId)),
    db
      .select({ id: radio_stations.id })
      .from(radio_stations)
      .where(eq(radio_stations.org_id, orgId)),
    db
      .select({
        id: contact_organizations.id,
        contact_id: contact_organizations.contact_id,
        organization_id: contact_organizations.organization_id,
        organization_name: organizations.name,
        organization_type: organizations.type,
        organization_website: organizations.website,
        organization_linkedin_url: organizations.linkedin_url,
        title: contact_organizations.title,
        department: contact_organizations.department,
        relationship_type: contact_organizations.relationship_type,
        is_primary: contact_organizations.is_primary,
        source: contact_organizations.source,
        confidence: contact_organizations.confidence,
      })
      .from(contact_organizations)
      .innerJoin(
        organizations,
        and(
          eq(contact_organizations.organization_id, organizations.id),
          eq(organizations.org_id, orgId),
        ),
      )
      .where(eq(contact_organizations.org_id, orgId))
      .orderBy(asc(organizations.name)),
  ]);

  const linksByContact = new Map<string, ContactOrganizationLink[]>();
  const contactCounts = new Map<string, number>();
  for (const row of linkRows) {
    const link: ContactOrganizationLink = {
      ...row,
      is_primary: !!row.is_primary,
      confidence: row.confidence == null ? null : Number(row.confidence),
    };
    const links = linksByContact.get(row.contact_id) ?? [];
    links.push(link);
    linksByContact.set(row.contact_id, links);
    contactCounts.set(row.organization_id, (contactCounts.get(row.organization_id) ?? 0) + 1);
  }

  return {
    contacts: personDirectoryContacts(contactRows, organizationRows, artistRows, stationRows).map((contact) => ({
      ...contact,
      organization_links: linksByContact.get(contact.id) ?? [],
    })) satisfies ContactDirectoryContact[],
    organizations: organizationRows.map((organization) => ({
      ...organization,
      contact_count: contactCounts.get(organization.id) ?? 0,
    })) satisfies ContactDirectoryOrganization[],
  };
}

export async function listContactOptions(orgId: string) {
  return db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(eq(contacts.org_id, orgId))
    .orderBy(asc(contacts.name));
}

export async function listOrganizations(orgId: string) {
  return db
    .select()
    .from(organizations)
    .where(eq(organizations.org_id, orgId))
    .orderBy(asc(organizations.name));
}

export async function createContact(orgId: string, input: CreateContactInput, actorUserId: string | null = null) {
  const result = await createCanonicalContact({ orgId, actorUserId }, "person", input as Record<string, unknown>);
  return { id: result.id, ok: true };
}

export async function createOrganization(orgId: string, input: CreateOrganizationInput, actorUserId: string | null = null) {
  const result = await createCanonicalContact({ orgId, actorUserId }, "organization", input as Record<string, unknown>);
  return { id: result.id, ok: true };
}

export async function updateOrganization(orgId: string, input: UpdateOrganizationInput, actorUserId: string | null = null) {
  await updateCanonicalContact({ orgId, actorUserId }, "organization", input.id, input as Record<string, unknown>);
  return { ok: true };
}

export async function deleteOrganization(orgId: string, input: DeleteOrganizationInput) {
  const links = await db
    .select({ id: contact_organizations.id })
    .from(contact_organizations)
    .where(and(eq(contact_organizations.organization_id, input.id), eq(contact_organizations.org_id, orgId)));

  if (links.length) {
    throw new ConflictError(`Cannot delete organization - still linked to ${links.length} contact${links.length === 1 ? "" : "s"}. Remove those links first.`);
  }

  const deleted = await db
    .delete(organizations)
    .where(and(eq(organizations.id, input.id), eq(organizations.org_id, orgId)))
    .returning({ id: organizations.id });

  if (!deleted.length) throw new NotFoundError("Organization not found");

  return { ok: true };
}

export async function createContactOrganization(orgId: string, input: CreateContactOrganizationInput) {
  const id = input.id ?? crypto.randomUUID();
  await assertContactAndOrganizationInOrg(orgId, input.contact_id, input.organization_id);

  await db.insert(contact_organizations).values({
    id,
    org_id: orgId,
    contact_id: input.contact_id,
    organization_id: input.organization_id,
    title: input.title ?? null,
    department: input.department ?? null,
    relationship_type: input.relationship_type ?? null,
    is_primary: input.is_primary ?? false,
    source: "manual",
    confidence: 1,
  }).onConflictDoNothing({ target: contact_organizations.id });

  return { id, ok: true };
}

export async function updateContactOrganization(orgId: string, input: UpdateContactOrganizationInput) {
  const current = (
    await db
      .select()
      .from(contact_organizations)
      .where(and(eq(contact_organizations.id, input.id), eq(contact_organizations.org_id, orgId)))
      .limit(1)
  )[0];

  if (!current) throw new NotFoundError("Contact organization link not found");

  const contactId = input.contact_id ?? current.contact_id;
  const organizationId = input.organization_id ?? current.organization_id;
  await assertContactAndOrganizationInOrg(orgId, contactId, organizationId);

  const updates: Partial<typeof contact_organizations.$inferInsert> = { updated_at: new Date() };
  if (hasOwn(input, "contact_id")) updates.contact_id = input.contact_id as string;
  if (hasOwn(input, "organization_id")) updates.organization_id = input.organization_id as string;
  if (hasOwn(input, "title")) updates.title = input.title as string | null;
  if (hasOwn(input, "department")) updates.department = input.department as string | null;
  if (hasOwn(input, "relationship_type")) updates.relationship_type = input.relationship_type as string | null;
  if (hasOwn(input, "is_primary")) updates.is_primary = input.is_primary as boolean;

  await db
    .update(contact_organizations)
    .set(updates)
    .where(and(eq(contact_organizations.id, input.id), eq(contact_organizations.org_id, orgId)));

  return { ok: true };
}

export async function deleteContactOrganization(orgId: string, input: DeleteContactOrganizationInput) {
  const deleted = await db
    .delete(contact_organizations)
    .where(and(eq(contact_organizations.id, input.id), eq(contact_organizations.org_id, orgId)))
    .returning({ id: contact_organizations.id });

  if (!deleted.length) throw new NotFoundError("Contact organization link not found");

  return { ok: true };
}

export async function updateContact(orgId: string, input: UpdateContactInput, actorUserId: string | null = null) {
  await updateCanonicalContact({ orgId, actorUserId }, "person", input.id, input as Record<string, unknown>);
  return { ok: true };
}

export async function deleteContact(orgId: string, input: DeleteContactInput) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, input.id), eq(contacts.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Contact not found");
    }

    const usageMessages = [
      await usageMessage(tx, "artist", artists, artists.contact_id, artists.org_id, input.id, orgId),
      await usageMessage(tx, "role", roles, roles.contact_id, roles.org_id, input.id, orgId),
      await usageMessage(tx, "call", calls, calls.contact_id, calls.org_id, input.id, orgId),
      await usageMessage(tx, "linked task", ops_tasks, ops_tasks.linked_contact_id, ops_tasks.org_id, input.id, orgId),
      await usageMessage(tx, "owned task", ops_tasks, ops_tasks.owner_contact_id, ops_tasks.org_id, input.id, orgId),
      await usageMessage(tx, "document", documents, documents.contact_id, documents.org_id, input.id, orgId),
      await usageMessage(tx, "royalty source", royalties_revenue, royalties_revenue.source_contact_id, royalties_revenue.org_id, input.id, orgId),
    ].filter(Boolean);

    if (usageMessages.length) {
      throw new ConflictError(
        `Cannot delete contact - still referenced by ${usageMessages.join(", ")}. Remove those references first.`,
      );
    }

    await tx.delete(contacts).where(and(eq(contacts.id, input.id), eq(contacts.org_id, orgId)));
  });

  return { ok: true };
}

async function usageMessage(
  client: Pick<typeof db, "select">,
  label: string,
  table: any,
  column: any,
  orgColumn: any,
  id: string,
  orgId: string,
): Promise<string | null> {
  const rows = await client
    .select({ count: sql<number>`count(*)` })
    .from(table)
    .where(and(eq(column, id), eq(orgColumn, orgId)));

  const count = Number(rows[0]?.count ?? 0);
  if (!count) return null;

  return `${count} ${label}${count > 1 ? "s" : ""}`;
}

async function assertContactAndOrganizationInOrg(
  orgId: string,
  contactId: string,
  organizationId: string,
) {
  const [, organizationRow] = await Promise.all([
    assertPersonContactInOrg(db, orgId, contactId),
    db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, organizationId), eq(organizations.org_id, orgId)))
      .limit(1),
  ]);

  if (!organizationRow.length) throw new NotFoundError("Organization not found");
}

/**
 * Contacts are the person-only side of the directory boundary. Organizations,
 * artists, and radio stations have separate tables and must never be accepted
 * where a person contact is required (credits, roles, or person-org links).
 */
export async function assertPersonContactInOrg(
  client: Pick<typeof db, "select">,
  orgId: string,
  contactId: string,
): Promise<void> {
  const [rows, organizationRows, artistRows, stationRows] = await Promise.all([
    client
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId))),
    client
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, contactId), eq(organizations.org_id, orgId))),
    client
      .select({ id: artists.id })
      .from(artists)
      .where(and(eq(artists.id, contactId), eq(artists.org_id, orgId))),
    client
      .select({ id: radio_stations.id })
      .from(radio_stations)
      .where(and(eq(radio_stations.id, contactId), eq(radio_stations.org_id, orgId))),
  ]);

  if (!rows.length || organizationRows.length || artistRows.length || stationRows.length) {
    throw new NotFoundError("Person contact not found");
  }
}
