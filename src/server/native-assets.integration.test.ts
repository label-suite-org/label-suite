import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const signing = vi.hoisted(() => ({ sign: vi.fn(async () => "https://private.example.test/short-lived"), head: vi.fn(async () => ({})) }));
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: signing.sign }));
vi.mock("./storage", async (original) => ({ ...await original<typeof import("./storage")>(), getStorageClient: () => ({ send: signing.head }) }));
const actor = `asset-user-${randomUUID()}`;
const org = `asset-${randomUUID()}`, other = `asset-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let service: typeof import("./native-assets");
describe.skipIf(process.env.NATIVE_ASSETS_INTEGRATION !== "1")("native private resources", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_assets_fixture" || url.search || url.hash) throw new Error("Disposable native_assets_fixture only");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./native-assets");
    vi.stubEnv("R2_ASSETS_PRIVATE_BUCKET", "fixture-private");
    vi.stubEnv("R2_BUCKET", "fixture-public");
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Asset fixture',${org}),(${other},'Other fixture',${other})`;
    await sql`insert into label_suite."user" (id,name,email,"emailVerified") values (${actor},'Fixture',${actor + "@example.test"},true)`;
    await sql`insert into label_suite.releases (id,org_id,title) values ('asset-release',${org},'Release'),('asset-foreign-release',${other},'Private release')`;
    await sql`insert into label_suite.media_assets (id,org_id,asset_name,file_link) values ('native-asset',${org},'Artwork','https://public.example.test/should-not-leak')`;
    await sql`insert into label_suite.documents (id,org_id,name,file_link) values ('native-document',${org},'Agreement','https://external.example.test/private')`;
    await sql`insert into label_suite.media_asset_files (id,org_id,media_asset_id,source_postgres_table,source_postgres_record_id,file_name,storage_bucket,storage_key) values
      ('asset-private',${org},'native-asset','media_assets','native-asset','art.png','fixture-private',${org + '/private/art.png'}),
      ('asset-public',${org},'native-asset','media_assets','native-asset','public.png','fixture-public',${org + '/public.png'}),
      ('asset-foreign-key',${org},'native-asset','media_assets','native-asset','invalid.png','fixture-private',${other + '/private.png'}),
      ('document-private',${org},null,'documents','native-document','agreement.pdf','fixture-private',${org + '/agreement.pdf'}),
      ('asset-other',${other},'native-asset','media_assets','native-asset','foreign.png','fixture-private',${other + '/foreign.png'})`;
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!sql) return;
    for (const table of ["resource_upload_intents", "audit_events", "media_asset_files", "media_assets", "documents", "releases", "audit_logs"]) await sql.unsafe(`delete from label_suite.${table} where org_id in ($1,$2)`, [org, other]);
    await sql`delete from label_suite.orgs where id in (${org},${other})`;
    await sql`delete from label_suite."user" where id=${actor}`;
    await sql.end();
  });
  it("keeps canonical lists and file metadata scoped and omits storage/source URLs", async () => {
    expect((await service.listNativeResources(org, "assets", "ART", null)).items).toHaveLength(1);
    expect((await service.listNativeResources(other, "assets", null, null)).items).toEqual([]);
    const detail = await service.getNativeResource(org, "assets", "native-asset");
    expect(detail.files.map(file => file.id)).not.toContain("asset-other");
    for (const file of detail.files) expect(file).toMatchObject({ provenance: null, sha256: null, capture_method: null, uploader: null });
    expect(detail.files.find(file => file.id === "asset-public")?.preview_available).toBe(false);
    expect(detail.files.find(file => file.id === "asset-foreign-key")?.preview_available).toBe(false);
    expect(JSON.stringify(detail)).not.toMatch(/storage_key|storage_bucket|https:\/\//);
    await expect(service.getNativeResource(other, "assets", "native-asset")).rejects.toMatchObject({ status: 404 });
  });
  it("does not join another workspace's upload provenance even when the object and resource match", async () => {
    const intent = randomUUID();
    await sql`insert into label_suite.resource_upload_intents (id,org_id,actor_user_id,client_request_id,request,storage_bucket,storage_key,status,resource_id)
      values (${intent},${other},${actor},${randomUUID()},${sql.json({ kind: "assets", provenance: "Foreign private source", sha256: "foreign", capture_method: "camera" })},'fixture-private',${org + '/private/art.png'},'completed','native-asset')`;
    try {
      const detail = await service.getNativeResource(org, "assets", "native-asset");
      expect(detail.files.find(file => file.id === "asset-private")).toMatchObject({ provenance: null, sha256: null, capture_method: null, uploader: null });
      expect(JSON.stringify(detail)).not.toContain("Foreign private source");
    } finally { await sql`delete from label_suite.resource_upload_intents where id=${intent}`; }
  });
  it("signs only a privately stored file on the authorized canonical record", async () => {
    const result = await service.nativeResourceDownload(org, "documents", "native-document", "document-private");
    expect(result.name).toBe("agreement.pdf");
    expect(signing.sign).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ input: expect.objectContaining({ Bucket: "fixture-private", Key: org + "/agreement.pdf", ResponseCacheControl: "private, no-store" }) }), { expiresIn: 60 });
    signing.sign.mockClear();
    for (const file of ["asset-public", "asset-foreign-key"]) await expect(service.nativeResourceDownload(org, "assets", "native-asset", file)).rejects.toMatchObject({ status: 409 });
    await expect(service.nativeResourceDownload(org, "assets", "native-asset", "document-private")).rejects.toMatchObject({ status: 404 });
    await expect(service.nativeResourceDownload(other, "assets", "native-asset", "asset-private")).rejects.toMatchObject({ status: 404 });
    expect(signing.sign).not.toHaveBeenCalled();
  });
  it("reports missing stored objects without issuing signed access", async () => {
    signing.sign.mockClear();
    signing.head.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    await expect(service.nativeResourceDownload(org, "documents", "native-document", "document-private")).rejects.toMatchObject({ status: 404 });
    expect(signing.sign).not.toHaveBeenCalled();
  });
  it.each(["assets", "documents"] as const)("%s links and unlinks only the named context with exact revision and audit, preserving files", async (kind) => {
    const id = kind === "assets" ? "native-asset" : "native-document";
    const before = await service.getNativeResource(org, kind, id);
    const command = { action: "link", context: { kind: "release", id: "asset-release" }, expected_revision: before.record.revision };
    const linked = await service.changeNativeResourceContext(org, kind, id, command, actor);
    expect(linked.contexts).toContainEqual({ kind: "release", id: "asset-release", name: "Release" });
    expect((await service.listNativeResources(org, kind, null, null, command.context)).items).toHaveLength(1);
    await expect(service.changeNativeResourceContext(org, kind, id, command, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service.changeNativeResourceContext(org, kind, id, { ...command, expected_revision: linked.record.revision, context: { kind: "release", id: "asset-foreign-release" } }, actor)).rejects.toMatchObject({ status: 404 });
    const unlinked = await service.changeNativeResourceContext(org, kind, id, { ...command, action: "unlink", expected_revision: linked.record.revision }, actor);
    expect(unlinked.contexts).toEqual([]);
    expect(unlinked.files).toEqual(before.files);
    const audits = await sql`select event_type from label_suite.audit_events where org_id=${org} and object_id=${id} order by created_at`;
    expect(audits.map(row => row.event_type)).toEqual(["resource.linked", "resource.unlinked"]);
    const [record] = await sql`select status from label_suite.documents where id='native-document'`;
    expect(record.status).toBe("draft");
  });
  it("rolls back the context and revision when audit persistence fails", async () => {
    const before = await service.getNativeResource(org, "documents", "native-document");
    await expect(service.changeNativeResourceContext(org, "documents", "native-document", {
      action: "link", context: { kind: "release", id: "asset-release" }, expected_revision: before.record.revision,
    }, "nonexistent-audit-actor")).rejects.toThrow();
    const after = await service.getNativeResource(org, "documents", "native-document");
    expect(after.record.revision).toBe(before.record.revision);
    expect(after.contexts).toEqual(before.contexts);
    expect(after.files).toEqual(before.files);
  });
  it("fails closed without distinct private storage", () => {
    expect(() => service.nativePrivateAssetBucket({})).toThrow("unavailable");
    expect(() => service.nativePrivateAssetBucket({ R2_BUCKET: "public", R2_ASSETS_PRIVATE_BUCKET: "public" })).toThrow("unavailable");
  });
});
