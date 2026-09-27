import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = Boolean(databaseUrl);
const adminUrl = enabled ? assertLocalCiDatabase(databaseUrl) : undefined;
const suffix = randomUUID();
const orgA = `artist-native-org-a-${suffix}`;
const orgB = `artist-native-org-b-${suffix}`;
const userA = `artist-native-user-a-${suffix}`;
const userB = `artist-native-user-b-${suffix}`;
const artistA = `artist-native-a-${suffix}`;
const artistB = `artist-native-b-${suffix}`;

let admin: Sql | undefined;
let createArtistForNative: typeof import("./artists").createArtistForNative;
let updateArtistForNative: typeof import("./artists").updateArtistForNative;
let runWithDatabaseContext: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("native artist mutations against PostgreSQL", () => {
  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 });
    [{ createArtistForNative, updateArtistForNative }, { runWithDatabaseContext }] = await Promise.all([
      import("./artists"),
      import("../lib/db"),
    ]);
    await seedFixtures(admin);
  });

  afterAll(async () => {
    if (!admin) return;
    await admin`delete from "label_suite"."audit_events" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."artists" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."org_memberships" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."user" where "id" in (${userA}, ${userB})`;
    await admin`delete from "label_suite"."audit_logs" where "org_id" in (${orgA}, ${orgB})`;
    await admin`delete from "label_suite"."orgs" where "id" in (${orgA}, ${orgB})`;
    await admin.end();
  });

  it("edits a microsecond database revision once, preserving rich bio and recording the audit", async () => {
    const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Biography", marks: [{ type: "bold" }] }] }] };
    await admin!`update "label_suite"."artists" set "updated_at" = '2026-09-13 10:00:00.123456'::timestamp,
      "bio_document" = ${admin!.json(document)}, "bio" = 'Biography' where "id" = ${artistA}`;
    const input = { id: artistA, name: "Updated Artist", expected_updated_at: "2026-09-13T10:00:00.123Z" };
    await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => updateArtistForNative(orgA, input as never, userA));
    const [saved] = await admin!`select "name", "bio_document", "updated_at" from "label_suite"."artists" where "id" = ${artistA}`;
    expect(saved.name).toBe("Updated Artist");
    expect(saved.bio_document).toEqual(document);
    expect(saved.updated_at.toISOString()).not.toBe(input.expected_updated_at);
    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => updateArtistForNative(orgA, input as never, userA)))
      .rejects.toMatchObject({ status: 409 });
    const [audit] = await admin!`select count(*)::int as count from "label_suite"."audit_events"
      where "org_id" = ${orgA} and "object_id" = ${artistA} and "event_type" = 'artist.updated'`;
    expect(audit.count).toBe(1);
  });

  it("creates one Artist with its committed audit evidence", async () => {
    const created = await runWithDatabaseContext({ userId: userA, orgId: orgA }, () => createArtistForNative(orgA, { name: "Created Artist" } as never, userA));
    const [audit] = await admin!`select "actor_user_id" from "label_suite"."audit_events"
      where "org_id" = ${orgA} and "object_id" = ${created.id} and "event_type" = 'artist.created'`;
    expect(audit.actor_user_id).toBe(userA);
  });

  it("rejects a cross-tenant update without changing the target Artist or audit evidence", async () => {
    const before = await admin!`select "name", "updated_at" from "label_suite"."artists" where "id" = ${artistB}`;
    const auditBefore = await admin!`select count(*)::int as count from "label_suite"."audit_events" where "org_id" = ${orgA}`;
    const expectedUpdatedAt = before[0].updated_at.toISOString();

    await expect(runWithDatabaseContext({ userId: userA, orgId: orgA }, () => updateArtistForNative(orgA, {
      id: artistB,
      name: "Cross-tenant overwrite",
      expected_updated_at: expectedUpdatedAt,
    } as never, userA))).rejects.toMatchObject({ status: 404 });

    const after = await admin!`select "name", "updated_at" from "label_suite"."artists" where "id" = ${artistB}`;
    const auditAfter = await admin!`select count(*)::int as count from "label_suite"."audit_events" where "org_id" = ${orgA}`;
    expect(after[0]).toEqual(before[0]);
    expect(auditAfter[0].count).toBe(auditBefore[0].count);
  });

  it("rolls back a native create when its audit insert fails", async () => {
    const before = await admin!`select count(*)::int as count from "label_suite"."artists" where "org_id" = ${orgA}`;
    await expect(runWithDatabaseContext({ userId: "missing-audit-actor", orgId: orgA }, () => createArtistForNative(orgA, {
      name: "Must roll back",
    } as never, "missing-audit-actor"))).rejects.toThrow();

    const after = await admin!`select count(*)::int as count from "label_suite"."artists" where "org_id" = ${orgA}`;
    expect(after[0].count).toBe(before[0].count);
  });

  it("rolls back a native update when its audit insert fails", async () => {
    const before = await admin!`select "name", "updated_at" from "label_suite"."artists" where "id" = ${artistA}`;
    await expect(runWithDatabaseContext({ userId: "missing-audit-actor", orgId: orgA }, () => updateArtistForNative(orgA, {
      id: artistA,
      name: "Must roll back",
      expected_updated_at: before[0].updated_at.toISOString(),
    } as never, "missing-audit-actor"))).rejects.toThrow();

    const after = await admin!`select "name", "updated_at" from "label_suite"."artists" where "id" = ${artistA}`;
    expect(after[0]).toEqual(before[0]);
  });
});

async function seedFixtures(client: Sql | undefined): Promise<void> {
  if (!client) throw new Error("Artist mutation integration database is unavailable");
  await client`
    insert into "label_suite"."orgs" ("id", "name", "slug") values
      (${orgA}, 'Artist native org A', ${orgA}),
      (${orgB}, 'Artist native org B', ${orgB})
  `;
  await client`
    insert into "label_suite"."user" ("id", "name", "email", "emailVerified") values
      (${userA}, 'Artist native user A', ${`${userA}@example.test`}, true),
      (${userB}, 'Artist native user B', ${`${userB}@example.test`}, true)
  `;
  await client`
    insert into "label_suite"."org_memberships" ("id", "org_id", "user_id", "role") values
      (${`${orgA}:${userA}`}, ${orgA}, ${userA}, 'operator'),
      (${`${orgB}:${userB}`}, ${orgB}, ${userB}, 'operator')
  `;
  await client`
    insert into "label_suite"."artists" ("id", "org_id", "name") values
      (${artistA}, ${orgA}, 'Artist A'),
      (${artistB}, ${orgB}, 'Artist B')
  `;
}

function assertLocalCiDatabase(value: string): string {
  let target: URL;
  try { target = new URL(value); }
  catch { throw new Error("Refusing artist mutation integration target: DATABASE_URL must be a valid local PostgreSQL URL."); }
  const database = decodeURIComponent(target.pathname).replace(/^\/+/, "");
  if (!["postgres:", "postgresql:"].includes(target.protocol)
    || !["127.0.0.1", "localhost", "database"].includes(target.hostname)
    || database !== "label_suite" || target.search || target.hash) {
    throw new Error("Refusing artist mutation integration target: require the exact local label_suite CI database.");
  }
  return target.toString();
}
