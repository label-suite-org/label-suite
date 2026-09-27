import "dotenv/config";
import { createHash } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Pool, type PoolClient } from "pg";

const DEFAULT_BASE_ID = "appoKM3ylTDhR60LY";
const SCHEMA = process.env.AIRTABLE_IMPORT_DB_SCHEMA ?? "label_suite";
const PAGE_SIZE = 100;

type AirtableFields = Record<string, unknown>;

interface AirtableRecord {
  id: string;
  fields: AirtableFields;
}

interface Attachment {
  id: string;
  url: string;
  filename: string;
  type?: string;
  size?: number;
}

interface CopyCandidate {
  airtableTable: string;
  airtableRecordId: string;
  airtableFieldName: string;
  postgresTable: string | null;
  postgresRecordId: string | null;
  mediaAssetId: string | null;
  attachment: Attachment;
  storageKey: string;
}

interface CopyPlan {
  fetched: number;
  candidates: number;
  existing: number;
  backfillable: number;
  missingSourceRows: number;
  uploadable: CopyCandidate[];
  uploaded: number;
  backfilled: number;
  errors: string[];
}

interface CopiedAttachmentStatus {
  exists: boolean;
  needsSourceBackfill: boolean;
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run airtable:copy-assets -- [options]

Copies Airtable attachment binaries into the configured R2 bucket.

Safety:
  - Dry-run is the default.
  - Airtable calls are GET-only.
  - R2 uploads happen only with --apply.
  - Postgres writes happen only with --apply after each upload.
  - No Airtable writes, R2 deletes, or product-row updates are performed.

Options:
  --apply              Upload missing attachments to R2 and record copied files
  --org <org-id>       Target org; defaults to AIRTABLE_IMPORT_ORG_ID or true-nature
  --max-records <n>    Cap Airtable records fetched per table

Environment:
  DATABASE_URL          Postgres connection string
  AIRTABLE_API_KEY      Airtable personal access token
  AIRTABLE_BASE_ID      Optional; defaults to ${DEFAULT_BASE_ID}
  R2_ACCOUNT_ID/R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
`);
  process.exit(0);
}

const token =
  process.env.AIRTABLE_API_KEY ??
  process.env.AIRTABLE_PAT ??
  process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID;
const orgId = readOption("--org") ?? process.env.AIRTABLE_IMPORT_ORG_ID ?? "true-nature";
const databaseUrl = process.env.DATABASE_URL;
const apply = args.includes("--apply");
const maxRecords = numberOption("--max-records");
let pool: Pool;
let r2Client: S3Client;

const ATTACHMENT_SOURCES = [
  {
    airtableTable: "Releases (And Artist Events)",
    postgresTable: "releases",
    fields: ["Cover Art"],
  },
  {
    airtableTable: "Media Assets",
    postgresTable: "media_assets",
    fields: ["File Link", "Find Web Image (Reference only)"],
  },
];

async function main() {
  if (!databaseUrl) fail("DATABASE_URL is required.");
  if (!token) fail("AIRTABLE_API_KEY, AIRTABLE_PAT, or AIRTABLE_TOKEN is required.");

  const bucket = requireEnv("R2_BUCKET");
  pool = new Pool({ connectionString: databaseUrl });
  r2Client = createR2Client();

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Airtable base: ${baseId}`);
  console.log(`Postgres schema: ${SCHEMA}`);
  console.log(`Target org: ${orgId}`);
  console.log(`R2 bucket: ${bucket}`);
  console.log("");

  try {
    if (apply && !(await orgExists(orgId))) {
      fail(`Org '${orgId}' is missing.`);
    }

    const client = await pool.connect();
    try {
      const plans: CopyPlan[] = [];
      for (const source of ATTACHMENT_SOURCES) {
        const plan = await processSource(client, source, bucket);
        plans.push(plan);
        printPlan(source.airtableTable, plan);
      }
      printSummary(plans);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function processSource(
  client: PoolClient,
  source: (typeof ATTACHMENT_SOURCES)[number],
  bucket: string,
): Promise<CopyPlan> {
  const records = await readAirtableRecords(source.airtableTable);
  let candidates = 0;
  let existing = 0;
  let backfillable = 0;
  let missingSourceRows = 0;
  let uploaded = 0;
  let backfilled = 0;
  const uploadable: CopyCandidate[] = [];
  const errors: string[] = [];

  for (const record of records) {
    const postgresRecordId = await mappedPostgresRecordId(client, source.airtableTable, record.id, source.postgresTable);
    if (!postgresRecordId) {
      if (attachmentCount(record, source.fields) > 0) missingSourceRows++;
    }

    for (const field of source.fields) {
      for (const attachment of attachments(record.fields[field])) {
        candidates++;
        const candidate: CopyCandidate = {
          airtableTable: source.airtableTable,
          airtableRecordId: record.id,
          airtableFieldName: field,
          postgresTable: postgresRecordId ? source.postgresTable : null,
          postgresRecordId,
          mediaAssetId: source.postgresTable === "media_assets" && postgresRecordId ? postgresRecordId : null,
          attachment,
          storageKey: storageKeyFor(source.airtableTable, record.id, field, attachment),
        };

        const existingCopy = await copiedAttachmentStatus(client, candidate, bucket);
        if (existingCopy.exists) {
          existing++;
          if (existingCopy.needsSourceBackfill) {
            backfillable++;
            if (apply && await backfillCopiedFileSource(client, candidate, bucket)) {
              backfilled++;
            }
          }
          continue;
        }

        uploadable.push(candidate);
        if (apply) {
          try {
            const etag = await uploadAttachment(candidate, bucket);
            await insertCopiedFile(client, candidate, bucket, etag);
            uploaded++;
          } catch (error) {
            errors.push(`${record.id}/${attachment.id}: ${errorMessage(error)}`);
          }
        }
      }
    }
  }

  return {
    fetched: records.length,
    candidates,
    existing,
    backfillable,
    missingSourceRows,
    uploadable,
    uploaded,
    backfilled,
    errors,
  };
}

async function uploadAttachment(candidate: CopyCandidate, bucket: string): Promise<string | null> {
  if (!(await objectExists(bucket, candidate.storageKey))) {
    const response = await fetch(candidate.attachment.url, { method: "GET" });
    if (!response.ok) {
      throw new Error(`download failed ${response.status} ${response.statusText}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    const uploaded = await r2Client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: candidate.storageKey,
      Body: body,
      ContentType: candidate.attachment.type,
      Metadata: {
        org_id: orgId,
        airtable_base_id: baseId,
        airtable_table: safeMetadata(candidate.airtableTable),
        airtable_record_id: candidate.airtableRecordId,
        airtable_attachment_id: candidate.attachment.id,
      },
    }));

    return uploaded.ETag ?? null;
  }

  const head = await r2Client.send(new HeadObjectCommand({
    Bucket: bucket,
    Key: candidate.storageKey,
  }));
  return head.ETag ?? null;
}

async function insertCopiedFile(
  client: PoolClient,
  candidate: CopyCandidate,
  bucket: string,
  etag: string | null,
): Promise<void> {
  await client.query(
    `
      insert into ${qname("media_asset_files")} (
        id,
        org_id,
        media_asset_id,
        source_postgres_table,
        source_postgres_record_id,
        airtable_base_id,
        airtable_table_name,
        airtable_record_id,
        airtable_field_name,
        airtable_attachment_id,
        file_name,
        content_type,
        file_size,
        source_url,
        storage_bucket,
        storage_key,
        storage_etag,
        copied_at,
        created_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, now(), now())
      on conflict do nothing
    `,
    [
      copiedFileId(candidate),
      orgId,
      candidate.mediaAssetId,
      candidate.postgresTable,
      candidate.postgresRecordId,
      baseId,
      candidate.airtableTable,
      candidate.airtableRecordId,
      candidate.airtableFieldName,
      candidate.attachment.id,
      candidate.attachment.filename,
      candidate.attachment.type ?? null,
      candidate.attachment.size ?? null,
      candidate.attachment.url,
      bucket,
      candidate.storageKey,
      etag,
    ],
  );
}

async function backfillCopiedFileSource(
  client: PoolClient,
  candidate: CopyCandidate,
  bucket: string,
): Promise<boolean> {
  const result = await client.query(
    `
      update ${qname("media_asset_files")}
      set
        source_postgres_table = coalesce(source_postgres_table, $7),
        source_postgres_record_id = coalesce(source_postgres_record_id, $8),
        media_asset_id = coalesce(media_asset_id, $9)
      where org_id = $1
        and airtable_base_id = $2
        and airtable_table_name = $3
        and airtable_record_id = $4
        and airtable_attachment_id = $5
        and storage_bucket = $6
        and (
          source_postgres_table is null
          or source_postgres_record_id is null
          or media_asset_id is null
        )
    `,
    [
      orgId,
      baseId,
      candidate.airtableTable,
      candidate.airtableRecordId,
      candidate.attachment.id,
      bucket,
      candidate.postgresTable,
      candidate.postgresRecordId,
      candidate.mediaAssetId,
    ],
  );
  return Boolean(result.rowCount);
}

async function readAirtableRecords(tableName: string): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  const limit = maxRecords ?? Number.POSITIVE_INFINITY;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
    );
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);

    const data = await airtableJson(url.toString());
    const page = Array.isArray(data.records) ? data.records : [];
    records.push(...page);
    offset = typeof data.offset === "string" ? data.offset : undefined;
    await sleep(225);
  } while (offset && records.length < limit);

  if (records.length > limit) records.length = limit;
  return records;
}

async function airtableJson(url: string): Promise<any> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok) return response.json();
  throw new Error(`Airtable ${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`);
}

async function mappedPostgresRecordId(
  client: PoolClient,
  airtableTable: string,
  airtableRecordId: string,
  postgresTable: string,
): Promise<string | null> {
  const result = await client.query(
    `
      select postgres_record_id
      from ${qname("airtable_record_mappings")}
      where org_id = $1
        and airtable_base_id = $2
        and airtable_table_name = $3
        and airtable_record_id = $4
        and postgres_table_name = $5
      limit 1
    `,
    [orgId, baseId, airtableTable, airtableRecordId, postgresTable],
  );
  return result.rows[0]?.postgres_record_id ?? null;
}

async function copiedAttachmentStatus(
  client: PoolClient,
  candidate: CopyCandidate,
  bucket: string,
): Promise<CopiedAttachmentStatus> {
  const result = await client.query(
    `
      select source_postgres_table, source_postgres_record_id, media_asset_id
      from ${qname("media_asset_files")}
      where org_id = $1
        and airtable_base_id = $2
        and airtable_table_name = $3
        and airtable_record_id = $4
        and airtable_attachment_id = $5
        and storage_bucket = $6
      limit 1
    `,
    [
      orgId,
      baseId,
      candidate.airtableTable,
      candidate.airtableRecordId,
      candidate.attachment.id,
      bucket,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    return { exists: false, needsSourceBackfill: false };
  }

  const needsSourceBackfill = Boolean(
    candidate.postgresTable &&
      candidate.postgresRecordId &&
      (!row.source_postgres_table ||
        !row.source_postgres_record_id ||
        (candidate.mediaAssetId && !row.media_asset_id)),
  );

  return { exists: true, needsSourceBackfill };
}

async function objectExists(bucket: string, key: string): Promise<boolean> {
  try {
    await r2Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error: any) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

async function orgExists(id: string): Promise<boolean> {
  const result = await pool.query(`select 1 from ${qname("orgs")} where id = $1 limit 1`, [id]);
  return Boolean(result.rowCount);
}

function attachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .filter((item) => typeof item.id === "string" && typeof item.url === "string" && typeof item.filename === "string")
    .map((item) => ({
      id: String(item.id),
      url: String(item.url),
      filename: String(item.filename),
      type: typeof item.type === "string" ? item.type : undefined,
      size: typeof item.size === "number" ? item.size : undefined,
    }));
}

function attachmentCount(record: AirtableRecord, fields: string[]): number {
  return fields.reduce((count, field) => count + attachments(record.fields[field]).length, 0);
}

function copiedFileId(candidate: CopyCandidate): string {
  return createHash("sha256")
    .update(`${orgId}:${baseId}:${candidate.airtableTable}:${candidate.airtableRecordId}:${candidate.attachment.id}`)
    .digest("hex");
}

function storageKeyFor(
  table: string,
  recordId: string,
  field: string,
  attachment: Attachment,
): string {
  const fileName = sanitizePathSegment(attachment.filename);
  const tablePart = sanitizePathSegment(table);
  const fieldPart = sanitizePathSegment(field);
  const attachmentPart = sanitizePathSegment(attachment.id);
  return `${orgId}/airtable-assets/${tablePart}/${recordId}/${fieldPart}/${attachmentPart}-${fileName}`;
}

function createR2Client(): S3Client {
  const endpoint = process.env.R2_ENDPOINT ?? `https://${requireEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: "auto",
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
}

function printPlan(tableName: string, plan: CopyPlan) {
  const action = apply ? `uploaded ${plan.uploaded}` : `would upload ${plan.uploadable.length}`;
  const backfill = apply ? `backfilled ${plan.backfilled}` : `would backfill ${plan.backfillable}`;
  console.log(
    `${tableName}: fetched ${plan.fetched}, attachments ${plan.candidates}, existing ${plan.existing}, missing source rows ${plan.missingSourceRows}, ${action}, ${backfill}`,
  );
  for (const error of plan.errors.slice(0, 5)) {
    console.log(`  error: ${error}`);
  }
  if (plan.errors.length > 5) console.log(`  ...${plan.errors.length - 5} more errors`);
}

function printSummary(plans: CopyPlan[]) {
  const fetched = plans.reduce((sum, plan) => sum + plan.fetched, 0);
  const attachmentsTotal = plans.reduce((sum, plan) => sum + plan.candidates, 0);
  const existing = plans.reduce((sum, plan) => sum + plan.existing, 0);
  const uploadable = plans.reduce((sum, plan) => sum + plan.uploadable.length, 0);
  const uploaded = plans.reduce((sum, plan) => sum + plan.uploaded, 0);
  const backfillable = plans.reduce((sum, plan) => sum + plan.backfillable, 0);
  const backfilled = plans.reduce((sum, plan) => sum + plan.backfilled, 0);
  const errors = plans.reduce((sum, plan) => sum + plan.errors.length, 0);

  console.log("");
  console.log("Summary:");
  console.log(`  Airtable records fetched: ${fetched}`);
  console.log(`  Attachments discovered: ${attachmentsTotal}`);
  console.log(`  Existing copied files: ${existing}`);
  console.log(`  Missing files planned: ${uploadable}`);
  console.log(`  Existing files needing source backfill: ${backfillable}`);
  if (apply) {
    console.log(`  Files uploaded: ${uploaded}`);
    console.log(`  Existing files backfilled: ${backfilled}`);
  }
  console.log(`  Errors: ${errors}`);
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  const value = args.find((arg) => arg.startsWith(prefix));
  return value?.slice(prefix.length);
}

function numberOption(name: string): number | undefined {
  const value = readOption(name);
  if (!value) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail(`${name} must be a positive number.`);
  return n;
}

function qname(table: string): string {
  return `${quoteIdent(SCHEMA)}.${quoteIdent(table)}`;
}

function quoteIdent(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "file";
}

function safeMetadata(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").slice(0, 256);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`${name} is required.`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await main();
