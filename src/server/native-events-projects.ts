import { and, asc, desc, eq, getTableColumns, gt, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { budget_line_items, budget_projects, campaigns, contacts, documents, grant_applications, grants, media_asset_files, media_assets, ops_tasks, project_events } from "../db/schema";
import { db } from "../lib/db";
import { HttpError } from "./errors";
import { createProjectEventForNative, updateProjectEventForNative } from "./project-events";
import { createProjectForNative, updateProjectForNative } from "./projects";

const PAGE_MAX = 50;
const revision = z.string().trim().min(1);
export const nativeCreateEventSchema = z.object({ title: z.string().trim().min(1), event_type: z.string().trim().min(1), start_date: z.string().date(), status: z.string().trim().min(1).optional(), project_id: z.string().trim().min(1).nullable().optional(), artist_id: z.string().trim().min(1).nullable().optional(), release_id: z.string().trim().min(1).nullable().optional(), contact_id: z.string().trim().min(1).nullable().optional(), owner_contact_id: z.string().trim().min(1).nullable().optional(), end_date: z.string().date().nullable().optional(), starts_at: z.iso.datetime({ offset: true }).nullable().optional(), ends_at: z.iso.datetime({ offset: true }).nullable().optional(), all_day: z.boolean().optional(), timezone: z.string().trim().min(1).nullable().optional(), venue_name: z.string().trim().min(1).nullable().optional(), notes: z.string().trim().min(1).nullable().optional(), is_confirmed: z.boolean().optional() }).strict();
export const nativeUpdateEventSchema = nativeCreateEventSchema.partial().extend({ expected_revision: revision }).strict();
export const nativeCreateProjectSchema = z.object({ name: z.string().trim().min(1), project_type: z.string().trim().min(1).optional(), description: z.string().trim().min(1).nullable().optional(), status: z.string().trim().min(1).optional(), artist_id: z.string().trim().min(1).nullable().optional(), release_id: z.string().trim().min(1).nullable().optional(), owner_contact_id: z.string().trim().min(1).nullable().optional(), start_date: z.string().date().nullable().optional(), end_date: z.string().date().nullable().optional(), notes: z.string().trim().min(1).nullable().optional() }).strict();
export const nativeUpdateProjectSchema = nativeCreateProjectSchema.partial().extend({ expected_revision: revision }).strict();

function page(value: string | null) { const n = Number(value ?? 25); return Number.isInteger(n) ? Math.min(Math.max(n, 1), PAGE_MAX) : 25; }
type CursorKind = "event" | "project";
type EventCursor = { v: 1; kind: "event"; start_date: string; id: string };
type ProjectCursor = { v: 1; kind: "project"; updated_at: string; id: string };
function encodeCursor(cursor: EventCursor | ProjectCursor) { return Buffer.from(JSON.stringify(cursor)).toString("base64url"); }
function decodeCursor<K extends CursorKind>(value: string | null, kind: K): Extract<EventCursor | ProjectCursor, { kind: K }> | null {
 if (!value) return null;
 try {
  const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  const schema = kind === "event" ? z.object({ v: z.literal(1), kind: z.literal("event"), start_date: z.string().date(), id: z.string().min(1) }) : z.object({ v: z.literal(1), kind: z.literal("project"), updated_at: z.string().datetime(), id: z.string().min(1) });
  return schema.parse(parsed) as Extract<EventCursor | ProjectCursor, { kind: K }>;
 } catch { throw new HttpError("Invalid native pagination cursor", 400); }
}
function keysetResult<T extends { id: string }>(rows: T[], limit: number, cursor: (row: T) => EventCursor | ProjectCursor) { const items = rows.slice(0, limit); return { items, next_cursor: rows.length > limit ? encodeCursor(cursor(items[items.length - 1])) : null }; }
const openTask = sql`coalesce(t.status, '') not in ('done', 'complete', 'completed', 'cancelled')`;
const projectUpdatedAt = sql`coalesce(${budget_projects.updated_at}, timestamp '1970-01-01')`;

export async function listNativeEvents(orgId: string, input: { limit: string | null; cursor: string | null }) {
 const limit = page(input.limit), cursor = decodeCursor(input.cursor, "event");
 const seek = cursor ? or(gt(project_events.start_date, cursor.start_date), and(eq(project_events.start_date, cursor.start_date), gt(project_events.id, cursor.id))) : undefined;
 const rows = await db.select({ id: project_events.id, title: project_events.title, status: project_events.status, event_type: project_events.event_type, start_date: project_events.start_date, project_id: project_events.project_id, next_action: sql<string | null>`(select t.next_action from label_suite.ops_tasks t where t.org_id=${orgId} and t.event_id=label_suite.project_events.id and ${openTask} order by t.due_date asc nulls last, t.id asc limit 1)` }).from(project_events).where(and(eq(project_events.org_id, orgId), seek)).orderBy(asc(project_events.start_date), asc(project_events.id)).limit(limit + 1);
 return keysetResult(rows.map((row) => ({ record_type: "event" as const, ...row })), limit, (row) => ({ v: 1, kind: "event", start_date: row.start_date, id: row.id }));
}
export async function listNativeProjects(orgId: string, input: { limit: string | null; cursor: string | null }) {
 const limit = page(input.limit), cursor = decodeCursor(input.cursor, "project");
 const seek = cursor ? or(sql`${projectUpdatedAt} < ${cursor.updated_at}::timestamp`, and(sql`${projectUpdatedAt} = ${cursor.updated_at}::timestamp`, gt(budget_projects.id, cursor.id))) : undefined;
 const rows = await db.select({ id: budget_projects.id, name: budget_projects.name, status: budget_projects.status, goal: budget_projects.description, start_date: budget_projects.start_date, end_date: budget_projects.end_date, updated_at: sql<string>`to_char(${projectUpdatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, next_action: sql<string | null>`(select t.next_action from label_suite.ops_tasks t where t.org_id=${orgId} and t.project_id=label_suite.budget_projects.id and ${openTask} order by t.due_date asc nulls last, t.id asc limit 1)` }).from(budget_projects).where(and(eq(budget_projects.org_id, orgId), seek)).orderBy(desc(projectUpdatedAt), asc(budget_projects.id)).limit(limit + 1);
 return keysetResult(rows.map(({ updated_at, ...row }) => ({ record_type: "project" as const, ...row, _cursor_updated_at: updated_at })), limit, (row) => ({ v: 1, kind: "project", updated_at: row._cursor_updated_at, id: row.id }));
}
export async function getNativeEventDetail(orgId: string, id: string) {
 const event = (await db.select({ ...getTableColumns(project_events), revision: sql<string>`${project_events.updated_at}::text` }).from(project_events).where(and(eq(project_events.org_id, orgId), eq(project_events.id, id))).limit(1))[0]; if (!event) return null;
 const parentProject = event.project_id ? (await db.select({ id: budget_projects.id, name: budget_projects.name, status: budget_projects.status, currency: budget_projects.currency }).from(budget_projects).where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, event.project_id))).limit(1))[0] ?? null : null;
 const [tasks, assets, budget] = await Promise.all([db.select({ id: ops_tasks.id, name: ops_tasks.task_name, status: ops_tasks.status, next_action: ops_tasks.next_action }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.event_id, id))).orderBy(sql`${ops_tasks.due_date} asc nulls last`, asc(ops_tasks.id)).limit(9), db.selectDistinct({ id: media_assets.id, name: media_assets.asset_name, status: media_assets.approval_status }).from(media_asset_files).innerJoin(media_assets, and(eq(media_assets.org_id, orgId), eq(media_assets.id, media_asset_files.media_asset_id))).where(and(eq(media_asset_files.org_id, orgId), eq(media_asset_files.source_postgres_table, "project_events"), eq(media_asset_files.source_postgres_record_id, id))).orderBy(asc(media_assets.id)).limit(9), event.project_id ? db.select({ id: budget_line_items.id, name: budget_line_items.name, status: budget_line_items.status, amount: budget_line_items.amount }).from(budget_line_items).where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.project_id, event.project_id))).orderBy(asc(budget_line_items.id)).limit(9) : []]);
 const contactIDs = [event.contact_id, event.owner_contact_id].filter((value): value is string => Boolean(value));
 const [people, files, sharedDocuments] = await Promise.all([
  contactIDs.length ? db.select({ id: contacts.id, name: contacts.name, status: sql<string>`case when ${contacts.id} = ${event.owner_contact_id} then 'Owner' else 'Contact' end` }).from(contacts).where(and(eq(contacts.org_id, orgId), inArray(contacts.id, contactIDs))).orderBy(asc(contacts.id)).limit(9) : [],
  db.select({ id: media_asset_files.id, name: media_asset_files.file_name, status: media_asset_files.content_type, resource_kind: sql<"assets" | null>`case when ${media_assets.id} is not null then 'assets' else null end`, resource_id: media_assets.id }).from(media_asset_files).leftJoin(media_assets, and(eq(media_assets.org_id, orgId), eq(media_assets.id, media_asset_files.media_asset_id))).where(and(eq(media_asset_files.org_id, orgId), eq(media_asset_files.source_postgres_table, "project_events"), eq(media_asset_files.source_postgres_record_id, id))).orderBy(asc(media_asset_files.id)).limit(9),
  db.select({ id: documents.id, name: documents.name, status: documents.status }).from(documents).where(and(eq(documents.org_id, orgId), or(event.project_id ? eq(documents.project_id, event.project_id) : sql`false`, event.artist_id ? eq(documents.artist_id, event.artist_id) : sql`false`, event.release_id ? eq(documents.release_id, event.release_id) : sql`false`, event.contact_id ? eq(documents.contact_id, event.contact_id) : sql`false`))).orderBy(asc(documents.id)).limit(9),
 ]);
 return { record_type: "event" as const, ...event, revision: event.revision, agenda: event.notes, relationships: { people: people.slice(0, 8), files: files.slice(0, 8), documents: sharedDocuments.slice(0, 8), project_id: event.project_id, project: parentProject, tasks: tasks.slice(0, 8), assets: assets.slice(0, 8), budget: budget.slice(0, 8).map((row) => ({ ...row, currency: parentProject?.currency ?? null })) }, relationship_windows: { people: { partial: people.length > 8 }, files: { partial: files.length > 8 }, documents: { partial: sharedDocuments.length > 8 }, tasks: { partial: tasks.length > 8 }, assets: { partial: assets.length > 8 }, budget: { partial: budget.length > 8 } }, relationship_availability: { assets: { status: "available", association: "media_asset_files.source_postgres_record_id" } }, source_context: sourceContext(event) };
}
export async function getNativeProjectDetail(orgId: string, id: string) {
 const project = (await db.select({ ...getTableColumns(budget_projects), revision: sql<string>`${budget_projects.updated_at}::text` }).from(budget_projects).where(and(eq(budget_projects.org_id, orgId), eq(budget_projects.id, id))).limit(1))[0]; if (!project) return null;
 const [events, tasks, assets, budget, grantRows, campaignRows] = await Promise.all([db.select({ id: project_events.id, title: project_events.title, status: project_events.status, start_date: project_events.start_date }).from(project_events).where(and(eq(project_events.org_id, orgId), eq(project_events.project_id, id))).orderBy(asc(project_events.start_date), asc(project_events.id)).limit(9), db.select({ id: ops_tasks.id, name: ops_tasks.task_name, status: ops_tasks.status, next_action: ops_tasks.next_action }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.project_id, id))).orderBy(sql`${ops_tasks.due_date} asc nulls last`, asc(ops_tasks.id)).limit(9), db.select({ id: media_assets.id, name: media_assets.asset_name, status: media_assets.approval_status }).from(media_assets).where(and(eq(media_assets.org_id, orgId), eq(media_assets.project_id, id))).orderBy(asc(media_assets.id)).limit(9), db.select({ id: budget_line_items.id, name: budget_line_items.name, status: budget_line_items.status, amount: budget_line_items.amount }).from(budget_line_items).where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.project_id, id))).orderBy(asc(budget_line_items.id)).limit(9), db.select({ id: grant_applications.id, name: sql<string>`coalesce(${grants.name}, 'Grant application')`, status: grant_applications.status, next_action: grant_applications.next_action }).from(grant_applications).leftJoin(grants, and(eq(grants.org_id, orgId), eq(grants.id, grant_applications.grant_id))).where(and(eq(grant_applications.org_id, orgId), eq(grant_applications.project_id, id))).orderBy(asc(grant_applications.id)).limit(9), db.select({ id: campaigns.id, name: campaigns.campaign_name, status: campaigns.status }).from(campaigns).where(and(eq(campaigns.org_id, orgId), or(project.release_id ? eq(campaigns.linked_release_id, project.release_id) : sql`false`, project.artist_id ? eq(campaigns.linked_artist_id, project.artist_id) : sql`false`))).orderBy(asc(campaigns.id)).limit(9)]);
 const [people, files, projectDocuments] = await Promise.all([
  project.owner_contact_id ? db.select({ id: contacts.id, name: contacts.name, status: sql<string>`'Owner'` }).from(contacts).where(and(eq(contacts.org_id, orgId), eq(contacts.id, project.owner_contact_id))).limit(1) : [],
  db.select({ id: media_asset_files.id, name: media_asset_files.file_name, status: media_asset_files.content_type, resource_kind: sql<"assets" | null>`case when ${media_assets.id} is not null then 'assets' else null end`, resource_id: media_assets.id }).from(media_asset_files).leftJoin(media_assets, and(eq(media_assets.org_id, orgId), eq(media_assets.id, media_asset_files.media_asset_id))).where(and(eq(media_asset_files.org_id, orgId), or(and(eq(media_asset_files.source_postgres_table, "budget_projects"), eq(media_asset_files.source_postgres_record_id, id)), eq(media_assets.project_id, id)))).orderBy(asc(media_asset_files.id)).limit(9),
  db.select({ id: documents.id, name: documents.name, status: documents.status }).from(documents).where(and(eq(documents.org_id, orgId), eq(documents.project_id, id))).orderBy(asc(documents.id)).limit(9),
 ]);
 return { record_type: "project" as const, ...project, goal: project.description, revision: project.revision, relationships: { people: people.slice(0, 8), files: files.slice(0, 8), documents: projectDocuments.slice(0, 8), events: events.slice(0, 8), tasks: tasks.slice(0, 8), assets: assets.slice(0, 8), budget: budget.slice(0, 8).map((row) => ({ ...row, currency: project.currency })), grants: grantRows.slice(0, 8), campaigns: campaignRows.slice(0, 8) }, relationship_windows: { people: { partial: people.length > 8 }, files: { partial: files.length > 8 }, documents: { partial: projectDocuments.length > 8 }, events: { partial: events.length > 8 }, tasks: { partial: tasks.length > 8 }, assets: { partial: assets.length > 8 }, budget: { partial: budget.length > 8 }, grants: { partial: grantRows.length > 8 }, campaigns: { partial: campaignRows.length > 8 } }, relationship_availability: { assets: { status: "available", association: "project_id" } }, source_context: sourceContext(project) };
}
function sourceContext(row: { source_system: string | null; source_record_id: string | null; source_imported_at: Date | null }) { return { readonly: true, source_system: row.source_system, source_record_id: row.source_record_id, source_imported_at: row.source_imported_at?.toISOString() ?? null }; }
export async function createNativeEvent(orgId: string, input: unknown, actorUserId: string) {
 const row = await createProjectEventForNative(orgId, input, actorUserId);
 const detail = await getNativeEventDetail(orgId, row.id);
 if (!detail) throw new HttpError("Event is no longer available", 404);
 return detail;
}
export async function updateNativeEvent(orgId: string, input: unknown, actorUserId: string) {
 const row = await updateProjectEventForNative(orgId, input, actorUserId);
 const detail = await getNativeEventDetail(orgId, row.id);
 if (!detail) throw new HttpError("Event is no longer available", 404);
 return detail;
}
export async function createNativeProject(orgId: string, input: unknown, actorUserId: string) {
 const row = await createProjectForNative(orgId, input, actorUserId);
 const detail = await getNativeProjectDetail(orgId, row.id);
 if (!detail) throw new HttpError("Project is no longer available", 404);
 return detail;
}
export async function updateNativeProject(orgId: string, input: unknown, actorUserId: string) {
 const row = await updateProjectForNative(orgId, input, actorUserId);
 const detail = await getNativeProjectDetail(orgId, row.id);
 if (!detail) throw new HttpError("Project is no longer available", 404);
 return detail;
}
