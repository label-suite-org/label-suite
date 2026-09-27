import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_NOTIFICATIONS_INTEGRATION === "1";
const org = `resolve-${randomUUID()}`, foreign = `${org}-foreign`, user = `${org}-user`, other = `${org}-other`;
const session = `${user}-session`, unavailable = { status: "unavailable" };
const kinds = ["artist", "release", "track", "work", "contact", "organization", "campaign", "project", "grant_application", "task"];
const ids = new Map<string, string>();
let sql: Sql;
let resolve: typeof import("./native-notification-resolution").resolveNativeNotification;
let collect: typeof import("./native-notification-collection").collectNativeNotifications;
async function alert(kind: string, category = "record_changes") {
  const [row] = await sql`select id from label_suite.notification_intents where org_id=${org} and user_id=${user} and record_kind=${kind} and category=${category} order by created_at desc limit 1`;
  expect(row).toBeDefined();
  return row.id as string;
}

describe.skipIf(!enabled)("authenticated native notification resolution", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 2 });
    for (const [table, migration] of [["notification_preferences", "0096_notification_preferences"], ["notification_intents", "0098_notification_intents"]]) {
      if (!(await sql`select to_regclass(${`label_suite.${table}`}) as name`)[0].name) await sql.unsafe(await readFile(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    }
    resolve = (await import("./native-notification-resolution")).resolveNativeNotification;
    collect = (await import("./native-notification-collection")).collectNativeNotifications;
    const { nativeNotificationPreferences: preferences } = await import("./native-notification-preferences");
    for (const id of [org, foreign]) await sql`insert into label_suite.orgs(id,name,slug,timezone) values (${id},'Private workspace',${id},'Pacific/Auckland')`;
    for (const id of [user, other]) {
      await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${id},'Private person',${`${id}@example.test`},true)`;
      await sql`insert into label_suite.session(id,"userId",token,"expiresAt") values (${`${id}-session`},${id},${randomUUID()},now()+interval '1 day')`;
      await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${id},${org},${id},'owner')`;
      for (const category of ["assignments", "deadlines", "record_changes", "requested_reviews", "approval_results"]) await preferences(org, id, { category, enabled: true, expectedGeneration: 0 });
    }
    for (const [table, field, kind] of [["artists", "name", "artist"], ["releases", "title", "release"], ["works", "title", "work"], ["contacts", "name", "contact"], ["organizations", "name", "organization"], ["campaigns", "campaign_name", "campaign"], ["budget_projects", "name", "project"]]) {
      const id = `${org}-${kind}`; ids.set(kind, id);
      await sql`insert into ${sql(`label_suite.${table}`)}(id,org_id,${sql(field)}) values (${id},${org},'Private record')`;
    }
    ids.set("track", `${org}-track`); ids.set("task", `${org}-task`); ids.set("grant_application", `${org}-grant`);
    await sql`insert into label_suite.tracks(id,org_id,title,release_id,work_id) values (${ids.get("track")!},${org},'Private track',${ids.get("release")!},${ids.get("work")!})`;
    await sql`insert into label_suite.grant_applications(id,org_id) values (${ids.get("grant_application")!},${org})`;
    await sql`insert into label_suite.ops_tasks(id,org_id,task_name,assignee_ids,due_date) values (${ids.get("task")!},${org},'Private task',${[user]},(now() at time zone 'Pacific/Auckland')::date)`;
    await sql`insert into label_suite.budget_line_items(id,org_id,name,amount,project_id) values (${`${org}-line`},${org},'Private expense',100,${ids.get("project")!})`;
    await sql`insert into label_suite.budget_line_variance_requests(id,org_id,line_id,requested_by_user_id,requested_action,variance_reason) values (${`${org}-variance`},${org},${`${org}-line`},${other},'increase_amount','Private reason')`;
    await sql`insert into label_suite.releases(id,org_id,title) values (${`${foreign}-release`},${foreign},'Foreign release')`;
    await sql`insert into label_suite.budget_projects(id,org_id,name) values (${`${foreign}-project`},${foreign},'Foreign project')`;
    await collect(org);
  }, 20_000);
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.session where "userId" in (${user},${other})`;
    await sql`delete from label_suite.org_memberships where org_id=${org}`;
    for (const table of ["job_runs", "budget_line_variance_requests", "budget_line_items", "ops_tasks", "grant_applications", "tracks", "works", "campaigns", "budget_projects", "releases", "artists", "contacts", "organizations", "audit_logs"]) await sql`delete from ${sql(`label_suite.${table}`)} where org_id in (${org},${foreign})`;
    await sql`delete from label_suite.orgs where id in (${org},${foreign})`;
    await sql`delete from label_suite.user where id in (${user},${other})`;
    await sql.end();
  });

  it("resolves every supported collected source to exact IDs without private record data or changing workflow state", async () => {
    for (const kind of kinds) {
      const id = await alert(kind, kind === "task" ? "assignments" : "record_changes");
      const expected = { workspaceId: org, kind, recordId: ids.get(kind), ...(kind === "track" ? { releaseId: ids.get("release") } : {}) };
      expect(await resolve(user, session, id)).toEqual({ status: "available", destination: expected });
      expect(await resolve(user, session, id)).toEqual({ status: "available", destination: expected });
    }
    expect(await resolve(user, session, await alert("task", "deadlines"))).toEqual({ status: "available", destination: { workspaceId: org, kind: "task", recordId: ids.get("task") } });
    expect(await resolve(user, session, await alert("budget_variance", "requested_reviews"))).toEqual({ status: "available", destination: { workspaceId: org, kind: "budget_variance", recordId: `${org}-variance`, lineId: `${org}-line`, projectId: ids.get("project") } });
    expect((await sql`select status from label_suite.ops_tasks where id=${ids.get("task")!}`)[0].status).toBe("todo");
    expect((await sql`select status from label_suite.budget_line_variance_requests where id=${`${org}-variance`}`)[0].status).toBe("pending");
  });

  it("rejects wrong identity, expired/deleted sessions, expired/missing intents and deleted records", async () => {
    const id = await alert("artist");
    expect(await resolve(other, `${other}-session`, id)).toEqual(unavailable);
    expect(await resolve(user, `${other}-session`, id)).toEqual(unavailable);
    expect(await resolve(user, "deleted-session", id)).toEqual(unavailable);
    expect(await resolve(user, session, randomUUID())).toEqual(unavailable);
    await expect(resolve(user, session, "https://untrusted.example")).rejects.toThrow();
    await sql`update label_suite.session set "expiresAt"=now()-interval '1 second' where id=${session}`;
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await sql`update label_suite.session set "expiresAt"=now()+interval '1 day' where id=${session}`;
    await sql`update label_suite.notification_intents set expires_at=now()-interval '1 second' where id=${id}`;
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await sql`update label_suite.notification_intents set expires_at=now()+interval '1 day' where id=${id}`;
    await sql`update label_suite.notification_intents set record_kind='release',record_id=${`${foreign}-release`} where id=${id}`;
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await sql`update label_suite.notification_intents set record_kind='https://untrusted.example',record_id=${ids.get("artist")!} where id=${id}`;
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await sql`update label_suite.notification_intents set record_kind='artist' where id=${id}`;
    const contact = await alert("contact");
    await sql`delete from label_suite.contacts where id=${ids.get("contact")!}`;
    expect(await resolve(user, session, contact)).toEqual(unavailable);
  });

  it("rechecks task assignment, completion, due date and canonical track parents", async () => {
    const assignment = await alert("task", "assignments"), deadline = await alert("task", "deadlines"), track = await alert("track");
    await sql`update label_suite.ops_tasks set assignee_ids=${[other]} where id=${ids.get("task")!}`;
    expect(await resolve(user, session, assignment)).toEqual(unavailable);
    await sql`update label_suite.ops_tasks set assignee_ids=${[user]},status='Completed' where id=${ids.get("task")!}`;
    expect(await resolve(user, session, assignment)).toEqual(unavailable);
    expect(await resolve(user, session, deadline)).toEqual(unavailable);
    await sql`update label_suite.ops_tasks set status='todo',due_date=due_date+1 where id=${ids.get("task")!}`;
    expect(await resolve(user, session, deadline)).toEqual(unavailable);
    await sql`update label_suite.ops_tasks set linked_release_id=${`${foreign}-release`} where id=${ids.get("task")!}`;
    expect(await resolve(user, session, assignment)).toEqual(unavailable);
    await sql`update label_suite.ops_tasks set linked_release_id=null where id=${ids.get("task")!}`;
    await sql`update label_suite.tracks set release_id=${`${foreign}-release`} where id=${ids.get("track")!}`;
    expect(await resolve(user, session, track)).toEqual(unavailable);
    await sql`update label_suite.tracks set release_id=null where id=${ids.get("track")!}`;
    expect(await resolve(user, session, track)).toEqual({ status: "available", destination: { workspaceId: org, kind: "track", recordId: ids.get("track"), releaseId: null } });
    await sql`update label_suite.tracks set release_id=${ids.get("release")!} where id=${ids.get("track")!}`;
    expect((await resolve(user, session, track)).status).toBe("available");
  });

  it("resolves projectless variance lines and suppresses stale decisions or foreign parents", async () => {
    const id = await alert("budget_variance", "requested_reviews");
    await expect(sql`update label_suite.budget_line_items set project_id=${`${foreign}-project`} where id=${`${org}-line`}`).rejects.toThrow("Cross-organization reference");
    await sql`update label_suite.budget_line_items set project_id=null where id=${`${org}-line`}`;
    expect(await resolve(user, session, id)).toEqual({ status: "available", destination: { workspaceId: org, kind: "budget_variance", recordId: `${org}-variance`, lineId: `${org}-line`, projectId: null } });
    await sql`update label_suite.budget_line_variance_requests set status='approved',reviewed_by_user_id=${user},reviewed_at=clock_timestamp() where id=${`${org}-variance`}`;
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await collect(org);
    const [result] = await sql`select id from label_suite.notification_intents where record_id=${`${org}-variance`} and user_id=${other} and category='approval_results'`;
    expect((await resolve(other, `${other}-session`, result.id)).status).toBe("available");
    await sql`update label_suite.budget_line_variance_requests set reviewed_at=reviewed_at+interval '1 microsecond' where id=${`${org}-variance`}`;
    expect(await resolve(other, `${other}-session`, result.id)).toEqual(unavailable);
  });

  it("discovers only the recipient's memberships and resolves through enforced RLS", async () => {
    const id = await alert("artist"), { db, runWithDatabaseContext } = await import("../lib/db"), { sql: query } = await import("drizzle-orm");
    const role = `notification_resolve_${randomUUID().replaceAll("-", "")}`, rollback = new Error("Rollback test role");
    await expect(runWithDatabaseContext({ userId: user }, async () => {
      await db.execute(query`create role ${query.identifier(role)} nologin`);
      await db.execute(query`grant usage on schema label_suite to ${query.identifier(role)}`);
      await db.execute(query`grant select on all tables in schema label_suite to ${query.identifier(role)}`);
      await db.execute(query`grant update on label_suite.session,label_suite.org_memberships,label_suite.notification_preferences,label_suite.notification_intents to ${query.identifier(role)}`);
      await db.execute(query`set local role ${query.identifier(role)}`);
      expect((await resolve(user, session, id)).status).toBe("available");
      expect(await resolve(other, `${other}-session`, id)).toEqual(unavailable);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("suppresses disabled or previous-generation consent and revoked/restored roles and membership", async () => {
    const id = await alert("artist"), { nativeNotificationPreferences: preferences } = await import("./native-notification-preferences");
    await preferences(org, user, { category: "record_changes", enabled: false, expectedGeneration: 1 });
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await preferences(org, user, { category: "record_changes", enabled: true, expectedGeneration: 2 });
    expect(await resolve(user, session, id)).toEqual(unavailable);
    await sql`update label_suite.artists set name='Fresh private update' where id=${ids.get("artist")!}`;
    await collect(org);
    const fresh = await alert("artist");
    expect((await resolve(user, session, fresh)).status).toBe("available");
    await sql`update label_suite.org_memberships set role='payee' where user_id=${user} and org_id=${org}`;
    expect(await resolve(user, session, fresh)).toEqual(unavailable);
    await sql`update label_suite.org_memberships set role='owner' where user_id=${user} and org_id=${org}`;
    expect(await resolve(user, session, fresh)).toEqual(unavailable);
    await sql`delete from label_suite.org_memberships where user_id=${user} and org_id=${org}`;
    expect(await resolve(user, session, fresh)).toEqual(unavailable);
  });
});
