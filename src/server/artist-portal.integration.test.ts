import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const originalUrl = process.env.DATABASE_URL ?? "";
const ciTarget = "postgres://label_suite:label_suite@127.0.0.1:5432/label_suite";
const localTarget = "postgres://portal_test:portal_test@127.0.0.1:55439/portal_test";
const enabled = (process.env.CI === "true" && process.env.RELEASE_GATE_FIXTURE_DISPOSABLE === "1" && originalUrl === ciTarget)
  || (process.env.ARTIST_PORTAL_INTEGRATION === "1" && originalUrl === localTarget);
const suffix = randomUUID().replaceAll("-", "");
const org = `portal-${suffix}`, otherOrg = `other-${suffix}`;
const artist = `artist-${suffix}`, sibling = `sibling-${suffix}`, foreignArtist = `foreign-${suffix}`;
const role = `portal_test_${suffix}`;
let admin: Pool;
let server: typeof import("./artist-portal");
let database: typeof import("../lib/db");
let schema: typeof import("../db/schema");

// Explicit disposable targets only. Service calls use a real non-owner, non-bypass role.
describe.skipIf(!enabled)("artist archive and form on PostgreSQL", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: originalUrl });
    await admin.query(`create role "${role}" login password '${suffix}' nosuperuser nobypassrls`);
    await admin.query(`grant usage on schema label_suite to "${role}"`);
    await admin.query(`grant select, insert, update, delete on all tables in schema label_suite to "${role}"`);
    await admin.query("insert into label_suite.orgs (id,name,slug) values ($1,'Portal test',$1),($2,'Other workspace',$2)", [org, otherOrg]);
    await admin.query("insert into label_suite.artists (id,org_id,name) values ($1,$2,'Test Artist'),($3,$2,'Sibling Artist'),($4,$5,'Foreign Artist')", [artist, org, sibling, foreignArtist, otherOrg]);
    await admin.query("insert into label_suite.documents (id,org_id,artist_id,name,file_link,notes,status) values ($1,$2,$3,'Agreement','https://example.test/agreement.pdf','INTERNAL SECRET','signed'),($4,$2,$5,'Sibling agreement','https://example.test/sibling.pdf','PRIVATE','draft')", [`doc-${suffix}`, org, artist, `sibling-doc-${suffix}`, sibling]);
    const runtimeUrl = new URL(originalUrl); runtimeUrl.username = role; runtimeUrl.password = suffix;
    process.env.DATABASE_URL = runtimeUrl.href;
    database = await import("../lib/db");
    server = await import("./artist-portal");
    schema = await import("../db/schema");
  });
  afterAll(async () => {
    process.env.DATABASE_URL = originalUrl;
    if (database) await database.pool.end();
    if (!admin) return;
    for (const table of ["artist_portal_submissions", "artist_portals", "documents", "artists", "audit_logs"]) {
      await admin.query(`delete from label_suite.${table} where org_id = any($1)`, [[org, otherOrg]]);
    }
    await admin.query("delete from label_suite.orgs where id = any($1)", [[org, otherOrg]]);
    await admin.query(`drop owned by "${role}"`);
    await admin.query(`drop role "${role}"`);
    await admin.end();
  });

  it("shares only selected agreements, isolates tenants, records credits once, reviews and revokes access", async () => {
    const asOperator = <T>(operation: () => Promise<T>) => database.runWithDatabaseContext({ userId: "", orgId: org }, operation);
    const link = await asOperator(() => server.manageArtistPortal(org, artist, { action: "create_link" }));
    const token = "token" in link ? link.token : "";
    const request = (access = token) => new Request("https://example.test/api/artist-portal", { headers: { authorization: `Bearer ${access}` } });
    const publicRead = () => server.withArtistPortal(request(), server.readArtistPortal);
    expect((await publicRead()).agreements).toEqual([]);
    await expect(asOperator(() => server.manageArtistPortal(org, foreignArtist, { action: "create_link" }))).rejects.toMatchObject({ status: 404 });
    await expect(asOperator(() => server.manageArtistPortal(org, artist, { action: "share", document_ids: [`sibling-doc-${suffix}`] }))).rejects.toMatchObject({ status: 400 });
    await asOperator(() => server.manageArtistPortal(org, artist, { action: "share", document_ids: [`doc-${suffix}`] }));
    expect((await publicRead()).agreements).toEqual([{ id: `doc-${suffix}`, name: "Agreement", status: "signed" }]);
    expect(JSON.stringify(await publicRead())).not.toContain("INTERNAL SECRET");
    await server.withArtistPortal(request(), async (portal) => {
      expect(await database.db.select().from(schema.artists)).toEqual([]);
      expect(await database.db.select().from(schema.documents)).toEqual([]);
      expect(await server.openArtistAgreement(portal, `doc-${suffix}`)).toEqual({ url: "https://example.test/agreement.pdf" });
      await expect(server.openArtistAgreement(portal, `sibling-doc-${suffix}`)).rejects.toMatchObject({ status: 404 });
    });
    const details = { id: randomUUID(), submitted_by: "Manager", email: "manager@example.test", release_title: "Record", track_title: "Song", version: "", contributors: [{ name: "Artist", role: "Music & lyrics", details: "" }], writing_shares: "Not agreed yet", notes: "Please review" };
    await server.withArtistPortal(request(), (portal) => server.submitArtistDetails(portal, details));
    await server.withArtistPortal(request(), (portal) => server.submitArtistDetails(portal, details));
    await expect(server.withArtistPortal(request(), (portal) => server.submitArtistDetails(portal, { ...details, notes: "Changed after a lost response" }))).rejects.toMatchObject({ status: 409 });
    const received = await publicRead();
    expect(received.submissions).toHaveLength(1);
    expect(received.submissions[0].reviewed_at).toBeNull();
    await server.withArtistPortal(request(), async () => {
      expect(await database.db.update(schema.artist_portal_submissions).set({ reviewed_at: new Date() }).returning()).toEqual([]);
      expect(await database.db.update(schema.artist_portals).set({ artist_name: "Hacked" }).returning()).toEqual([]);
    });
    await asOperator(() => server.manageArtistPortal(org, artist, { action: "review", submission_id: received.submissions[0].id }));
    expect((await publicRead()).submissions[0].reviewed_at).not.toBeNull();
    expect(await asOperator(() => database.db.select().from(schema.roles))).toEqual([]);
    await asOperator(() => server.manageArtistPortal(org, artist, { action: "revoke" }));
    await expect(publicRead()).rejects.toMatchObject({ status: 401 });
    const replacement = await asOperator(() => server.manageArtistPortal(org, artist, { action: "create_link" }));
    await expect(publicRead()).rejects.toMatchObject({ status: 401 });
    expect((await server.withArtistPortal(request("token" in replacement ? replacement.token : ""), server.readArtistPortal)).submissions).toHaveLength(1);
  });
});
