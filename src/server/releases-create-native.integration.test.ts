import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = Boolean(databaseUrl);
if (enabled) {
  const target = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "database"].includes(target.hostname)
    || target.pathname !== "/label_suite" || target.search || target.hash) {
    throw new Error("Native release integration requires the exact local label_suite CI database");
  }
}
const suffix = randomUUID();
const org = `release-create-${suffix}`;
const foreignOrg = `release-create-foreign-${suffix}`;
const actor = `release-create-user-${suffix}`;
const artist = `release-create-artist-${suffix}`;
const foreignArtist = `release-create-foreign-artist-${suffix}`;
let admin: Sql;
let create: typeof import("./releases").createReleaseForNative;
let read: typeof import("./releases").getReleaseDetail;
let context: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("native release creation against PostgreSQL", () => {
  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1 });
    const [releases, database] = await Promise.all([import("./releases"), import("../lib/db")]);
    create = releases.createReleaseForNative; read = releases.getReleaseDetail; context = database.runWithDatabaseContext;
    await admin`insert into label_suite.orgs (id, name, slug) values (${org}, 'Release fixture', ${org}), (${foreignOrg}, 'Foreign fixture', ${foreignOrg})`;
    await admin`insert into label_suite."user" (id, name, email, "emailVerified") values (${actor}, 'Fixture operator', ${`${actor}@example.test`}, true)`;
    await admin`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${`${org}:${actor}`}, ${org}, ${actor}, 'operator')`;
    await admin`insert into label_suite.artists (id, org_id, name) values (${artist}, ${org}, 'Artist fixture'), (${foreignArtist}, ${foreignOrg}, 'Foreign artist fixture')`;
  });
  afterAll(async () => {
    if (!admin) return;
    await admin`delete from label_suite.audit_events where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite.catalog_entries where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite.releases where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite.artists where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite.org_memberships where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite."user" where id = ${actor}`;
    await admin`delete from label_suite.audit_logs where org_id in (${org}, ${foreignOrg})`;
    await admin`delete from label_suite.orgs where id in (${org}, ${foreignOrg})`;
    await admin.end();
  });

  it("concurrent identical retries create one readable release, catalog entry and actor audit", async () => {
    const input = { id: randomUUID(), title: "Concurrent release", artist_id: artist, release_date: "2027-01-15", format: "EP" };
    const results = await Promise.all([1, 2].map(() => context({ userId: actor, orgId: org }, () => create(org, input, actor))));
    expect(results.map(result => result.repeated).sort()).toEqual([false, true]);
    const detail = await context({ userId: actor, orgId: org }, () => read(org, input.id));
    expect(detail).toMatchObject(input);
    const [audit] = await admin`select count(*)::int as count from label_suite.audit_events where org_id = ${org} and object_id = ${input.id} and actor_user_id = ${actor} and event_type = 'release.created'`;
    const [catalog] = await admin`select count(*)::int as count from label_suite.catalog_entries where org_id = ${org} and release_id = ${input.id}`;
    expect(audit.count).toBe(1); expect(catalog.count).toBe(1);
    await expect(context({ userId: actor, orgId: org }, () => create(org, { ...input, title: "Changed payload" }, actor))).rejects.toMatchObject({ status: 409 });
    expect((await read(org, input.id))?.title).toBe(input.title);
  });

  it("rejects foreign artist links and foreign ID collisions without adopting or changing either", async () => {
    await expect(context({ userId: actor, orgId: org }, () => create(org, { id: randomUUID(), title: "Wrong artist", artist_id: foreignArtist }, actor))).rejects.toMatchObject({ status: 404 });
    const id = randomUUID();
    await admin`insert into label_suite.releases (id, org_id, title, format) values (${id}, ${foreignOrg}, 'Foreign release', 'single')`;
    await expect(context({ userId: actor, orgId: org }, () => create(org, { id, title: "Foreign release" }, actor))).rejects.toMatchObject({ status: 409 });
    expect(await context({ userId: actor, orgId: org }, () => read(org, id))).toBeNull();
    const [foreign] = await admin`select title, org_id from label_suite.releases where id = ${id}`;
    expect(foreign).toEqual({ title: "Foreign release", org_id: foreignOrg });
  });

  it("rolls back the release when its audit cannot be committed", async () => {
    const id = randomUUID();
    await expect(context({ userId: actor, orgId: org }, () => create(org, { id, title: "Must roll back" }, "missing-audit-actor"))).rejects.toThrow();
    expect(await admin`select id from label_suite.releases where id = ${id}`).toHaveLength(0);
    expect(await admin`select id from label_suite.catalog_entries where release_id = ${id}`).toHaveLength(0);
  });
});
