import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const target = process.env.DATABASE_URL ?? "";
const enabled = process.env.NATIVE_TASKS_INTEGRATION === "1";
const suffix = randomUUID();
const orgA = `native-task-a-${suffix}`;
const orgB = `native-task-b-${suffix}`;
const userA = randomUUID();
const userB = randomUUID();
const foreignUser = randomUUID();
const taskA = randomUUID();
const taskB = randomUUID();
const foreignArtist = randomUUID();
let sql: Sql;
let executeNativeTaskAction: typeof import("./native-tasks").executeNativeTaskAction;
let canonicalTask: typeof import("./native-tasks").canonicalTask;
let runWithDatabaseContext: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("native Task audit and revision authority on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const parsed = new URL(target);
    if (parsed.hostname !== "127.0.0.1" || parsed.pathname !== "/native_tasks_fixture") throw new Error("Disposable native Tasks fixture only");
    sql = postgres(target, { max: 1 });
    [{ executeNativeTaskAction, canonicalTask }, { runWithDatabaseContext }] = await Promise.all([import("./native-tasks"), import("../lib/db")]);
    await sql`insert into label_suite.orgs (id, name, slug) values (${orgA}, 'Native Task A', ${orgA}), (${orgB}, 'Native Task B', ${orgB})`;
    await sql`insert into label_suite.user (id, name, email, "emailVerified") values (${userA}, 'A', ${`${userA}@example.test`}, true), (${userB}, 'B', ${`${userB}@example.test`}, true), (${foreignUser}, 'Foreign', ${`${foreignUser}@example.test`}, true)`;
    await sql`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${`${orgA}:${userA}`}, ${orgA}, ${userA}, 'operator'), (${`${orgA}:${userB}`}, ${orgA}, ${userB}, 'member'), (${`${orgB}:${foreignUser}`}, ${orgB}, ${foreignUser}, 'operator')`;
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, due_date) values (${taskA}, ${orgA}, 'Task A', '2026-09-20'), (${taskB}, ${orgA}, 'Task B', '2026-09-21')`;
    await sql`insert into label_suite.artists (id, org_id, name) values (${foreignArtist}, ${orgB}, 'Foreign Artist')`;
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.audit_events where org_id in (${orgA}, ${orgB})`;
    await sql`delete from label_suite.ops_tasks where org_id in (${orgA}, ${orgB})`;
    await sql`delete from label_suite.artists where id = ${foreignArtist}`;
    await sql`delete from label_suite.org_memberships where org_id in (${orgA}, ${orgB})`;
    await sql`delete from label_suite.user where id in (${userA}, ${userB}, ${foreignUser})`;
    await sql`delete from label_suite.audit_logs where org_id in (${orgA}, ${orgB})`;
    await sql`delete from label_suite.orgs where id in (${orgA}, ${orgB})`;
    await sql.end();
  });

  it("creates and acknowledges one native task with one atomic audit across concurrent retries", async () => {
    const { createOpsTask } = await import("./ops-tasks");
    const id = randomUUID();
    const input = { id, task_name: "Arrange rehearsal", due_date: "2027-01-01", priority: "P1", notes: "Fixture only", assignee_ids: [userB] };
    const results = await Promise.all([1, 2].map(() => runWithDatabaseContext({ userId: userA, orgId: orgA }, () => createOpsTask(orgA, input, userA))));
    expect(results).toEqual([{ id, ok: true }, { id, ok: true }]);
    expect(await canonicalTask(orgA, id)).toMatchObject({ task: { id, title: input.task_name, revision: 0, assignee_ids: [userB] } });
    const audits = await sql`select event_type, actor_user_id from label_suite.audit_events where object_id = ${id}`;
    expect(audits).toEqual([{ event_type: "task.create", actor_user_id: userA }]);
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => createOpsTask(orgA, { ...input, notes: "Different" }, userA))).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.ops_tasks set task_name = 'Edited' where id = ${id}`;
    await sql`update label_suite.ops_tasks set task_name = ${input.task_name} where id = ${id}`;
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => createOpsTask(orgA, input, userA))).rejects.toMatchObject({ status: 409 });
  });

  it("rejects foreign collisions, links and assignees without task writes", async () => {
    const { createOpsTask } = await import("./ops-tasks");
    const id = randomUUID();
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name) values (${id}, ${orgB}, 'Foreign')`;
    const create = (input: Parameters<typeof createOpsTask>[1]) => runWithDatabaseContext({ userId: userA, orgId: orgA }, () => createOpsTask(orgA, input, userA));
    await expect(create({ id, task_name: "Foreign" })).rejects.toMatchObject({ status: 409 });
    await expect(create({ id: randomUUID(), task_name: "Foreign artist", linked_artist_id: foreignArtist })).rejects.toMatchObject({ status: 404 });
    await expect(create({ id: randomUUID(), task_name: "Foreign member", assignee_ids: [foreignUser] })).rejects.toMatchObject({ status: 400 });
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where object_id = ${id}`;
    expect(audit.count).toBe(0);
    const workback = randomUUID();
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, workback_key) values (${workback}, ${orgA}, 'Existing workback', 'delivery')`;
    await expect(create({ id: workback, task_name: "Existing workback" })).rejects.toMatchObject({ status: 409 });
    // An invalid audit actor forces the entire transaction (including the task) to roll back.
    const rollback = randomUUID();
    await expect(createOpsTask(orgA, { id: rollback, task_name: "Rollback" }, "missing-actor")).rejects.toThrow();
    expect(await sql`select id from label_suite.ops_tasks where id = ${rollback}`).toHaveLength(0);
  });

  it("atomically revisions and audits a native action without mutating another task", async () => {
    const result = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, taskA, { action: "reschedule", expected_revision: 0, due_date: "2026-09-24" }, userA));
    expect(result).toMatchObject({ action: "reschedule", no_change: false, task: { revision: 1, due_date: "2026-09-24" } });
    const [saved, untouched, audit] = await Promise.all([
      sql`select due_date::text as due_date, revision from label_suite.ops_tasks where id = ${taskA}`,
      sql`select due_date::text as due_date, revision from label_suite.ops_tasks where id = ${taskB}`,
      sql`select event_type, actor_user_id, metadata from label_suite.audit_events where org_id = ${orgA} and object_id = ${taskA}`,
    ]);
    expect(saved[0]).toMatchObject({ due_date: "2026-09-24", revision: 1 });
    expect(untouched[0]).toMatchObject({ due_date: "2026-09-21", revision: 0 });
    expect(audit[0]).toMatchObject({ event_type: "task.reschedule", actor_user_id: userA, metadata: expect.objectContaining({ expected_revision: 0, resulting_revision: 1 }) });
  });

  it("rejects a no-op when another writer changes the task during validation", async () => {
    const { db } = await import("../lib/db");
    const { mutateOpsTaskInTransaction } = await import("./ops-tasks");
    const id = randomUUID();
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name, status) values (${id}, ${orgA}, 'Concurrent task', 'done')`;
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => db.transaction((tx) => mutateOpsTaskInTransaction(tx, orgA, {
      taskId: id, expectedRevision: 0, skipNoop: true, changes: { status: 'done' },
      validate: async () => { await sql`update label_suite.ops_tasks set status = 'todo' where id = ${id}`; },
    })))).rejects.toMatchObject({ status: 409 });
    const [record] = await sql`select status, revision from label_suite.ops_tasks where id = ${id}`;
    expect(record).toMatchObject({ status: 'todo', revision: 1 });
  });

  it("rejects stale and foreign reassignment without writes or audit evidence", async () => {
    const before = await sql`select status, revision, assignee_ids from label_suite.ops_tasks where id = ${taskA}`;
    const auditBefore = await sql`select count(*)::int as count from label_suite.audit_events where org_id = ${orgA} and object_id = ${taskA}`;
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, taskA, { action: "complete", expected_revision: 0 }, userA))).rejects.toMatchObject({ status: 409 });
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, taskA, { action: "reassign", expected_revision: 1, assignee_ids: [foreignUser] }, userA))).rejects.toMatchObject({ status: 400 });
    const after = await sql`select status, revision, assignee_ids from label_suite.ops_tasks where id = ${taskA}`;
    const auditAfter = await sql`select count(*)::int as count from label_suite.audit_events where org_id = ${orgA} and object_id = ${taskA}`;
    expect(after).toEqual(before);
    expect(auditAfter[0].count).toBe(auditBefore[0].count);
  });

  it("rejects native stale actions after web and direct system updates", async () => {
    const { updateOpsTask } = await import("./ops-tasks");
    const id = randomUUID();
    await sql`insert into label_suite.ops_tasks (id, org_id, task_name) values (${id}, ${orgA}, 'Interleaving fixture')`;
    await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => updateOpsTask(orgA, { id, task_name: "Web edit" }));
    const [web] = await sql`select revision from label_suite.ops_tasks where id = ${id}`;
    expect(web.revision).toBe(1);
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, id, { action: "complete", expected_revision: 0 }, userA))).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.ops_tasks set due_date = '2026-10-01' where id = ${id}`;
    const [system] = await sql`select revision from label_suite.ops_tasks where id = ${id}`;
    expect(system.revision).toBe(2);
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, id, { action: "complete", expected_revision: 1 }, userA))).rejects.toMatchObject({ status: 409 });
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where object_id = ${id}`;
    expect(audit.count).toBe(0);
    await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, id, { action: "complete", expected_revision: 2 }, userA));
    const noop = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => executeNativeTaskAction(orgA, id, { action: "complete", expected_revision: 3 }, userA));
    expect(noop).toMatchObject({ no_change: true, task: { revision: 3 } });
    const [after] = await sql`select count(*)::int as count from label_suite.audit_events where object_id = ${id}`;
    expect(after.count).toBe(1);
  });

  it("does not expose a relationship that belongs to another tenant", async () => {
    await sql`update label_suite.ops_tasks set linked_artist_id = ${foreignArtist} where id = ${taskB}`;
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => canonicalTask(orgA, taskB))).rejects.toMatchObject({ status: 404 });
  });
});
