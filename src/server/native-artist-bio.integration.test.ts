import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const audit = vi.hoisted(() => ({ fail: false }));
vi.mock("./integrations", async original => {
  const actual = await original<typeof import("./integrations")>();
  return { ...actual, recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
    if (audit.fail) throw new Error("Disposable audit failure");
    return actual.recordAuditEvent(...args);
  } };
});
const org = `bio-${randomUUID()}`, foreign = `bio-${randomUUID()}`, actor = `bio-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let bio: typeof import("./native-artist-bio");
let scoped: typeof import("../lib/db").runWithDatabaseContext;
const id = (name: string) => `${org}-${name}`;
const document = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text, marks: [{ type: "bold" }] }] }] });
const read = (name: string) => scoped({ orgId: org, userId: actor }, () => bio.getNativeArtistBio(org, id(name)));
const review = (name: string, hash: string) => scoped({ orgId: org, userId: actor }, () => bio.reviewNativeArtistBio(org, id(name), actor, { expected_hash: hash }));
describe.skipIf(process.env.NATIVE_ARTIST_BIO_INTEGRATION !== "1")("native biography review against disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_bio_fixture_20261026" || url.search || url.hash) throw new Error("Disposable local native_bio_fixture_20261026 database only");
    sql = postgres(url.toString(), { max: 1 });
    bio = await import("./native-artist-bio");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs(id,name,slug) values(${org},'Biography fixture',${org}),(${foreign},'Foreign fixture',${foreign})`;
    await sql`insert into label_suite."user"(id,name,email,"emailVerified") values(${actor},'Biography fixture',${actor + '@example.invalid'},true)`;
    await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values(${randomUUID()},${org},${actor},'operator')`;
    for (const name of ['rich','legacy','invalid','missing','rollback']) {
      await sql`insert into label_suite.artists(id,org_id,name,bio,bio_document) values(${id(name)},${org},${name},${name === 'missing' ? null : 'Canonical biography'},${name === 'legacy' || name === 'missing' ? null : sql.json(name === 'invalid' ? { type: 'invalid' } : document('Canonical biography'))})`;
    }
    await sql`insert into label_suite.artists(id,org_id,name,bio) values(${id('foreign')},${foreign},'Foreign artist','Private')`;
  });
  afterAll(async () => {
    if (!sql) return;
    for (const table of ['audit_events','artists','org_memberships','audit_logs']) await sql.unsafe(`delete from label_suite.${table} where org_id in ($1,$2)`, [org, foreign]);
    await sql`delete from label_suite.orgs where id in (${org},${foreign})`;
    await sql`delete from label_suite."user" where id=${actor}`;
    await sql.end();
  });
  it("reviews exact rich content atomically once, including concurrent lost-ack retries", async () => {
    const source = await read('rich');
    expect(source).toMatchObject({ document: document('Canonical biography'), reviewable: true, used_fallback: false, state: 'draft' });
    const results = await Promise.all([review('rich', source.hash), review('rich', source.hash)]);
    expect(results).toEqual([expect.objectContaining({ id: id('rich'), hash: source.hash, state: 'reviewed' }), expect.objectContaining({ id: id('rich'), hash: source.hash, state: 'reviewed' })]);
    expect((await read('rich')).document).toEqual(source.document);
    const [saved] = await sql`select bio_document,bio_reviewed_at from label_suite.artists where id=${id('rich')}`;
    await review('rich', source.hash);
    const [retry] = await sql`select bio_document,bio_reviewed_at from label_suite.artists where id=${id('rich')}`;
    expect(retry).toEqual(saved);
    expect((await sql`select count(*)::int as count from label_suite.audit_events where object_id=${id('rich')} and event_type='artist.bio_reviewed'`)[0].count).toBe(1);
  });
  it("rejects changed or malformed source, tenant crossing and changed membership", async () => {
    const source = await read('rich');
    await sql`update label_suite.artists set bio_document=${sql.json(document('Changed biography'))},bio='Changed biography' where id=${id('rich')}`;
    await expect(review('rich', source.hash)).rejects.toMatchObject({ status: 409 });
    await expect(read('foreign')).rejects.toMatchObject({ status: 404 });
    await expect(review('foreign', source.hash)).rejects.toMatchObject({ status: 404 });
    expect((await read('invalid')).used_fallback).toBe(true);
    for (const name of ['invalid','missing']) await expect(review(name, (await read(name)).hash)).rejects.toMatchObject({ status: 409 });
    await sql`update label_suite.org_memberships set role='member' where org_id=${org}`;
    await expect(review('rich', source.hash)).rejects.toMatchObject({ status: 403 });
    await sql`delete from label_suite.org_memberships where org_id=${org}`;
    await expect(review('rich', source.hash)).rejects.toMatchObject({ status: 403, code: 'workspace_access_removed' });
    await sql`insert into label_suite.org_memberships(id,org_id,user_id,role) values(${randomUUID()},${org},${actor},'operator')`;
  });
  it("normalizes a legacy plain biography using the same canonical review function", async () => {
    const source = await read('legacy');
    await review('legacy', source.hash);
    expect(await read('legacy')).toMatchObject({ hash: source.hash, state: 'reviewed', document: source.document });
  });
  it("rolls review back when its audit cannot commit", async () => {
    const source = await read('rollback');
    audit.fail = true;
    try { await expect(review('rollback', source.hash)).rejects.toThrow('Disposable audit failure'); }
    finally { audit.fail = false; }
    expect(await read('rollback')).toEqual(source);
    expect((await sql`select count(*)::int as count from label_suite.audit_events where object_id=${id('rollback')}`)[0].count).toBe(0);
  });
});
