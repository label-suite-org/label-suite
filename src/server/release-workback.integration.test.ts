import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reschedulePreview } from "./release-workback-core";

// This test writes only to the disposable database created by Forgejo CI.
const target = "postgres://label_suite:label_suite@127.0.0.1:55432/label_suite";
const enabled = process.env.CI === "true" && process.env.DATABASE_URL === target;
const org = `workback-${randomUUID()}`, release = `release-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let apply: typeof import("./release-workback").applyReleaseWorkback;
let getTimeline: typeof import("./release-timeline").getReleaseTimeline;

describe.skipIf(!enabled)("workback on disposable PostgreSQL", () => {
  beforeAll(async () => {
    sql = postgres(target, { max: 1 });
    ({ applyReleaseWorkback: apply } = await import("./release-workback"));
    ({ getReleaseTimeline: getTimeline } = await import("./release-timeline"));
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Workback test', ${org})`;
    await sql`insert into label_suite.releases (id, org_id, title, release_date) values (${release}, ${org}, 'Test release', '2026-10-23')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.ops_tasks where org_id = ${org}`;
    await sql`delete from label_suite.releases where org_id = ${org}`;
    await sql`delete from label_suite.audit_events where org_id = ${org}`;
    await sql`delete from label_suite.audit_logs where org_id = ${org}`;
    await sql`delete from label_suite.orgs where id = ${org}`;
    await sql.end();
  });
  it("deduplicates concurrent applications and preserves fixed/completed dates during rescheduling", async () => {
    const input = { action: "apply" as const, releaseId: release, releaseDate: "2026-10-23", items: [
      { key: "masters", title: "Master", phase: "assets_metadata" as const, owner: null, dueDate: "2026-09-25", offsetDays: -28 },
      { key: "artwork", title: "Artwork", phase: "assets_metadata" as const, owner: null, dueDate: "2026-09-25", offsetDays: -28 },
      { key: "metadata", title: "Metadata", phase: "assets_metadata" as const, owner: null, dueDate: "2026-09-25", offsetDays: null },
    ] };
    const results = await Promise.all([apply(org, input), apply(org, input)]);
    expect(results.map((result) => result.created).sort()).toEqual([0, 3]);
    expect(await sql`select id from label_suite.ops_tasks where org_id = ${org}`).toHaveLength(3);
    await expect(apply("other-org", input)).rejects.toThrow("Release not found");
    await sql`update label_suite.ops_tasks set status = 'done' where org_id = ${org} and workback_key = 'artwork'`;
    await sql`update label_suite.releases set release_date = '2026-10-30' where id = ${release}`;
    const timeline = await getTimeline(org, release);
    const preview = reschedulePreview(timeline.phases.flatMap((phase) => phase.tasks), timeline.releaseDate);
    expect(preview).toHaveLength(1);
    await apply(org, { action: "reschedule", releaseId: release, releaseDate: "2026-10-30", preview });
    const rows = await sql`select workback_key, due_date::text as due_date from label_suite.ops_tasks where org_id = ${org} order by workback_key`;
    expect(rows.map((row) => [row.workback_key, row.due_date])).toEqual([["artwork", "2026-09-25"], ["masters", "2026-10-02"], ["metadata", "2026-09-25"]]);
    await expect(apply(org, { action: "reschedule", releaseId: release, releaseDate: "2026-10-30", preview })).rejects.toThrow("Tasks changed");
  });
});
