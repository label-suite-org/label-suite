import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_NOTIFICATIONS_INTEGRATION === "1";
const org = `collection-${randomUUID()}`, otherOrg = `${org}-other`, users = [`${org}-a`, `${org}-b`];
let sql: Sql;
let collect: typeof import("./native-notification-collection").collectNativeNotifications;

describe.skipIf(!enabled)("durable native notification collection", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 2 });
    for (const [table, migration] of [["notification_preferences", "0096_notification_preferences"], ["notification_devices", "0097_notification_devices"], ["notification_intents", "0098_notification_intents"]]) {
      if (!(await sql`select to_regclass(${`label_suite.${table}`}) as name`)[0].name) await sql.unsafe(await readFile(new URL(`../../drizzle/${migration}.sql`, import.meta.url), "utf8"));
    }
    collect = (await import("./native-notification-collection")).collectNativeNotifications;
    const { nativeNotificationPreferences } = await import("./native-notification-preferences");
    for (const id of [org, otherOrg]) await sql`insert into label_suite.orgs(id,name,slug,timezone) values (${id},'Collection test',${id},'Pacific/Auckland')`;
    await sql`insert into label_suite.artists(id,org_id,name) values (${`${org}-before`},${org},'Pre-opt-in private draft')`;
    for (const user of users) {
      await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${user},'Collection actor',${`${user}@example.test`},true)`;
      await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values (${`${user}-membership`},${org},${user},'owner')`;
      for (const category of ["assignments", "deadlines", "record_changes", "requested_reviews", "approval_results"]) {
        await nativeNotificationPreferences(org, user, { category, enabled: true, expectedGeneration: 0 });
      }
    }
    await sql`insert into label_suite.artists(id,org_id,name) values (${`${org}-precision`},${org},'Immediately before consent')`;
    await sql`update label_suite.audit_logs set created_at=(select enabled_at - interval '1 microsecond' from label_suite.notification_preferences where org_id=${org} and user_id=${users[0]} and category='record_changes') where org_id=${org} and entity_id=${`${org}-precision`}`;
  }, 20_000);
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.org_memberships where org_id=${org}`;
    await sql`delete from label_suite.job_runs where org_id=${org}`;
    await sql`delete from label_suite.budget_line_variance_requests where org_id=${org}`;
    await sql`delete from label_suite.budget_line_items where org_id=${org}`;
    await sql`delete from label_suite.ops_tasks where org_id=${org}`;
    await sql`delete from label_suite.artists where org_id in (${org},${otherOrg})`;
    await sql`delete from label_suite.audit_logs where org_id in (${org},${otherOrg})`;
    await sql`delete from label_suite.orgs where id in (${org},${otherOrg})`;
    for (const user of users) await sql`delete from label_suite.user where id=${user}`;
    await sql.end();
  });

  it("collects for every assignee with workspace deadlines, excludes history/other tenants, and deduplicates concurrent retries", async () => {
    await sql`insert into label_suite.ops_tasks(id,org_id,task_name,assignee_ids,due_date) values (${`${org}-task`},${org},'Private master',${users},(now() at time zone 'Pacific/Auckland')::date)`;
    await sql`insert into label_suite.artists(id,org_id,name) values (${`${org}-artist`},${org},'Private artist'),(${`${org}-foreign`},${otherOrg},'Other workspace')`;
    const result = await Promise.all([collect(org), collect(org)]);
    expect(result.reduce((count, row) => count + row.created, 0)).toBe(6);
    const intents = await sql`select user_id,category,record_id from label_suite.notification_intents where org_id=${org}`;
    for (const user of users) expect(intents.filter((row) => row.user_id === user).map((row) => row.category).sort()).toEqual(["assignments", "deadlines", "record_changes"]);
    expect(intents.some((row) => row.record_id === `${org}-before` || row.record_id === `${org}-precision` || row.record_id === `${org}-foreign`)).toBe(false);
    expect((await sql`select status from label_suite.ops_tasks where id=${`${org}-task`}`)[0].status).toBe('todo');
    expect((await sql`select count(*)::int as count from label_suite.job_runs where org_id=${org} and job_type='notification_sync'`)[0].count).toBeGreaterThan(0);
  });

  it("observes an older audit timestamp that commits after a previous batch", async () => {
    await sql.begin(async (tx) => {
      await tx`insert into label_suite.artists(id,org_id,name) values (${`${org}-late`},${org},'Late commit')`;
      await collect(org);
      expect(await tx`select id from label_suite.notification_intents where record_id=${`${org}-late`}`).toHaveLength(0);
    });
    expect((await collect(org)).created).toBe(2);
    expect(await sql`select id from label_suite.notification_intents where record_id=${`${org}-late`}`).toHaveLength(2);
  });

  it("rolls back source receipts and all recipients together on failure", async () => {
    await sql`insert into label_suite.artists(id,org_id,name) values (${`${org}-rollback`},${org},'Rollback source')`;
    const { runWithDatabaseContext } = await import('../lib/db');
    await expect(runWithDatabaseContext({ orgId: org, userId: users[0] }, async () => {
      expect((await collect(org)).created).toBe(2);
      throw new Error('Cancel batch');
    })).rejects.toThrow('Cancel batch');
    expect(await sql`select id from label_suite.notification_intents where record_id=${`${org}-rollback`}`).toHaveLength(0);
    expect((await collect(org)).created).toBe(2);
  });

  it("observes canonical budget reviews and decisions without changing approval state", async () => {
    const id = `${org}-variance`;
    await sql`insert into label_suite.budget_line_items(id,org_id,name,amount) values (${`${org}-line`},${org},'Private expense',100)`;
    await sql`insert into label_suite.budget_line_variance_requests(id,org_id,line_id,requested_by_user_id,requested_action,variance_reason) values (${id},${org},${`${org}-line`},${users[0]},'increase_amount','Private reason')`;
    await collect(org);
    expect(await sql`select user_id,category from label_suite.notification_intents where record_id=${id}`).toEqual([{ user_id: users[1], category: 'requested_reviews' }]);
    await sql`update label_suite.budget_line_variance_requests set status='approved',reviewed_by_user_id=${users[1]},reviewed_at=clock_timestamp() where id=${id}`;
    await collect(org); await collect(org);
    expect(await sql`select user_id from label_suite.notification_intents where record_id=${id} and category='approval_results'`).toEqual([{ user_id: users[0] }]);
    expect((await sql`select status from label_suite.budget_line_variance_requests where id=${id}`)[0].status).toBe('approved');
  });

  it("drains bounded batches without skipping the remainder", async () => {
    await sql`insert into label_suite.artists(id,org_id,name) select ${org} || '-batch-' || n,${org},'Batch source' from generate_series(1,102) n`;
    const first = await collect(org), second = await collect(org);
    expect(first.created).toBe(200); expect(second.created).toBe(4);
    expect((await collect(org)).created).toBe(0);
  });

  it("cleans expired rows in bounded batches without replaying old sources", async () => {
    await sql`update label_suite.ops_tasks set status='done' where org_id=${org}`;
    await sql`update label_suite.audit_logs set created_at=now()-interval '9 days' where org_id=${org}`;
    await sql`update label_suite.budget_line_variance_requests set created_at=now()-interval '9 days',reviewed_at=now()-interval '9 days' where org_id=${org}`;
    await sql`update label_suite.notification_preferences set enabled_at=now()-interval '10 days' where org_id=${org}`;
    await sql`update label_suite.notification_intents set expires_at=now()-interval '1 day' where org_id=${org}`;
    await sql`update label_suite.notification_source_receipts set created_at=now()-interval '9 days' where org_id=${org}`;
    const before = (await sql`select count(*)::int as n from label_suite.notification_source_receipts where org_id=${org}`)[0].n;
    expect((await collect(org)).created).toBe(0);
    const after = (await sql`select count(*)::int as n from label_suite.notification_source_receipts where org_id=${org}`)[0].n;
    expect(before - after).toBe(200); expect(after).toBeGreaterThan(0);
    for (let n = 0; n < 3; n++) expect((await collect(org)).created).toBe(0);
    expect(await sql`select id from label_suite.notification_intents where org_id=${org}`).toHaveLength(0);
    expect(await sql`select source_key from label_suite.notification_source_receipts where org_id=${org}`).toHaveLength(0);
  });

  it("keeps only a daily cleanup schedule after opt-out and stops once no metadata remains", async () => {
    await sql`update label_suite.notification_preferences set enabled_at=null,generation=generation+1 where org_id=${org}`;
    await sql`delete from label_suite.job_runs where org_id=${org}`;
    expect((await collect(org)).active).toBe(false);
    expect(await sql`select id from label_suite.job_runs where org_id=${org}`).toHaveLength(0);
    await sql`insert into label_suite.notification_source_receipts(org_id,user_id,category,preference_generation,source_key) values (${org},${users[0]},'record_changes',1,'retained-source')`;
    expect((await collect(org)).active).toBe(false);
    expect((await sql`select available_at > now()+interval '23 hours' as daily from label_suite.job_runs where org_id=${org}`)[0].daily).toBe(true);
  });
});
