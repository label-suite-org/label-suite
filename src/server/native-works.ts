import { z } from "zod";
import { createRole, updateRole } from "./roles";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { works, tracks, releases, roles, contacts, artists, radio_stations, contact_organizations, organizations, media_asset_files } from "../db/schema";
import { db } from "../lib/db";
import { computeClearanceFromRoleRows } from "../lib/readiness-core";
import { NotFoundError } from "./errors";

const nativeWorksListSchema = z.object({
  q: z.string().trim().max(120).nullable(),
  cursor: z.string().trim().min(1).max(200).nullable(),
  missing_isrc: z.enum(["true", "false"]).nullable(),
}).strict();

export async function listNativeWorks(orgId: string, raw: unknown) {
  const { q, cursor, missing_isrc } = nativeWorksListSchema.parse(raw);
  const rows = await db.select({ id: works.id, title: works.title, isrc: works.isrc, iswc: works.iswc })
    .from(works).where(and(
      eq(works.org_id, orgId), cursor ? sql`${works.id} > ${cursor}` : undefined,
      q ? sql`position(lower(${q}) in lower(concat_ws(' ', ${works.title}, ${works.isrc}, ${works.iswc}))) > 0` : undefined,
      missing_isrc === "true" ? sql`nullif(trim(${works.isrc}), '') is null` : undefined,
    )).orderBy(asc(works.id)).limit(51);
  const items = rows.slice(0, 50);
  return { items, next_cursor: rows.length > 50 ? items.at(-1)!.id : null };
}

/** Work identity is read separately; Track editing never changes these fields. */
export async function getNativeWork(orgId: string, workId: string) {
  const [work] = await db.select({
    id: works.id, title: works.title, isrc: works.isrc, iswc: works.iswc,
    genre: works.genre, duration: works.duration,
    revision: sql<string>`${works.updated_at}::text`,
  }).from(works).where(and(eq(works.org_id, orgId), eq(works.id, workId))).limit(1);
  if (!work) throw new NotFoundError("Work not found");
  const linked = await db.select({
    id: tracks.id, title: tracks.title, position: tracks.position,
    release_id: releases.id, release_title: releases.title,
  }).from(tracks).leftJoin(releases, and(eq(releases.id, tracks.release_id), eq(releases.org_id, orgId)))
    .where(and(eq(tracks.org_id, orgId), eq(tracks.work_id, workId)))
    .orderBy(asc(tracks.release_id), asc(tracks.position), asc(tracks.id)).limit(51);
  const roleRows = await db.select({
    id: roles.id, contact_id: roles.contact_id, role: roles.role, ownership_type: roles.ownership_type,
    scope: roles.scope, percent_share: roles.percent_share, clearance_status: roles.clearance_status,
    revision: sql<string>`${roles.updated_at}::text`, person: { id: contacts.id, name: contacts.name },
  }).from(roles).leftJoin(contacts, and(eq(contacts.id, roles.contact_id), eq(contacts.org_id, orgId)))
    .where(and(eq(roles.org_id, orgId), eq(roles.work_id, workId))).orderBy(asc(roles.id));
  const personIds = roleRows.flatMap((role) => role.person ? [role.person.id] : []);
  const affiliations = personIds.length ? await db.select({
    id: contact_organizations.id, contact_id: contact_organizations.contact_id,
    organization_id: organizations.id, name: organizations.name, title: contact_organizations.title,
  }).from(contact_organizations).innerJoin(organizations, and(eq(organizations.id, contact_organizations.organization_id), eq(organizations.org_id, orgId)))
    .where(and(eq(contact_organizations.org_id, orgId), inArray(contact_organizations.contact_id, personIds)))
    .orderBy(asc(organizations.name), asc(contact_organizations.id)) : [];
  const evidence = await db.select({
    id: media_asset_files.id, name: media_asset_files.file_name,
    source_table: media_asset_files.source_postgres_table, source_id: media_asset_files.source_postgres_record_id,
  }).from(media_asset_files).where(and(eq(media_asset_files.org_id, orgId), or(
    and(eq(media_asset_files.source_postgres_table, "works"), eq(media_asset_files.source_postgres_record_id, workId)),
    roleRows.length ? and(eq(media_asset_files.source_postgres_table, "roles"), inArray(media_asset_files.source_postgres_record_id, roleRows.map((role) => role.id))) : sql`false`,
  ))).orderBy(asc(media_asset_files.id)).limit(51);
  return {
    record_type: "work" as const, work, tracks: linked.slice(0, 50), has_more_tracks: linked.length > 50,
    roles: roleRows.map((role) => ({ ...role, contact_id: role.person?.id ?? null, organizations: affiliations.filter((item) => item.contact_id === role.person?.id) })),
    clearance: computeClearanceFromRoleRows(roleRows),
    evidence: { items: evidence.slice(0, 50), has_more: evidence.length > 50,
      notice: "Linked file metadata is not proof of signed clearance. Status and evidence must be reviewed separately." },
  };
}

const nativeRoleFields = {
  contact_id: z.string().trim().min(1).nullable(), role: z.string().trim().min(1),
  ownership_type: z.enum(["Rights", "Credit"]), scope: z.enum(["Publishing", "Master", "Mechanical"]).nullable(),
  percent_share: z.number().min(0).max(100).nullable(), clearance_status: z.enum(["Signed", "Confirmed", "Pending", "Unknown"]),
};
export const nativeRoleCreateSchema = z.object({ ...nativeRoleFields, expected_work_revision: z.string().trim().min(1) }).strict();
export const nativeRoleUpdateSchema = z.object(nativeRoleFields).partial().extend({ expected_revision: z.string().trim().min(1) }).strict()
  .refine((input) => Object.keys(input).some((key) => key !== "expected_revision"), "At least one role field is required");

export async function createNativeWorkRole(orgId: string, workId: string, raw: unknown, actorUserId: string) {
  const { expected_work_revision, ...input } = nativeRoleCreateSchema.parse(raw);
  await createRole(orgId, { ...input, work_id: workId }, { actorUserId, expectedWorkRevision: expected_work_revision });
  return getNativeWork(orgId, workId);
}
export async function updateNativeWorkRole(orgId: string, workId: string, roleId: string, raw: unknown, actorUserId: string) {
  const { expected_revision, ...input } = nativeRoleUpdateSchema.parse(raw);
  await updateRole(orgId, { ...input, id: roleId }, { workId, expectedRevision: expected_revision, actorUserId });
  return getNativeWork(orgId, workId);
}

export async function listNativeRolePeople(orgId: string, workId: string, query: string | null, cursor: string | null) {
  const [work] = await db.select({ id: works.id }).from(works).where(and(eq(works.id, workId), eq(works.org_id, orgId))).limit(1);
  if (!work) throw new NotFoundError("Work not found");
  const term = query?.trim().slice(0, 120);
  const people = await db.select({ id: contacts.id, name: contacts.name }).from(contacts).where(and(
    eq(contacts.org_id, orgId), cursor ? sql`${contacts.id} > ${cursor}` : undefined,
    term ? sql`position(lower(${term}) in lower(${contacts.name})) > 0` : undefined,
    sql`not exists (select 1 from ${organizations} where ${organizations.org_id} = ${orgId} and ${organizations.id} = ${contacts.id})`,
    sql`not exists (select 1 from ${artists} where ${artists.org_id} = ${orgId} and ${artists.id} = ${contacts.id})`,
    sql`not exists (select 1 from ${radio_stations} where ${radio_stations.org_id} = ${orgId} and ${radio_stations.id} = ${contacts.id})`,
  )).orderBy(asc(contacts.id)).limit(26);
  const items = people.slice(0, 25);
  const affiliations = items.length ? await db.select({ contact_id: contact_organizations.contact_id, id: organizations.id, name: organizations.name })
    .from(contact_organizations).innerJoin(organizations, and(eq(organizations.id, contact_organizations.organization_id), eq(organizations.org_id, orgId)))
    .where(and(eq(contact_organizations.org_id, orgId), inArray(contact_organizations.contact_id, items.map((person) => person.id))))
    .orderBy(asc(organizations.name), asc(organizations.id)) : [];
  return { items: items.map((person) => ({ ...person, organizations: affiliations.filter((item) => item.contact_id === person.id).map(({ id, name }) => ({ id, name })) })), next_cursor: people.length > 25 ? items.at(-1)!.id : null };
}
