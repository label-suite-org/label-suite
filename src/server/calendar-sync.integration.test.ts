import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, expect, it, describe, vi } from "vitest";
import type { CalendarEvent } from "./calendar-sync-core";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";
const target = process.env.DATABASE_URL ?? "";
const enabled = process.env.CI === "true";
const org = `calendar-${randomUUID()}`, releaseId = randomUUID(), taskId = randomUUID(), milestoneId = randomUUID();
const runtimeRole = `calendar_runtime_${randomUUID().replaceAll("-", "")}`;
let sql: ReturnType<typeof postgres>;
let api: typeof import("./calendar-sync");
const events = new Map<string, CalendarEvent>();
let failAfterInsert = true, failPatch = false, inserted = 0;
const eventFor = (title: string) => [...events.values()].find((event) => event.summary?.includes(title))!;
function move(event: CalendarEvent, date: string) {
  event.start = { date }; const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); event.end = { date: d.toISOString().slice(0, 10) }; event.etag += "x";
}
describe.skipIf(!enabled)("calendar sync on disposable PostgreSQL", () => {
  beforeAll(async () => {
    assertDisposableReleaseGateTarget({
      databaseUrl: target, ci: process.env.CI,
      fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
      userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
      analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
      analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
    });
    vi.stubEnv("GOOGLE_CLIENT_ID", "test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret"); vi.stubEnv("GMAIL_TOKEN_SECRET", "test-calendar-key");
    sql = postgres(target, { max: 1 });
    await sql.unsafe(`create role ${runtimeRole} nologin`);
    await sql.unsafe(`grant usage on schema label_suite to ${runtimeRole}`);
    await sql.unsafe(`grant select, insert, update, delete on all tables in schema label_suite to ${runtimeRole}`);
    vi.stubEnv("PGOPTIONS", `-c role=${runtimeRole} -c app.current_org_id=${org}`);
    api = await import("./calendar-sync");
    const { sealSecret } = await import("./gmail-enrichment");
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Calendar test',${org})`;
    await sql`insert into label_suite.releases (id,org_id,title,release_date) values (${releaseId},${org},'Test release','2026-12-04')`;
    await sql`insert into label_suite.ops_tasks (id,org_id,task_name,linked_release_id,due_date,labels,release_offset_days) values (${taskId},${org},'Test master',${releaseId},'2026-11-01',array['Audio'],-33)`;
    await sql`insert into label_suite.release_milestones (id,org_id,release_id,title,phase,due_date) values (${milestoneId},${org},${releaseId},'Test delivery','distribution_dsp','2026-11-10')`;
    await sql`insert into label_suite.calendar_connections (org_id,google_sub,email,refresh_token,calendar_id,calendar_name,origin) values (${org},'google-test','calendar@example.com',${sealSecret('refresh')},'shared-calendar','True Nature test','https://suite.example')`;
    await sql`insert into label_suite.calendar_releases (org_id,release_id) values (${org},${releaseId})`;
    vi.stubGlobal("fetch", vi.fn(async (input: string, options: RequestInit = {}) => {
      if (input.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "access" }));
      if (input.includes("calendarList/shared-calendar")) return new Response(JSON.stringify({ id: "shared-calendar", summary: "True Nature test", accessRole: "writer" }));
      if (!input.includes("/calendars/shared-calendar/events")) throw new Error(`Unexpected test request: ${input}`);
      const id = new URL(input).pathname.split("/").at(-1)!;
      if (options.method === "POST") {
        const body = JSON.parse(String(options.body));
        if (events.has(body.id)) return new Response("duplicate", { status: 409 });
        const event = { ...body, etag: "v1" };
        events.set(body.id, event); inserted++;
        if (body.summary.includes("Test master") && failAfterInsert) { failAfterInsert = false; throw new Error("Simulated lost response after Google saved event"); }
        return new Response(JSON.stringify(event));
      }
      const event = events.get(id);
      if (!event) return new Response("missing", { status: 404 });
      if (options.method === "PATCH") {
        if (failPatch) { failPatch = false; move(event, "2026-11-18"); return new Response("changed", { status: 412 }); }
        if ((options.headers as Record<string,string>)["If-Match"] !== event.etag) return new Response("changed", { status: 412 });
        Object.assign(event, JSON.parse(String(options.body))); event.etag += "x";
      }
      return new Response(JSON.stringify(event));
    }));
  });
  afterAll(async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    if (!sql) return;
    for (const table of ["calendar_event_links", "calendar_releases", "calendar_connections", "job_runs", "ops_tasks", "release_milestones", "catalog_entries", "releases", "audit_events", "audit_logs"]) await sql`delete from label_suite.${sql(table)} where org_id = ${org}`;
    await sql`delete from label_suite.orgs where id = ${org}`;
    await (await import("../lib/db")).pool.end();
    await sql.unsafe(`drop owned by ${runtimeRole}`);
    await sql.unsafe(`drop role ${runtimeRole}`);
    await sql.end();
  });
  it("queues manual sync within the tenant request and rolls it back with the request", async () => {
    const { db, runWithDatabaseContext } = await import("../lib/db");
    const { sql: query } = await import("drizzle-orm");
    const role = `calendar_queue_${randomUUID().replaceAll("-", "")}`;
    await sql.unsafe(`create role ${role} nologin`);
    try {
      await sql.unsafe(`grant usage on schema label_suite to ${role}`);
      await sql.unsafe(`grant select on label_suite.calendar_connections to ${role}`);
      await sql.unsafe(`grant select, insert on label_suite.job_runs to ${role}`);
      let jobId = "";
      await expect(runWithDatabaseContext({ userId: "calendar-test", orgId: org }, async () => {
        await db.execute(query.raw(`set local role ${role}`));
        jobId = (await api.requestCalendarSync(org)).jobId;
        expect((await db.execute(query`select id from label_suite.job_runs where id=${jobId}`)).rows).toHaveLength(1);
        throw new Error("Abort request");
      })).rejects.toThrow("Abort request");
      expect(await sql`select id from label_suite.job_runs where id=${jobId}`).toHaveLength(0);
    } finally {
      await sql.unsafe(`drop owned by ${role}`);
      await sql.unsafe(`drop role ${role}`);
    }
  });
  it("runs the scheduled queue lifecycle with tenant RLS enabled", async () => {
    const { jobStore } = await import("./jobs");
    const { pool } = await import("../lib/db");
    expect((await pool.query("select current_user, label_suite.current_org_id() as org")).rows[0]).toEqual({ current_user: runtimeRole, org });
    await api.enqueueCalendarSyncs();
    await sql`update label_suite.job_runs set available_at=now()-interval '1 minute' where org_id=${org}`;
    const job = await jobStore.claim("calendar-test-worker", 60_000);
    expect(job).toMatchObject({ orgId: org, jobType: "calendar_sync", trigger: "scheduled" });
    expect(await jobStore.heartbeat(job!, "calendar-test-worker", 60_000)).toBe(true);
    expect(await jobStore.succeed(job!, "calendar-test-worker", {})).toBe(true);
    const retry = await jobStore.enqueue({ orgId: org, jobType: "calendar_sync", trigger: "scheduled", maxAttempts: 1, availableAt: new Date("2000-01-01") });
    const claimed = await jobStore.claim("calendar-test-worker", 60_000);
    expect(claimed?.id).toBe(retry.id);
    expect(await jobStore.fail(claimed!, "calendar-test-worker", new Error("Test failure"))).toBe(true);
    await expect(jobStore.enqueue({ orgId: "true-nature", jobType: "calendar_sync", trigger: "scheduled" })).rejects.toMatchObject({ code: "42501" });
    expect((await sql`select status from label_suite.job_runs where id=${retry.id}`)[0].status).toBe("failed");
  });
  it("reuses event IDs after lost responses, syncs dates both ways, and resolves conflicts without task deletion", async () => {
    const firstRequest = await api.requestCalendarSync(org);
    const secondRequest = await api.requestCalendarSync(org);
    expect(secondRequest.jobId).not.toBe(firstRequest.jobId);
    await expect(api.syncCalendar(org)).rejects.toThrow("Simulated lost response");
    await api.syncCalendar(org);
    expect(inserted).toBe(3);
    await api.syncCalendar(org);
    expect(inserted).toBe(3);
    const taskEvent = eventFor("Test master"), releaseEvent = eventFor("Release"), milestoneEvent = eventFor("Test delivery");
    expect(taskEvent.description).toContain("Labels: Audio");
    move(taskEvent, "2026-11-08"); move(releaseEvent, "2026-12-11"); move(milestoneEvent, "2026-11-12");
    await api.syncCalendar(org);
    expect((await sql`select due_date::text as date, release_offset_days from label_suite.ops_tasks where id=${taskId}`)[0]).toMatchObject({ date: "2026-11-08", release_offset_days: null });
    expect((await sql`select release_date from label_suite.releases where id=${releaseId}`)[0].release_date).toBe("2026-12-11");
    expect((await sql`select due_date::text as date from label_suite.release_milestones where id=${milestoneId}`)[0].date).toBe("2026-11-12");
    await sql`update label_suite.ops_tasks set due_date='2026-11-09' where id=${taskId}`;
    await api.syncCalendar(org);
    expect(taskEvent.start?.date).toBe("2026-11-09");
    await sql`update label_suite.ops_tasks set due_date='2026-11-10' where id=${taskId}`;
    move(taskEvent, "2026-11-11");
    await api.syncCalendar(org);
    let status = await api.calendarStatus(org, releaseId);
    let conflict = status.links.find((link) => link.itemId === taskId)!;
    expect(conflict).toMatchObject({ conflict: "Dates changed in both places", localDate: "2026-11-10", googleDate: "2026-11-11" });
    await expect(api.resolveCalendarConflict(org, releaseId, conflict.id, "google", { localDate: "2026-11-01", etag: conflict.etag })).rejects.toThrow("conflict changed");
    await expect(api.resolveCalendarConflict("other-org", releaseId, conflict.id, "ignore")).rejects.toThrow("not found");
    await api.resolveCalendarConflict(org, releaseId, conflict.id, "google", { localDate: conflict.localDate, etag: conflict.etag });
    await api.syncCalendar(org);
    expect((await sql`select due_date::text as date from label_suite.ops_tasks where id=${taskId}`)[0].date).toBe("2026-11-11");
    await sql`update label_suite.ops_tasks set due_date='2026-11-12' where id=${taskId}`;
    failPatch = true;
    await api.syncCalendar(org);
    expect((await sql`select due_date::text as date from label_suite.ops_tasks where id=${taskId}`)[0].date).toBe("2026-11-12");
    await api.syncCalendar(org); // refresh conflict to the new remote ETag
    conflict = (await api.calendarStatus(org, releaseId)).links.find((link) => link.itemId === taskId)!;
    expect(conflict.googleDate).toBe("2026-11-18");
    await api.resolveCalendarConflict(org, releaseId, conflict.id, "suite", { localDate: conflict.localDate, etag: conflict.etag });
    await api.syncCalendar(org);
    expect(taskEvent.start?.date).toBe("2026-11-12");
    taskEvent.status = "cancelled";
    await api.syncCalendar(org);
    conflict = (await api.calendarStatus(org, releaseId)).links.find((link) => link.itemId === taskId)!;
    expect(conflict.conflict).toBe("Event deleted in Google Calendar");
    await api.resolveCalendarConflict(org, releaseId, conflict.id, "ignore");
    await api.syncCalendar(org);
    expect((await sql`select count(*)::int as count from label_suite.ops_tasks where id=${taskId}`)[0].count).toBe(1);
    expect(inserted).toBe(3);
    await expect(api.calendarStatus("other-org", releaseId)).rejects.toThrow("Release not found");
    const { runWithDatabaseContext } = await import("../lib/db");
    await runWithDatabaseContext({ userId: "calendar-test", orgId: org }, async () => {
      await api.enableCalendarRelease(org, releaseId, false);
      await expect(api.syncCalendar(org)).rejects.toThrow("sync is running");
    });
    await api.syncCalendar(org); // configuration lock is released only after the outer request commits
    await api.disconnectCalendar(org);
    expect(await api.syncCalendar(org)).toEqual({ skipped: true });
    expect((await api.calendarStatus(org, releaseId)).connected).toBe(false);
  }, 60_000);
});
