import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { calendar_connections as connections, calendar_event_links as links, calendar_releases as subscriptions, job_runs, ops_tasks, releases, release_milestones } from "../db/schema";
import { db, pool } from "../lib/db";
import { HttpError, NotFoundError } from "./errors";
import { openSecret, sealSecret } from "./gmail-enrichment";
import { calendarConfigured, calendarOrigin, calendarToken, calendarRequest, writableCalendars, calendarRedirect, CalendarApiError, type WritableCalendar } from "./calendar-google";
import { eventDate, nextDate, reconcileDate, validCalendarDate, type CalendarEvent } from "./calendar-sync-core";
import { syncReleaseCatalogEntry } from "./catalog";
import { persistReleaseReadiness } from "../lib/readiness";
import { jobStore } from "./jobs";
import { workspaceToday, taskIsOpen } from "./task-deadlines";
import { listTaskPlanningOptions } from "./ops-tasks";

type Link = typeof links.$inferSelect;
type Connection = typeof connections.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const tenantLink = (orgId: string, id: string) => and(eq(links.org_id, orgId), eq(links.id, id));

// ponytail: one active sync/configuration per workspace; split by calendar if workspace volume warrants it.
async function calendarLock<T>(orgId: string, work: () => Promise<T>) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query("select pg_try_advisory_lock(hashtextextended($1, 92)) as locked", [orgId])).rows[0].locked;
    if (!locked) throw new HttpError("Calendar sync is running. Try again shortly.", 409);
    return await work();
  } finally {
    try {
      if (locked) await client.query("select pg_advisory_unlock(hashtextextended($1, 92))", [orgId]);
    } catch (error) { client.release(true); throw error; }
    client.release();
  }
}
// Configuration uses the request transaction's lock, which lasts through the middleware commit.
async function calendarConfiguration<T>(orgId: string, work: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ locked: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${orgId}, 92)) as locked`);
    if (!result.rows[0].locked) throw new HttpError("Calendar sync is running. Try again shortly.", 409);
    return work(tx);
  });
}
async function connection(orgId: string, database: Pick<typeof db, "select"> = db) {
  return (await database.select().from(connections).where(eq(connections.org_id, orgId)))[0];
}
async function accessToken(row: Connection) {
  if (!row.refresh_token) throw new HttpError("Connect Google Calendar first.", 409);
  return (await calendarToken({ grant_type: "refresh_token", refresh_token: openSecret(row.refresh_token) })).access_token;
}
async function assertRelease(orgId: string, releaseId: string, database: Pick<typeof db, "select"> = db) {
  if (!(await database.select({ id: releases.id }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId))))[0]) throw new NotFoundError("Release not found");
}
export async function connectCalendar(orgId: string, code: string, origin: string) {
  origin = calendarOrigin(origin);
  const token = await calendarToken({ grant_type: "authorization_code", code, redirect_uri: calendarRedirect(origin) });
  if (!token.refresh_token || !token.scope?.split(" ").includes("https://www.googleapis.com/auth/calendar.events") || !token.scope.split(" ").includes("https://www.googleapis.com/auth/calendar.calendarlist.readonly")) throw new HttpError("Grant Calendar access and offline access to connect the release schedule.", 400);
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new HttpError("Could not verify the Google account.", 502);
  const user = z.object({ sub: z.string().min(1), email: z.email(), email_verified: z.literal(true) }).parse(await response.json());
  await calendarConfiguration(orgId, async (tx) => {
    const existing = await connection(orgId, tx);
    if (existing && existing.google_sub !== user.sub) throw new HttpError("Reconnect the original Google account to preserve existing calendar links.", 409);
    await tx.insert(connections).values({ org_id: orgId, google_sub: user.sub, email: user.email, refresh_token: sealSecret(token.refresh_token!), origin }).onConflictDoUpdate({ target: connections.org_id, set: { email: user.email, refresh_token: sealSecret(token.refresh_token!), origin, error: null } });
  });
}
export async function calendarStatus(orgId: string, releaseId: string) {
  await assertRelease(orgId, releaseId);
  const row = await connection(orgId);
  const subscription = (await db.select().from(subscriptions).where(and(eq(subscriptions.org_id, orgId), eq(subscriptions.release_id, releaseId))))[0];
  const eventLinks = await db.select({ id: links.id, title: links.title, conflict: links.conflict, googleDate: links.google_date, ignored: links.ignored, resolution: links.resolution, kind: links.kind, itemId: links.item_id, etag: links.etag }).from(links).where(and(eq(links.org_id, orgId), eq(links.release_id, releaseId)));
  const localDates = new Map<string, string | null>();
  const release = (await db.select({ date: releases.release_date }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId))))[0];
  localDates.set(`release:${releaseId}`, release?.date ?? null);
  for (const item of await db.select({ id: ops_tasks.id, date: ops_tasks.due_date }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_release_id, releaseId)))) localDates.set(`task:${item.id}`, item.date);
  for (const item of await db.select({ id: release_milestones.id, date: release_milestones.due_date }).from(release_milestones).where(and(eq(release_milestones.org_id, orgId), eq(release_milestones.release_id, releaseId)))) localDates.set(`milestone:${item.id}`, item.date);
  return { configured: calendarConfigured(), connected: Boolean(row?.refresh_token), email: row?.email ?? null, calendarId: row?.calendar_id ?? null, calendarName: row?.calendar_name ?? null, lastSyncedAt: row?.last_synced_at?.toISOString() ?? null, error: row?.error ?? null, enabled: Boolean(subscription?.enabled), links: eventLinks.map((link) => ({ ...link, localDate: localDates.get(`${link.kind}:${link.itemId}`) ?? null })) };
}
export async function listCalendars(orgId: string) {
  const row = await connection(orgId);
  if (!row) throw new HttpError("Connect Google Calendar first.", 409);
  return writableCalendars(await accessToken(row));
}
export async function selectCalendar(orgId: string, calendarId: string) {
  await calendarConfiguration(orgId, async (tx) => {
    const row = await connection(orgId, tx);
    if (!row) throw new HttpError("Connect Google Calendar first.", 409);
    if (row.calendar_id && row.calendar_id !== calendarId && (await tx.select({ id: links.id }).from(links).where(eq(links.org_id, orgId)).limit(1)).length) throw new HttpError("This workspace already has linked events. Keep the current calendar to preserve those links.", 409);
    const calendar = (await writableCalendars(await accessToken(row))).find((item) => item.id === calendarId);
    if (!calendar) throw new HttpError("Choose a calendar you can edit.", 400);
    await tx.update(connections).set({ calendar_id: calendar.id, calendar_name: calendar.summary, error: null }).where(eq(connections.org_id, orgId));
  });
}
export async function enableCalendarRelease(orgId: string, releaseId: string, enabled: boolean) {
  await calendarConfiguration(orgId, async (tx) => {
    await assertRelease(orgId, releaseId, tx);
    const row = await connection(orgId, tx);
    if (enabled && (!row?.calendar_id || !row.refresh_token)) throw new HttpError("Connect Google and select a calendar first.", 409);
    await tx.insert(subscriptions).values({ org_id: orgId, release_id: releaseId, enabled }).onConflictDoUpdate({ target: [subscriptions.org_id, subscriptions.release_id], set: { enabled } });
  });
  if (enabled) await requestCalendarSync(orgId);
}
export async function disconnectCalendar(orgId: string) {
  await calendarConfiguration(orgId, async (tx) => { await tx.update(connections).set({ refresh_token: null, error: null }).where(eq(connections.org_id, orgId)); });
}
export async function requestCalendarSync(orgId: string) {
  const row = await connection(orgId);
  if (!row?.calendar_id || !row.refresh_token) throw new HttpError("Connect Google and select a calendar first.", 409);
  const jobId = `job_${crypto.randomUUID()}`;
  // Keep the job in the authenticated request transaction, including its tenant RLS context.
  await db.insert(job_runs).values({ id: jobId, org_id: orgId, job_type: "calendar_sync", trigger: "api", payload: {} });
  return { jobId };
}
export async function enqueueCalendarSyncs() {
  const rows = await db.select({ orgId: connections.org_id }).from(connections).where(and(eq(connections.org_id, sql`label_suite.current_org_id()`), isNotNull(connections.refresh_token), isNotNull(connections.calendar_id)));
  for (const row of rows) await jobStore.enqueue({ orgId: row.orgId, jobType: "calendar_sync", trigger: "scheduled", idempotencyKey: `scheduled:${Math.floor(Date.now() / 300_000)}` });
}

async function readItem(tx: Tx, orgId: string, link: Pick<Link, "kind" | "item_id" | "release_id">): Promise<{ date: string | null; title: string; assignees?: string[]; labels?: string[]; status?: string | null; owner?: string | null } | undefined> {
  if (link.kind === "release") return (await tx.select({ date: releases.release_date, title: releases.title }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, link.item_id))).for("update"))[0];
  if (link.kind === "milestone") return (await tx.select({ date: release_milestones.due_date, title: release_milestones.title }).from(release_milestones).where(and(eq(release_milestones.org_id, orgId), eq(release_milestones.id, link.item_id), eq(release_milestones.release_id, link.release_id))).for("update"))[0];
  return (await tx.select({ date: ops_tasks.due_date, title: ops_tasks.task_name, status: ops_tasks.status, assignees: ops_tasks.assignee_ids, labels: ops_tasks.labels, owner: ops_tasks.owner }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.id, link.item_id), eq(ops_tasks.linked_release_id, link.release_id))).for("update"))[0];
}
async function writeDate(tx: Tx, orgId: string, link: Link, date: string) {
  if (link.kind === "release") {
    await tx.update(releases).set({ release_date: date, updated_at: new Date() }).where(and(eq(releases.org_id, orgId), eq(releases.id, link.item_id)));
    await persistReleaseReadiness(link.item_id, tx, orgId);
    await syncReleaseCatalogEntry(tx, orgId, link.item_id, { allowMissing: true });
  } else if (link.kind === "milestone") {
    await tx.update(release_milestones).set({ due_date: date, updated_at: new Date() }).where(and(eq(release_milestones.org_id, orgId), eq(release_milestones.id, link.item_id)));
  } else {
    await tx.update(ops_tasks).set({ due_date: date, release_offset_days: null, is_overdue: sql`${date}::date < ${workspaceToday(orgId)} and ${taskIsOpen()}`, updated_at: new Date() }).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.id, link.item_id)));
  }
}
export async function resolveCalendarConflict(orgId: string, releaseId: string, id: string, choice: "suite" | "google" | "ignore", expected?: { localDate: string | null; etag: string | null }) {
  await calendarConfiguration(orgId, async (tx) => {
    const link = (await tx.select().from(links).where(and(tenantLink(orgId, id), eq(links.release_id, releaseId))))[0];
    if (!link || !link.conflict) throw new NotFoundError("Calendar conflict not found");
    if (choice === "ignore") {
      await tx.update(links).set({ ignored: true, conflict: null, resolution: null }).where(tenantLink(orgId, id));
      return;
    }
    const item = await readItem(tx, orgId, link);
    if (link.conflict !== "Dates changed in both places" || !validCalendarDate(item?.date) || !validCalendarDate(link.google_date)) throw new HttpError("This change cannot be merged. Restore a one-day event in Google, or stop syncing this item.", 409);
    if (!expected || expected.localDate !== item.date || expected.etag !== link.etag) throw new HttpError("This conflict changed. Refresh before choosing a date.", 409);
    await tx.update(links).set({ resolution: choice, resolved_local_date: item.date }).where(tenantLink(orgId, id));
  });
  if (choice !== "ignore") await requestCalendarSync(orgId);
}

export async function syncCalendar(orgId: string, signal?: AbortSignal) {
  return calendarLock(orgId, async () => {
    const row = await connection(orgId);
    if (!row?.refresh_token || !row.calendar_id) return { skipped: true };
    try {
      const token = await accessToken(row);
      const calendar = await calendarRequest<WritableCalendar>(token, `users/me/calendarList/${encodeURIComponent(row.calendar_id)}`);
      if (!["owner", "writer"].includes(calendar.accessRole)) throw new HttpError("The selected calendar is no longer writable.", 409);
      const enabled = await db.select().from(subscriptions).where(and(eq(subscriptions.org_id, orgId), eq(subscriptions.enabled, true)));
      const members = (await listTaskPlanningOptions(orgId)).members;
      let synced = 0;
      for (const sub of enabled) {
        const release = (await db.select({ id: releases.id, title: releases.title, date: releases.release_date }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, sub.release_id))))[0];
        const candidates = release ? [
          { ...release, kind: "release" as const },
          ...(await db.select({ id: release_milestones.id, title: release_milestones.title, date: release_milestones.due_date }).from(release_milestones).where(and(eq(release_milestones.org_id, orgId), eq(release_milestones.release_id, sub.release_id)))).map((item) => ({ ...item, kind: "milestone" as const })),
          ...(await db.select({ id: ops_tasks.id, title: ops_tasks.task_name, date: ops_tasks.due_date }).from(ops_tasks).where(and(eq(ops_tasks.org_id, orgId), eq(ops_tasks.linked_release_id, sub.release_id)))).map((item) => ({ ...item, kind: "task" as const })),
        ] : [];
        // Commit event IDs before touching Google: retries reuse the same IDs even after a process crash.
        for (const item of candidates) if (validCalendarDate(item.date)) {
          const id = crypto.randomUUID();
          await db.insert(links).values({ id, org_id: orgId, release_id: sub.release_id, kind: item.kind, item_id: item.id, title: item.title, event_id: id.replaceAll("-", ""), base_date: item.date }).onConflictDoNothing();
        }
        const mapped = await db.select().from(links).where(and(eq(links.org_id, orgId), eq(links.release_id, sub.release_id), eq(links.ignored, false)));
        for (const link of mapped) {
          signal?.throwIfAborted();
          await syncItem(row, token, link, release?.title ?? "Deleted release", members);
          synced++;
        }
      }
      await db.update(connections).set({ last_synced_at: new Date(), error: null }).where(eq(connections.org_id, orgId));
      return { synced };
    } catch (error) {
      await db.update(connections).set({ error: error instanceof HttpError ? error.message : "Calendar sync failed. Retry, or contact the suite administrator." }).where(eq(connections.org_id, orgId));
      throw error;
    }
  });
}
async function syncItem(row: Connection, token: string, link: Link, releaseTitle: string, members: Array<{ id: string; name: string }>) {
  await db.transaction(async (tx) => {
    const item = await readItem(tx, row.org_id, link);
    const path = `calendars/${encodeURIComponent(row.calendar_id!)}/events`;
    let event: CalendarEvent | null = null;
    try { event = await calendarRequest<CalendarEvent>(token, `${path}/${link.event_id}`); }
    catch (error) { if (!(error instanceof CalendarApiError && [404, 410].includes(error.googleStatus))) throw error; }
    const conflict = async (message: string) => {
      await tx.update(links).set({ conflict: message, google_date: event ? eventDate(event) : null, etag: event?.etag ?? null, resolution: null, resolved_local_date: null }).where(tenantLink(row.org_id, link.id));
    };
    if (!item || !validCalendarDate(item.date)) { await conflict("Item removed or deadline cleared in the suite"); return; }
    const url = new URL(link.kind === "task" ? `/ops-tasks?task=${encodeURIComponent(link.item_id)}` : `/releases/${encodeURIComponent(link.release_id)}?section=timeline`, row.origin).toString();
    const details = item.assignees ? `\nAssignees: ${item.assignees.map((id) => members.find((member) => member.id === id)?.name ?? "Former member").join(", ") || item.owner || "Unassigned"}\nLabels: ${(item.labels ?? []).join(", ") || "None"}\nStatus: ${item.status ?? "todo"}` : "";
    const metadata = { summary: link.kind === "release" ? `${item.title} · Release` : `${releaseTitle} · ${item.title}`, description: `Label Suite release schedule${details}\n\n${url}\n\nMove this all-day event to change its deadline. Manage tasks, labels and assignees in Label Suite.` };
    if (event?.status === "cancelled" || (!event && link.published)) { await conflict("Event deleted in Google Calendar"); return; }
    if (!event) {
      try { event = await calendarRequest<CalendarEvent>(token, `${path}?sendUpdates=none`, "POST", { id: link.event_id, ...metadata, start: { date: item.date }, end: { date: nextDate(item.date) }, extendedProperties: { private: { labelSuiteLink: link.id } } }); }
      catch (error) {
        if (!(error instanceof CalendarApiError && error.googleStatus === 409)) throw error;
        event = await calendarRequest<CalendarEvent>(token, `${path}/${link.event_id}`);
      }
    }
    if (event.extendedProperties?.private?.labelSuiteLink !== link.id) { await conflict("Calendar event link cannot be verified"); return; }
    const remote = eventDate(event);
    if (!remote || !event.etag) { await conflict("Use a single all-day event to sync this deadline"); return; }
    let decision = reconcileDate(link.base_date, item.date, remote);
    if (link.resolution) {
      if (link.resolved_local_date !== item.date || link.etag !== event.etag) { await conflict("Dates changed in both places"); return; }
      decision = link.resolution === "suite" ? "push" : "pull";
    }
    if (decision === "conflict") { await conflict("Dates changed in both places"); return; }
    const date = decision === "pull" ? remote : item.date;
    // Check Google version before accepting a pull too, so an edit made during reconciliation is retried.
    try {
      if (decision !== "same" || event.summary !== metadata.summary || event.description !== metadata.description) {
        event = await calendarRequest<CalendarEvent>(token, `${path}/${link.event_id}?sendUpdates=none`, "PATCH", { ...metadata, ...(decision === "push" ? { start: { date }, end: { date: nextDate(date) } } : {}) }, event.etag);
      }
    } catch (error) {
      if (error instanceof CalendarApiError && error.googleStatus === 412) { await conflict("Dates changed in both places"); return; }
      throw error;
    }
    if (decision === "pull") await writeDate(tx, row.org_id, link, date);
    await tx.update(links).set({ title: item.title, base_date: date, published: true, conflict: null, google_date: date, etag: event.etag, resolution: null, resolved_local_date: null }).where(tenantLink(row.org_id, link.id));
  });
}
