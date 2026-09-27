import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ objects: new Map<string, { size: number; type: string; sha256: string }>(),
  afterPut: undefined as undefined | (() => Promise<void>), mismatch: false, missingHead: false, failAudit: false }));
vi.mock("./storage", async (original) => ({ ...await original<typeof import("./storage")>(), getStorageClient: () => ({ send: async (command: { constructor: { name: string }; input: any }) => {
  const input = command.input;
  if (input.Bucket !== "upload-private") throw new Error("Public storage access forbidden in fixture");
  if (command.constructor.name === "PutObjectCommand") {
    expect(input.IfNoneMatch).toBe("*");
    if (storage.objects.has(input.Key)) throw { $metadata: { httpStatusCode: 412 } };
    storage.objects.set(input.Key, { size: input.Body.length, type: input.ContentType, sha256: input.Metadata.sha256 });
    await storage.afterPut?.();
    return {};
  }
  const object = storage.objects.get(input.Key);
  if (!object || storage.missingHead) throw { $metadata: { httpStatusCode: 404 } };
  return { ContentLength: object.size, ContentType: object.type, Metadata: { sha256: storage.mismatch ? "wrong" : object.sha256 } };
} }) }));
vi.mock("./integrations", async (original) => {
  const actual = await original<typeof import("./integrations")>();
  return { ...actual, recordAuditEvent: async (...args: Parameters<typeof actual.recordAuditEvent>) => {
    if (storage.failAudit) throw new Error("Fixture audit unavailable");
    return actual.recordAuditEvent(...args);
  } };
});
const org = `upload-${randomUUID()}`, actor = `upload-user-${randomUUID()}`, otherActor = `upload-user-${randomUUID()}`;
const bytes = Buffer.from("%PDF-1.7\nfixture content\n%%EOF");
let sql: ReturnType<typeof postgres>;
let service: typeof import("./native-resource-uploads");
let scoped: typeof import("../lib/db").runWithDatabaseContext;
const prepare = (...args: Parameters<typeof service.prepareResourceUpload>) => scoped({ orgId: args[0], userId: args[1] }, () => service.prepareResourceUpload(...args));
const complete = (...args: Parameters<typeof service.completeResourceUpload>) => scoped({ orgId: args[0], userId: args[1] }, () => service.completeResourceUpload(...args));
const status = (...args: Parameters<typeof service.getResourceUpload>) => scoped({ orgId: args[0], userId: args[1] }, () => service.getResourceUpload(...args));
const request = () => ({ client_request_id: randomUUID(), kind: "documents", name: "Captured agreement", context: { kind: "release", id: "upload-release" },
  provenance: "Fixture original supplied by the artist", capture_method: "scan", file_name: "agreement.pdf", content_type: "application/pdf", size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex") });
describe.skipIf(process.env.NATIVE_ASSETS_INTEGRATION !== "1")("recoverable native resource uploads", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_assets_fixture" || url.search || url.hash) throw new Error("Disposable native_assets_fixture only");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./native-resource-uploads");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    vi.stubEnv("R2_ASSETS_PRIVATE_BUCKET", "upload-private"); vi.stubEnv("R2_BUCKET", "upload-public");
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Upload fixture',${org})`;
    for (const id of [actor, otherActor]) {
      await sql`insert into label_suite."user" (id,name,email,"emailVerified") values (${id},${id === actor ? 'Uploader fixture' : 'Other operator'},${id + '@example.test'},true)`;
      await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${randomUUID()},${org},${id},'operator')`;
    }
    await sql`insert into label_suite.grant_applications (id,org_id) values ('upload-grant-application',${org})`;
    await sql`insert into label_suite.releases (id,org_id,title) values ('upload-release',${org},'Release')`;
  });
  beforeEach(() => { storage.afterPut = undefined; storage.mismatch = false; storage.missingHead = false; storage.failAudit = false; });
  afterAll(async () => {
    vi.unstubAllEnvs();
    if (!sql) return;
    for (const table of ["resource_upload_intents", "audit_events", "media_asset_files", "grant_application_documents", "grant_applications", "documents", "media_assets", "releases", "org_memberships", "audit_logs"]) await sql.unsafe(`delete from label_suite.${table} where org_id=$1`, [org]);
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql`delete from label_suite."user" where id in (${actor},${otherActor})`;
    await sql.end();
  });
  it("prepares idempotently and rejects changed metadata and actor/tenant replay", async () => {
    const input = request();
    const prepared = await prepare(org, actor, input);
    expect(await prepare(org, actor, input)).toEqual(prepared);
    await expect(prepare(org, actor, { ...input, name: "Different record" })).rejects.toMatchObject({ status: 409 });
    await expect(status(org, otherActor, prepared.id)).rejects.toMatchObject({ status: 404 });
    await expect(status("foreign-org", actor, prepared.id)).rejects.toMatchObject({ status: 403 });
    expect(JSON.stringify(prepared)).not.toMatch(/storage_key|storage_bucket/);
  });
  it.each(["assets", "documents"])("concurrent %s completion creates one canonical record, attachment and audit", async (kind) => {
    const input = { ...request(), kind };
    const prepared = await prepare(org, actor, input);
    const results = await Promise.all([complete(org, actor, prepared.id, bytes), complete(org, actor, prepared.id, bytes)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].status).toBe("completed");
    const id = results[0].resource_id!;
    const records = await sql.unsafe(`select file_link from label_suite.${kind === 'assets' ? 'media_assets' : 'documents'} where id=$1`, [id]);
    expect(records).toEqual([{ file_link: null }]);
    const [files] = await sql`select count(*)::int as count from label_suite.media_asset_files where org_id=${org} and source_postgres_record_id=${id}`;
    const [audit] = await sql`select count(*)::int as count from label_suite.audit_events where org_id=${org} and object_id=${id}`;
    expect(files.count).toBe(1); expect(audit.count).toBe(1);
    expect((await status(org, actor, prepared.id)).resource_id).toBe(id);
    const { getNativeResource } = await import("./native-assets");
    const detail = await scoped({ orgId: org, userId: actor }, () => getNativeResource(org, kind as "assets" | "documents", id));
    expect(detail.files[0]).toMatchObject({ provenance: input.provenance, sha256: input.sha256, capture_method: "scan", uploader: "Uploader fixture" });
    expect(JSON.stringify(detail)).not.toMatch(/storage_key|storage_bucket|@example/);
  });
  it("captures projectless Grant evidence atomically and limits fundraiser uploads to Grant applications", async () => {
    const input = { ...request(), context: { kind: "grant_application", id: "upload-grant-application" } };
    const ordinary = await prepare(org, actor, request());
    await sql`update label_suite.org_memberships set role='fundraiser' where org_id=${org} and user_id=${actor}`;
    try {
      await expect(prepare(org, actor, request())).rejects.toMatchObject({ status: 403 });
      await expect(complete(org, actor, ordinary.id, bytes)).rejects.toMatchObject({ status: 403 });
      await expect(status(org, actor, ordinary.id)).rejects.toMatchObject({ status: 403 });
      await expect(prepare(org, actor, { ...input, kind: "assets" })).rejects.toThrow();
      await expect(prepare(org, actor, { ...input, context: { ...input.context, id: "foreign-application" } })).rejects.toMatchObject({ status: 404 });
      const prepared = await prepare(org, actor, input);
      storage.failAudit = true;
      await expect(complete(org, actor, prepared.id, bytes)).rejects.toThrow("Fixture audit unavailable");
      expect(await sql`select id from label_suite.grant_application_documents where org_id=${org}`).toHaveLength(0);
      storage.failAudit = false;
      const result = await complete(org, actor, prepared.id, bytes);
      expect(await complete(org, actor, prepared.id, bytes)).toEqual(result);
      expect(await sql`select application_id,document_id,readiness_status from label_suite.grant_application_documents where org_id=${org}`)
        .toEqual([{ application_id: input.context.id, document_id: result.resource_id, readiness_status: "draft" }]);
      expect(await sql`select project_id,file_link from label_suite.documents where id=${result.resource_id!}`).toEqual([{ project_id: null, file_link: null }]);
    } finally {
      storage.failAudit = false;
      await sql`update label_suite.org_memberships set role='operator' where org_id=${org} and user_id=${actor}`;
    }
  });
  it("rejects changed bytes and mismatched stored metadata without finalizing", async () => {
    const prepared = await prepare(org, actor, request());
    await expect(complete(org, actor, prepared.id, Buffer.from("different"))).rejects.toMatchObject({ status: 409 });
    storage.mismatch = true;
    await expect(complete(org, actor, prepared.id, bytes)).rejects.toMatchObject({ status: 409 });
    expect((await status(org, actor, prepared.id)).status).toBe("prepared");
  });
  it("keeps missing stored objects recoverable and rejects invalid capture metadata", async () => {
    const prepared = await prepare(org, actor, request());
    storage.missingHead = true;
    await expect(complete(org, actor, prepared.id, bytes)).rejects.toMatchObject({ status: 409 });
    expect((await status(org, actor, prepared.id)).status).toBe("prepared");
    for (const invalid of [{ size: 26 * 1024 * 1024 }, { provenance: "" }, { capture_method: "camera" }, { file_name: "../private.pdf" }]) {
      await expect(prepare(org, actor, { ...request(), ...invalid })).rejects.toThrow();
    }
  });
  it("recovers a stored private object after database rollback without duplicating completion", async () => {
    const prepared = await prepare(org, actor, request());
    storage.failAudit = true;
    await expect(complete(org, actor, prepared.id, bytes)).rejects.toThrow("Fixture audit unavailable");
    expect((await status(org, actor, prepared.id)).status).toBe("prepared");
    const objectCount = storage.objects.size;
    storage.failAudit = false;
    const completed = await complete(org, actor, prepared.id, bytes);
    expect(completed.status).toBe("completed"); expect(storage.objects.size).toBe(objectCount);
  });
  it("rechecks capability after storage and keeps the upload recoverable when access changes", async () => {
    const prepared = await prepare(org, actor, request());
    storage.afterPut = async () => { await sql`update label_suite.org_memberships set role='member' where org_id=${org} and user_id=${actor}`; };
    try {
      await expect(complete(org, actor, prepared.id, bytes)).rejects.toMatchObject({ status: 403 });
      const [row] = await sql`select status from label_suite.resource_upload_intents where id=${prepared.id}`;
      expect(row.status).toBe("prepared");
    } finally {
      storage.afterPut = undefined;
      await sql`update label_suite.org_memberships set role='operator' where org_id=${org} and user_id=${actor}`;
    }
    expect((await complete(org, actor, prepared.id, bytes)).status).toBe("completed");
  });
});
