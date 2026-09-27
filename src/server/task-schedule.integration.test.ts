import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const target = "postgres://label_suite:label_suite@127.0.0.1:55432/label_suite";
const enabled = process.env.CI === "true" && process.env.DATABASE_URL === target;
const org = `schedule-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let tasks: typeof import("./ops-tasks");
describe.skipIf(!enabled)("task dependency graph on disposable PostgreSQL", () => {
  beforeAll(async () => {
    sql = postgres(target, { max: 1 });
    tasks = await import("./ops-tasks");
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Schedule test', ${org})`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.ops_tasks where org_id = ${org}`;
    await sql`delete from label_suite.audit_events where org_id = ${org}`;
    await sql`delete from label_suite.audit_logs where org_id = ${org}`;
    await sql`delete from label_suite.orgs where id = ${org}`;
    await sql.end();
  });
  it("prevents concurrent cycles and dependent deletion while preserving task fields", async () => {
    const a = randomUUID(), b = randomUUID();
    await tasks.createOpsTask(org, { id: a, task_name: "Master", labels: ["Audio"], due_date: "2026-09-25" });
    await tasks.createOpsTask(org, { id: b, task_name: "Deliver", labels: ["Distribution"] });
    const results = await Promise.allSettled([
      tasks.updateOpsTask(org, { id: a, dependency_ids: [b] }),
      tasks.updateOpsTask(org, { id: b, dependency_ids: [a] }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rows = await sql`select id, dependency_ids, labels, due_date::text as due_date from label_suite.ops_tasks where org_id = ${org}`;
    const dependent = rows.find((row) => row.dependency_ids.length)!;
    await expect(tasks.deleteOpsTask(org, { id: dependent.dependency_ids[0] })).rejects.toThrow("Other tasks depend");
    await expect(tasks.updateOpsTask("other-org", { id: a, labels: ["Foreign"] })).rejects.toThrow("Task not found");
    expect(rows.find((row) => row.id === a)).toMatchObject({ labels: ["Audio"], due_date: "2026-09-25" });
    await tasks.updateOpsTask(org, { id: dependent.id, dependency_ids: [] });
    await tasks.deleteOpsTask(org, { id: dependent.dependency_ids[0] });
  });
});
