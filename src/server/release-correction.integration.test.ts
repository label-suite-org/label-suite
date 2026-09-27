import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.RELEASE_CORRECTION_INTEGRATION === "1";
const id = randomUUID();
const org = `correction-org-${id}`, actor = `correction-user-${id}`, release = `correction-release-${id}`;
let sql: ReturnType<typeof postgres>;
let service: typeof import("./release-correction");
let scoped: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("release correction against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/release_readiness_fixture") throw new Error("Disposable fixture only");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./release-correction");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Fixture', ${org})`;
    await sql`insert into label_suite."user" (id, name, email, "emailVerified") values (${actor}, 'Fixture', ${`${actor}@example.test`}, true)`;
    await sql`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${id}, ${org}, ${actor}, 'operator')`;
    await sql`insert into label_suite.releases (id, org_id, title, format, release_date, updated_at) values (${release}, ${org}, 'Fixture', 'EP', '2026-12-04', '2026-09-27 10:00:00.123456')`;
  });
  afterAll(async () => { if (sql) await sql.end(); });

  it("returns canonical checks after a one-field save and rejects stale or foreign writes", async () => {
    const run = <T>(fn: () => Promise<T>) => scoped({ userId: actor, orgId: org }, fn);
    const before = await run(() => service.getReleaseReadinessSnapshot(org, release));
    expect(before.readiness.missing).toEqual(["UPC/EAN", "Cover art", "No tracks"]);
    const input = { field: "upc_ean" as const, value: "193436442374", expected_updated_at: before.release.updated_at! };
    const after = await run(() => service.correctReleaseField(org, release, actor, input));
    expect(after.release).toMatchObject({ title: "Fixture", format: "EP", release_date: "2026-12-04", upc_ean: input.value });
    expect(after.release.updated_at).not.toBe(before.release.updated_at);
    expect(after.readiness).toEqual({ isReady: false, missing: ["Cover art", "No tracks"] });
    await expect(run(() => service.correctReleaseField(org, release, actor, input))).rejects.toMatchObject({ status: 409 });
    await expect(run(() => service.correctReleaseField("foreign", release, actor, input))).rejects.toMatchObject({ status: 404 });
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where org_id = ${org} and object_id = ${release} and event_type = 'release.updated'`;
    expect(audit.count).toBe(1);
  });
});
