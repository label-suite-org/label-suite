import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";

if (process.argv.includes("--grants-v2")) {
  const { runGrantsV2ImportCli } = await import("./airtable-grants-v2");
  await runGrantsV2ImportCli();
  process.exit(0);
}

const DEFAULT_BASE_ID = "appoKM3ylTDhR60LY";
const SCHEMA = process.env.AIRTABLE_IMPORT_DB_SCHEMA ?? "label_suite";
const PAGE_SIZE = 100;

type FieldMap = Record<string, unknown>;

interface AirtableRecord {
  id: string;
  fields: FieldMap;
}

interface ImportContext {
  mappingBySource: Map<string, string>;
  workByTrackSource: Map<string, string>;
  fallbackToAirtableIds: boolean;
}

interface UniqueCheck {
  label: string;
  columns: string[];
}

interface ImportSpec {
  key: string;
  airtableTable: string;
  postgresTable: string;
  description: string;
  defaultEnabled: boolean;
  uniqueChecks?: UniqueCheck[];
  map(record: AirtableRecord, context: ImportContext): FieldMap | null;
}

interface TablePlan {
  spec: ImportSpec;
  fetched: number;
  mappable: number;
  existing: number;
  insertable: number;
  skipped: number;
  blocked: string[];
  inserted: number;
  errors: string[];
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run airtable:import -- [options]

Reads Airtable and plans/imports mapped records into Postgres.

Safety:
  - Dry-run is the default.
  - Airtable calls are GET-only.
  - Postgres writes happen only with --apply.
  - --apply only INSERTs missing product rows and mapping rows.
  - No deletes, truncates, or product-row updates are performed.

Options:
  --grants-v2          Build the Grants V2 dry-run plan (database writes disabled)
  --snapshot <path>    With --grants-v2, read a saved JSON snapshot instead of the API
  --existing-plan <p>  Classify a repeat Grants V2 plan as unchanged/update
  --apply              Write the planned inserts in one transaction
  --tables <list>      Comma-separated importer keys, e.g. contacts,artists,releases
  --include-optional   Include optional/noisy domains such as Airtable Bugs
  --max-records <n>    Cap Airtable records fetched per table for test runs
  --list-tables        List supported importer keys

Environment:
  DATABASE_URL          Postgres connection string
  AIRTABLE_API_KEY      Airtable personal access token
  AIRTABLE_BASE_ID      Optional; defaults to ${DEFAULT_BASE_ID}
`);
  process.exit(0);
}

const token =
  process.env.AIRTABLE_API_KEY ??
  process.env.AIRTABLE_PAT ??
  process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID;
const importOrgId = process.env.AIRTABLE_IMPORT_ORG_ID ?? "true-nature";
const databaseUrl = process.env.DATABASE_URL;
const apply = args.includes("--apply");
const includeOptional = args.includes("--include-optional");
const maxRecords = numberOption("--max-records");
const selectedTables = readOption("--tables")
  ?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
let pool: Pool;

async function main() {
  if (args.includes("--list-tables")) {
    for (const spec of IMPORT_SPECS) {
      const marker = spec.defaultEnabled ? "default" : "optional";
      console.log(`${spec.key.padEnd(18)} ${marker.padEnd(8)} ${spec.airtableTable} -> ${spec.postgresTable}`);
    }
    return;
  }

  if (!databaseUrl) fail("DATABASE_URL is required.");
  if (!token) fail("AIRTABLE_API_KEY, AIRTABLE_PAT, or AIRTABLE_TOKEN is required.");

  const selectedSpecs = IMPORT_SPECS.filter((spec) => {
    if (selectedTables?.length) return selectedTables.includes(spec.key);
    return spec.defaultEnabled || includeOptional;
  });

  const unknownTables = (selectedTables ?? []).filter(
    (key) => !IMPORT_SPECS.some((spec) => spec.key === key),
  );
  if (unknownTables.length) {
    fail(`Unknown importer table key(s): ${unknownTables.join(", ")}. Run --list-tables.`);
  }

  pool = new Pool({ connectionString: databaseUrl });

  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Airtable base: ${baseId}`);
  console.log(`Postgres schema: ${SCHEMA}`);
  console.log(`Import org: ${importOrgId}`);
  console.log("");

  try {
    const mappingTableExists = await tableExists("airtable_record_mappings");
    if (apply && !mappingTableExists) {
      fail("airtable_record_mappings table is missing. Run migrations before --apply.");
    }
    if (apply && !(await orgExists(importOrgId))) {
      fail(`Import org '${importOrgId}' is missing. Run migrations or create the org before --apply.`);
    }
    if (!mappingTableExists) {
      console.log("Mapping table not present yet; dry-run will assume Airtable IDs become Postgres IDs.");
      console.log("");
    }

    const context: ImportContext = {
      mappingBySource: mappingTableExists
        ? await readExistingMappings()
        : new Map(),
      workByTrackSource: mappingTableExists
        ? await readTrackWorkMappings()
        : new Map(),
      fallbackToAirtableIds: !mappingTableExists,
    };

    const client = await pool.connect();
    try {
      if (apply) await client.query("begin");

      const plans: TablePlan[] = [];
      for (const spec of selectedSpecs) {
        const plan = await processSpec(client, spec, context);
        plans.push(plan);
        printPlan(plan);
      }

      if (apply) {
        await client.query("commit");
        console.log("");
        console.log("Import committed.");
      } else {
        console.log("");
        console.log("Dry run complete. Re-run with --apply to insert missing rows.");
      }

      printSummary(plans);
    } catch (error) {
      if (apply) await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

async function processSpec(
  client: PoolClient,
  spec: ImportSpec,
  context: ImportContext,
): Promise<TablePlan> {
  const records = await readAirtableRecords(spec.airtableTable);
  let existing = 0;
  let insertable = 0;
  let skipped = 0;
  const blocked: string[] = [];
  let inserted = 0;
  const errors: string[] = [];

  for (const record of records) {
    const mappedRow = spec.map(record, context);
    const row: FieldMap | null = mappedRow
      ? { org_id: importOrgId, ...mappedRow }
      : null;
    if (!row) {
      skipped++;
      continue;
    }

    const exists = await rowExists(client, spec.postgresTable, String(row.id));
    if (exists) {
      existing++;
      if (apply) {
        await afterApplyRecord(client, spec, record, String(row.id), context);
      }
      continue;
    }

    const conflict = await findUniqueConflict(client, spec, row);
    if (conflict) {
      const resolvedDuplicateId =
        apply && spec.key === "organizations"
          ? await findExistingOrganizationId(client, row)
          : null;
      if (resolvedDuplicateId) {
        await insertMapping(client, spec, record, resolvedDuplicateId);
        context.mappingBySource.set(sourceKey(spec.airtableTable, record.id), resolvedDuplicateId);
        existing++;
        continue;
      }

      blocked.push(`${record.id}: ${conflict}`);
      continue;
    }

    insertable++;
    if (apply) {
      await client.query("savepoint airtable_import_row");
      try {
        const didInsert = await insertRow(client, spec.postgresTable, row);
        if (didInsert) {
          await insertMapping(client, spec, record, String(row.id));
          context.mappingBySource.set(sourceKey(spec.airtableTable, record.id), String(row.id));
          await afterApplyRecord(client, spec, record, String(row.id), context);
          inserted++;
        } else {
          errors.push(`${record.id}: insert skipped by unique conflict or constraint`);
        }
        await client.query("release savepoint airtable_import_row");
      } catch (error) {
        await client.query("rollback to savepoint airtable_import_row");
        await client.query("release savepoint airtable_import_row");
        errors.push(`${record.id}: ${errorMessage(error)}`);
      }
    }
  }

  return {
    spec,
    fetched: records.length,
    mappable: records.length - skipped,
    existing,
    insertable,
    skipped,
    blocked,
    inserted,
    errors,
  };
}

function printPlan(plan: TablePlan) {
  const action = apply ? `inserted ${plan.inserted}` : `would insert ${plan.insertable}`;
  console.log(
    `${plan.spec.key}: fetched ${plan.fetched}, mappable ${plan.mappable}, existing ${plan.existing}, blocked ${plan.blocked.length}, skipped ${plan.skipped}, ${action}`,
  );
  for (const blocked of plan.blocked.slice(0, 5)) {
    console.log(`  blocked: ${blocked}`);
  }
  if (plan.blocked.length > 5) {
    console.log(`  ...${plan.blocked.length - 5} more blocked records`);
  }
  for (const error of plan.errors.slice(0, 5)) {
    console.log(`  error: ${error}`);
  }
  if (plan.errors.length > 5) {
    console.log(`  ...${plan.errors.length - 5} more errors`);
  }
}

function printSummary(plans: TablePlan[]) {
  const fetched = sum(plans, "fetched");
  const insertable = sum(plans, "insertable");
  const inserted = sum(plans, "inserted");
  const skipped = sum(plans, "skipped");
  const blocked = plans.reduce((total, plan) => total + plan.blocked.length, 0);
  const errors = plans.reduce((total, plan) => total + plan.errors.length, 0);

  console.log("");
  console.log("Summary:");
  console.log(`  Tables: ${plans.length}`);
  console.log(`  Airtable records fetched: ${fetched}`);
  console.log(`  Missing rows planned: ${insertable}`);
  if (apply) console.log(`  Rows inserted: ${inserted}`);
  console.log(`  Records blocked by constraints: ${blocked}`);
  console.log(`  Records skipped by mapper: ${skipped}`);
  console.log(`  Errors: ${errors}`);
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
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) return response.json();

    const body = await response.text();
    lastError = new Error(
      `Airtable ${response.status} ${response.statusText}: ${body.slice(0, 300)}`,
    );

    if (![429, 500, 502, 503, 504].includes(response.status)) {
      throw lastError;
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) ? retryAfter * 1000 : 750 * (attempt + 1));
  }

  throw lastError ?? new Error("Airtable request failed");
}

async function tableExists(table: string): Promise<boolean> {
  const result = await pool.query(
    `
      select 1
      from information_schema.tables
      where table_schema = $1 and table_name = $2
    `,
    [SCHEMA, table],
  );
  return Boolean(result.rowCount);
}

async function readExistingMappings(): Promise<Map<string, string>> {
  const result = await pool.query(
    `
      select airtable_table_name, airtable_record_id, postgres_record_id
      from ${qname("airtable_record_mappings")}
      where airtable_base_id = $1
        and org_id = $2
    `,
    [baseId, importOrgId],
  );

  return new Map(
    result.rows.map((row) => [
      sourceKey(row.airtable_table_name, row.airtable_record_id),
      row.postgres_record_id,
    ]),
  );
}

async function readTrackWorkMappings(): Promise<Map<string, string>> {
  const result = await pool.query(
    `
      select mapping.airtable_record_id, track.work_id
      from ${qname("airtable_record_mappings")} mapping
      join ${qname("tracks")} track
        on track.org_id = mapping.org_id
        and track.id = mapping.postgres_record_id
      where mapping.airtable_base_id = $1
        and mapping.org_id = $2
        and mapping.airtable_table_name = 'Release Tracks'
        and track.work_id is not null
    `,
    [baseId, importOrgId],
  );

  return new Map(
    result.rows.map((row) => [
      sourceKey("Release Tracks", row.airtable_record_id),
      row.work_id,
    ]),
  );
}

async function orgExists(orgId: string): Promise<boolean> {
  const result = await pool.query(
    `select 1 from ${qname("orgs")} where id = $1 limit 1`,
    [orgId],
  );
  return Boolean(result.rowCount);
}

async function rowExists(
  client: PoolClient,
  table: string,
  id: string,
): Promise<boolean> {
  const result = await client.query(
    `select 1 from ${qname(table)} where id = $1 limit 1`,
    [id],
  );
  return Boolean(result.rowCount);
}

async function findUniqueConflict(
  client: PoolClient,
  spec: ImportSpec,
  row: FieldMap,
): Promise<string | null> {
  for (const check of spec.uniqueChecks ?? []) {
    const values = check.columns.map((column) => row[column]);
    if (values.some(isEmptyUniqueValue)) continue;

    const whereColumns = check.columns.includes("org_id")
      ? check.columns
      : ["org_id", ...check.columns];
    const whereValues = whereColumns.map((column) => row[column]);
    if (whereValues.some(isEmptyUniqueValue)) continue;

    const conditions = whereColumns.map(
      (column, index) => `${quoteIdent(column)} = $${index + 2}`,
    );
    const result = await client.query(
      `
        select id
        from ${qname(spec.postgresTable)}
        where id <> $1
          and ${conditions.join(" and ")}
        limit 1
      `,
      [String(row.id), ...whereValues],
    );

    if (result.rowCount) {
      return `${check.label} already belongs to an existing ${spec.postgresTable} row`;
    }
  }

  return null;
}

async function findExistingOrganizationId(
  client: PoolClient,
  row: FieldMap,
): Promise<string | null> {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!name) return null;

  const result = await client.query<{ id: string }>(
    `
      select id
      from ${qname("organizations")}
      where org_id = $1
        and name = $2
      limit 1
    `,
    [importOrgId, name],
  );

  return result.rows[0]?.id ?? null;
}

async function insertRow(
  client: PoolClient,
  table: string,
  row: FieldMap,
): Promise<boolean> {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([column]) => quoteIdent(column));
  const values = entries.map(([, value]) => value);
  const placeholders = entries.map((_, index) => `$${index + 1}`);

  const result = await client.query(
    `
      insert into ${qname(table)} (${columns.join(", ")})
      values (${placeholders.join(", ")})
      on conflict do nothing
      returning id
    `,
    values,
  );

  return Boolean(result.rowCount);
}

async function insertMapping(
  client: PoolClient,
  spec: ImportSpec,
  record: AirtableRecord,
  postgresRecordId: string,
): Promise<void> {
  const id = `${importOrgId}:${baseId}:${spec.airtableTable}:${record.id}`;
  await client.query(
    `
      insert into ${qname("airtable_record_mappings")} (
        id,
        org_id,
        airtable_base_id,
        airtable_table_name,
        airtable_record_id,
        postgres_table_name,
        postgres_record_id,
        import_batch_id,
        record_hash,
        imported_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
      on conflict (org_id, airtable_base_id, airtable_table_name, airtable_record_id)
      do update set
        postgres_table_name = excluded.postgres_table_name,
        postgres_record_id = excluded.postgres_record_id,
        import_batch_id = excluded.import_batch_id,
        record_hash = excluded.record_hash,
        updated_at = now()
    `,
    [
      id,
      importOrgId,
      baseId,
      spec.airtableTable,
      record.id,
      spec.postgresTable,
      postgresRecordId,
      importBatchId,
      hashFields(record.fields),
    ],
  );
}

async function afterApplyRecord(
  client: PoolClient,
  spec: ImportSpec,
  record: AirtableRecord,
  postgresRecordId: string,
  context: ImportContext,
): Promise<void> {
  if (spec.key === "contacts") {
    await insertContactOrganizationLink(client, record, postgresRecordId, context);
  }
  if (spec.key === "dsp_pitches") {
    await insertDspPitchReleaseLinks(client, record, postgresRecordId, context);
  }
}

async function insertContactOrganizationLink(
  client: PoolClient,
  record: AirtableRecord,
  contactId: string,
  context: ImportContext,
): Promise<void> {
  const linkedOrganizationIds = linkedPostgresIds(record, context, [
    "Related Organization",
    "Related Company",
    "From field: Related Company",
  ], "Contacts");

  for (const organizationId of linkedOrganizationIds) {
    await insertContactOrganizationRow(client, record, contactId, organizationId);
  }

  const company = text(record, ["Company", "Organization", "Organisation"]);
  if (!company) return;

  const organizationId = `airtable-org-${hashKey(`${importOrgId}:${company.trim().toLowerCase()}`)}`;
  await client.query(
    `
      insert into ${qname("organizations")} (
        id,
        org_id,
        name,
        type,
        source,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, now(), now())
      on conflict (org_id, name) do nothing
    `,
    [
      organizationId,
      importOrgId,
      company.trim(),
      text(record, ["Company Type", "Organization Type"]) ?? "company",
      "airtable contacts import",
    ],
  );

  const existing = await client.query<{ id: string }>(
    `
      select id from ${qname("organizations")}
      where org_id = $1 and name = $2
      limit 1
    `,
    [importOrgId, company.trim()],
  );
  const resolvedOrganizationId = existing.rows[0]?.id ?? organizationId;

  await insertContactOrganizationRow(client, record, contactId, resolvedOrganizationId);
}

async function insertContactOrganizationRow(
  client: PoolClient,
  record: AirtableRecord,
  contactId: string,
  organizationId: string,
): Promise<void> {
  await client.query(
    `
      insert into ${qname("contact_organizations")} (
        id,
        org_id,
        contact_id,
        organization_id,
        title,
        relationship_type,
        is_primary,
        source,
        confidence,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, true, $7, $8, now(), now())
      on conflict (org_id, contact_id, organization_id) do update set
        title = coalesce(excluded.title, ${qname("contact_organizations")}.title),
        relationship_type = coalesce(excluded.relationship_type, ${qname("contact_organizations")}.relationship_type),
        updated_at = now()
    `,
    [
      `contact-org-${hashKey(`${importOrgId}:${contactId}:${organizationId}`)}`,
      importOrgId,
      contactId,
      organizationId,
      text(record, ["Role", "Contact Role"]),
      "works_at",
      "airtable contacts import",
      0.9,
    ],
  );
}

async function insertDspPitchReleaseLinks(
  client: PoolClient,
  record: AirtableRecord,
  dspPitchId: string,
  context: ImportContext,
): Promise<void> {
  const releaseIds = linkedPostgresIds(record, context, [
    "Releases",
    "Release",
    "Linked Release",
  ], "Releases (And Artist Events)");

  for (const releaseId of releaseIds) {
    await client.query(
      `
        insert into ${qname("dsp_pitch_releases")} (
          id,
          org_id,
          dsp_pitch_id,
          release_id,
          airtable_base_id,
          airtable_record_id,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (org_id, dsp_pitch_id, release_id) do nothing
      `,
      [
        `${dspPitchId}:${releaseId}`,
        importOrgId,
        dspPitchId,
        releaseId,
        baseId,
        record.id,
      ],
    );
  }
}

const importBatchId = `airtable-${new Date().toISOString()}`;

const IMPORT_SPECS: ImportSpec[] = [
  {
    key: "organizations",
    airtableTable: "Contacts",
    postgresTable: "organizations",
    description: "Companies and organizations stored in Airtable Contacts",
    defaultEnabled: true,
    uniqueChecks: [{ label: "organization name", columns: ["name"] }],
    map: (record) => {
      if (!isAirtableOrganizationContact(record)) return null;

      return {
        id: record.id,
        name: text(record, ["Name", "Company", "Organization"]) ?? `Airtable Organization ${record.id}`,
        type: text(record, ["Role", "Organization Type", "Type"]),
        website: text(record, ["URL", "Website"]),
        notes: text(record, ["Notes", "Internal Notes"]),
        source: "airtable contacts import",
      };
    },
  },
  {
    key: "contacts",
    airtableTable: "Contacts",
    postgresTable: "contacts",
    description: "People and companies",
    defaultEnabled: true,
    uniqueChecks: [{ label: "email", columns: ["email"] }],
    map: (record) => {
      if (isAirtableOrganizationContact(record)) return null;

      return {
        id: record.id,
        name: text(record, ["Name", "Full Name", "Contact Name"]) ?? `Airtable Contact ${record.id}`,
        email: text(record, ["E-Mail", "Email"]),
        phone: text(record, ["Phone", "Phone Number"]),
        role: text(record, ["Role", "Contact Role"]),
        company: text(record, ["Company", "Organization", "Organisation"]),
        notes: text(record, ["Notes", "Internal Notes"]),
      };
    },
  },
  {
    key: "artists",
    airtableTable: "Artists",
    postgresTable: "artists",
    description: "Roster artists",
    defaultEnabled: true,
    uniqueChecks: [{ label: "Spotify ID", columns: ["spotify_id"] }],
    map: (record, context) => ({
      id: record.id,
      name: text(record, ["Artist Name", "Name", "Artist"]) ?? `Airtable Artist ${record.id}`,
      bio: text(record, ["Bio", "Biography", "Notes"]),
      spotify_id: text(record, ["Spotify ID", "Spotify Artist ID"]),
      spotify_followers: integer(record, ["Spotify Followers", "Followers"]),
      spotify_popularity: integer(record, ["Spotify Popularity", "Popularity"]),
      pro: text(record, ["PRO", "Pro"]),
      ipi: text(record, ["IPI", "IPI Number"]),
      instagram: text(record, ["Instagram", "IG"]),
      tiktok: text(record, ["TikTok", "Tiktok"]),
      contact_id: link(record, context, ["Contact", "Primary Contact", "Manager"]),
    }),
  },
  {
    key: "works",
    airtableTable: "Recordings (Masters)",
    postgresTable: "works",
    description: "Stable recording/work rows",
    defaultEnabled: true,
    uniqueChecks: [
      { label: "ISRC", columns: ["isrc"] },
      { label: "ISWC", columns: ["iswc"] },
    ],
    map: (record) => ({
      id: record.id,
      title: text(record, [
        "Title",
        "Name",
        "Recording",
        "Recording Title",
        "Master",
        "Track Title",
      ]) ?? `Airtable Recording ${record.id}`,
      isrc: text(record, ["ISRC", "ISRC Code"]),
      iswc: text(record, ["ISWC", "ISWC Code"]),
      audio_url: urlText(record, ["Audio", "Audio URL", "Audio File", "File"]),
      duration: durationSeconds(record, ["Duration", "Length"]),
      genre: text(record, ["Genre", "Genres"]),
    }),
  },
  {
    key: "releases",
    airtableTable: "Releases (And Artist Events)",
    postgresTable: "releases",
    description: "Releases and artist events",
    defaultEnabled: true,
    uniqueChecks: [{ label: "UPC/EAN", columns: ["upc_ean"] }],
    map: (record, context) => ({
      id: record.id,
      title: text(record, ["Title", "Name", "Release", "Release Title"]) ?? `Airtable Release ${record.id}`,
      artist_id: link(record, context, ["Artist", "Artists", "Linked Artist"]),
      release_date: dateText(record, ["Release Date", "Date"]),
      format: text(record, ["Format", "Release Type", "Type"]),
      upc_ean: text(record, ["UPC/EAN", "UPC", "EAN"]),
      cover_art_url: urlText(record, ["Cover Art", "Cover Art URL", "Artwork", "Artwork URL"]),
      status: text(record, ["Status"]) ?? "draft",
      delivery_status: text(record, ["Delivery Status"]),
      exploitation_scope: text(record, ["Exploitation Scope"]),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "projects",
    airtableTable: "Projects",
    postgresTable: "budget_projects",
    description: "Operational and funding projects",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      name: text(record, ["Project Name", "Name", "Project"]) ?? `Airtable Project ${record.id}`,
      artist_id: link(record, context, ["Artist", "Linked Artist"]),
      release_id: link(record, context, ["Release", "Linked Release"]),
      status: text(record, ["Status"]) ?? "planning",
      currency: text(record, ["Currency"]) ?? "USD",
      total_planned: numberValue(record, ["Total Planned", "Budget", "Planned Budget"]) ?? 0,
      baseline_funding: numberValue(record, ["Baseline Funding", "Funding", "Confirmed Funding"]) ?? 0,
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "grants",
    airtableTable: "Grants",
    postgresTable: "grants",
    description: "Grant opportunity catalogue",
    defaultEnabled: true,
    map: (record) => ({
      id: record.id,
      name: text(record, ["Grant Title", "Grant Label", "Name", "Grant"]) ?? `Airtable Grant ${record.id}`,
      funder: text(record, ["Who", "Funder", "Funding Body"]),
      program: text(record, ["Program / Category", "Program"]),
      category: text(record, ["Category", "Type"]),
      url: text(record, ["Url", "URL", "Website"]),
      research_url: text(record, ["Research Link"]),
      description: text(record, ["Description"]),
      requirements: text(record, ["Requirements Summary", "Requirements", "Eligibility"]),
      opens_on: dateText(record, ["Opens On", "Open Date"]),
      deadline: dateText(record, ["Application Date", "Deadline", "Submission Deadline"]),
      max_amount: numberValue(record, ["Max Amount", "Maximum Amount", "Amount"]),
      currency: text(record, ["Currency"]) ?? "DKK",
      priority: normalizeWorkflowStatus(text(record, ["Priority"]), "medium"),
      status: normalizeWorkflowStatus(text(record, ["Status"]), "open"),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "grant_applications",
    airtableTable: "Applications",
    postgresTable: "grant_applications",
    description: "Project grant applications",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      project_id: link(record, context, ["Project", "Linked Project"]),
      grant_id: link(record, context, ["Grant", "Linked Grant"]),
      funding_source_id: link(record, context, ["Funding Source"]),
      owner_contact_id: link(record, context, ["Owner Contact", "Owner"]),
      status: normalizeWorkflowStatus(text(record, ["Status"]), "draft"),
      amount_requested: numberValue(record, ["Amount Applied", "Amount Requested"]),
      amount_awarded: numberValue(record, ["Amount Awarded"]),
      submission_deadline: dateText(record, ["Submission Deadline", "Deadline"]),
      submitted_at: dateValue(record, ["Submitted At", "Submission Date"]),
      decision_date: dateText(record, ["Decision Date"]),
      reporting_due: dateText(record, ["Reporting Due", "Report Deadline"]),
      external_reference: text(record, ["ID", "Reference"]),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "reporting_weeks",
    airtableTable: "Reporting Weeks",
    postgresTable: "reporting_weeks",
    description: "Weekly reporting calendar",
    defaultEnabled: true,
    uniqueChecks: [{ label: "reporting week dates", columns: ["start_date", "end_date"] }],
    map: (record) => {
      const startDate = dateText(record, ["Start Date", "Week Start", "Start"]);
      const endDate = dateText(record, ["End Date", "Week End", "End"]);
      if (!startDate || !endDate) return null;

      return {
        id: record.id,
        label: text(record, ["Week Label", "Label", "Week", "Name", "Reporting Week"]) ?? `${startDate} – ${endDate}`,
        start_date: startDate,
        end_date: endDate,
        status: text(record, ["Status"]) ?? "planned",
        notes: text(record, ["Notes"]),
      };
    },
  },
  {
    key: "release_reporting",
    airtableTable: "Reporting",
    postgresTable: "release_reporting",
    description: "Release assignments to reporting weeks",
    defaultEnabled: true,
    uniqueChecks: [{ label: "release reporting assignment", columns: ["reporting_week_id", "release_id"] }],
    map: (record, context) => {
      const reportingWeekId = link(record, context, ["Reporting Week", "Week"]);
      const releaseId = link(record, context, ["Release", "Linked Release", "Release Event"]);
      if (!reportingWeekId || !releaseId) return null;

      return {
        id: record.id,
        reporting_week_id: reportingWeekId,
        release_id: releaseId,
        status: text(record, ["Status"]) ?? "planned",
        priority: text(record, ["Priority"]) ?? "P2",
        notes: text(record, ["Notes", "Report", "Summary"]),
      };
    },
  },
  {
    key: "tracks",
    airtableTable: "Release Tracks",
    postgresTable: "tracks",
    description: "Tracks on releases",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      title: text(record, ["Track Title", "Title", "Name", "Track Name"]) ?? `Airtable Track ${record.id}`,
      release_id: link(record, context, ["Release", "Releases", "Release Event"]),
      work_id: link(record, context, [
        "WORKS",
        "Work Title",
        "Recording",
        "Master",
        "Work",
        "Recordings (Masters)",
      ]),
      position: integer(record, ["Position", "Track Number", "Track No"]),
      version: text(record, ["Version"]) ?? "Main",
      isrc: text(record, ["ISRC", "ISRC Code"]),
      audio_url: urlText(record, ["Audio", "Audio URL", "Audio File", "File"]),
      duration: durationSeconds(record, ["Duration", "Length"]),
    }),
  },
  {
    key: "roles",
    airtableTable: "Rights Lines (Roles)",
    postgresTable: "roles",
    description: "Rights and credit lines",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      contact_id: link(record, context, ["Contact", "Person", "Contributor", "Payee"]),
      work_id: link(record, context, [
        "WORKS",
        "Recording",
        "Master",
        "Work",
        "Recordings (Masters)",
      ]) ?? linkedTrackWork(record, context, ["Track", "Release Track"]),
      role: text(record, ["Role", "Credit", "Role Type"]) ?? "Rights",
      ownership_type: text(record, ["Ownership Type", "Ownership", "Type"]) ?? "Rights",
      scope: text(record, ["Scope", "Rights Scope", "Clearance Scope"]),
      percent_share: numberValue(record, ["Percent Share", "% Share", "Share", "Split %", "Share %"]),
      clearance_status: text(record, ["Clearance Status", "Status", "Rights Status"]) ?? "Unknown",
      reviewed_by: text(record, ["Reviewed By", "Reviewer"]),
    }),
  },
  {
    key: "isrc_sequences",
    airtableTable: "ISRC Sequences",
    postgresTable: "isrc_sequences",
    description: "ISRC year counters",
    defaultEnabled: true,
    uniqueChecks: [{ label: "year", columns: ["year"] }],
    map: (record) => {
      const year = isrcYear(record);
      if (!year) return null;

      return {
        id: record.id,
        year,
        last_production_number: integer(record, [
        "Last Production #",
        "Last Production Number",
        "Last Number",
        "Counter",
      ]) ?? 0,
        prefix: text(record, ["Prefix", "Registrant Code"]) ?? "DKO7P",
      };
    },
  },
  {
    key: "budget_categories",
    airtableTable: "Budget Categories",
    postgresTable: "budget_categories",
    description: "Budget categories",
    defaultEnabled: true,
    map: (record) => ({
      id: record.id,
      name: text(record, ["Name", "Category"]) ?? `Airtable Budget Category ${record.id}`,
      type: text(record, ["Type", "Bucket"]),
    }),
  },
  {
    key: "budget_line_items",
    airtableTable: "Budget Line Items",
    postgresTable: "budget_line_items",
    description: "Release budget lines",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      release_id: link(record, context, ["Release", "Linked Release"]),
      category_id: link(record, context, ["Category", "Budget Category"]),
      name: text(record, ["Title", "Name", "Item", "Line Item"]) ?? `Airtable Budget Item ${record.id}`,
      amount: numberValue(record, ["Amount", "Cost", "Budget"]) ?? 0,
      status: normalizeBudgetStatus(text(record, ["Status"])),
    }),
  },
  {
    key: "dsp_pitches",
    airtableTable: "DSP Pitches",
    postgresTable: "dsp_pitches",
    description: "DSP pitch records",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      release_id: link(record, context, ["Releases", "Release", "Linked Release"]),
      platform: text(record, ["Platform", "DSP"]),
      status: normalizeDspPitchStatus(text(record, ["Status"]), dateValue(record, ["Date Sent", "Sent Date", "Date"])),
      sent_date: dateValue(record, ["Date Sent", "Sent Date", "Date"]),
      response: joinNotes(
        labeledText("Airtable Status", text(record, ["Status"])),
        labeledText("Subject", text(record, ["Subject Line"])),
        labeledText("Salutation", text(record, ["Salutation"])),
        labeledText("Pitch", text(record, ["Full Pitch", "Full Pitch E"])),
        labeledText("Recipients", text(record, ["To", "Recipients"])),
        labeledText("Notes", text(record, ["Response", "Notes", "Pitch Notes"])),
      ),
    }),
  },
  {
    key: "campaigns",
    airtableTable: "Campaigns",
    postgresTable: "campaigns",
    description: "Campaigns",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      campaign_name: text(record, ["Campaign Name", "Name", "Campaign"]) ?? `Airtable Campaign ${record.id}`,
      linked_release_id: link(record, context, ["Release", "Linked Release"]),
      linked_artist_id: link(record, context, ["Artist", "Linked Artist"]),
      campaign_type: text(record, ["Campaign Type", "Type"]),
      start_date: dateText(record, ["Start Date"]),
      end_date: dateText(record, ["End Date"]),
      status: text(record, ["Status"]) ?? "planning",
      owner: text(record, ["Owner"]),
      goal: text(record, ["Goal"]),
      budget_planned: numberValue(record, ["Budget Planned", "Planned Budget"]),
      budget_actual: numberValue(record, ["Budget Actual", "Actual Budget"]),
      kpi_summary: text(record, ["KPI Summary", "KPIs"]),
      notes: text(record, ["Notes"]),
      performance_rating: integer(record, ["Performance Rating", "Rating"]),
      main_platform: text(record, ["Main Platform", "Platform"]),
    }),
  },
  {
    key: "calls",
    airtableTable: "Calls",
    postgresTable: "calls",
    description: "Calls for Today Hub",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      title: text(record, ["Title", "Name", "Call"]) ?? `Airtable Call ${record.id}`,
      contact_id: link(record, context, ["Contact", "Person"]),
      release_id: link(record, context, ["Release", "Linked Release"]),
      project_id: link(record, context, ["Project", "Linked Project"]),
      status: normalizeWorkflowStatus(text(record, ["Status", "Call Status"]), "scheduled"),
      call_type: text(record, ["Type", "Call Type"]),
      start: dateValue(record, ["Start", "Start Time", "Date"]),
      end: dateValue(record, ["End", "End Time"]),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "ops_tasks",
    airtableTable: "Ops Tasks",
    postgresTable: "ops_tasks",
    description: "Operations tasks",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      task_name: text(record, ["Task Name", "Name", "Task"]) ?? `Airtable Task ${record.id}`,
      status: normalizeWorkflowStatus(text(record, ["Status"]), "todo"),
      priority: text(record, ["Priority"]) ?? "P2",
      owner: text(record, ["Owner"]),
      due_date: dateText(record, ["Due Date", "Deadline"]),
      linked_artist_id: link(record, context, ["Artist", "Linked Artist"]),
      linked_release_id: link(record, context, ["Release", "Linked Release"]),
      linked_campaign_id: link(record, context, ["Campaign", "Linked Campaign"]),
      linked_contact_id: link(record, context, ["Contact", "Linked Contact"]),
      owner_contact_id: link(record, context, ["Owner Contact", "Owner"]),
      project_id: link(record, context, ["Project", "Linked Project"]),
      notes: text(record, ["Notes"]),
      next_action: text(record, ["Next Action", "Action"]),
      is_overdue: booleanValue(record, ["Overdue", "Is Overdue"]) ?? false,
    }),
  },
  {
    key: "radio_stations",
    airtableTable: "Radio Stations",
    postgresTable: "radio_stations",
    description: "Radio CRM stations",
    defaultEnabled: true,
    uniqueChecks: [{ label: "call sign", columns: ["call_sign"] }],
    map: (record) => ({
      id: record.id,
      name: text(record, ["Name", "Station", "Station Name"]) ?? `Airtable Station ${record.id}`,
      call_sign: text(record, ["Call Sign", "Callsign", "Call Letters"]),
      frequency: text(record, ["Frequency"]),
      city: text(record, ["City"]),
      state: text(record, ["State"]),
      country: text(record, ["Country"]),
      email: text(record, ["Email", "E-Mail"]),
      phone: text(record, ["Phone"]),
      website: text(record, ["Website", "URL"]),
      dj_name: text(record, ["DJ Name", "DJ", "Contact"]),
      tier: text(record, ["Tier", "Support Level"]),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "media_assets",
    airtableTable: "Media Assets",
    postgresTable: "media_assets",
    description: "Media assets",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      asset_name: text(record, ["Asset Name", "Name", "Asset"]) ?? `Airtable Asset ${record.id}`,
      asset_type: text(record, ["Asset Type", "Type"]),
      linked_artist_id: link(record, context, ["Artist", "Linked Artist"]),
      linked_release_id: link(record, context, ["Release", "Linked Release"]),
      version: text(record, ["Version"]),
      approval_status: text(record, ["Approval Status"]) ?? "pending",
      delivery_status: text(record, ["Delivery Status"]) ?? "not_sent",
      file_link: urlText(record, ["File Link", "File", "URL"]),
      notes: joinNotes(
        text(record, ["Notes"]),
        labeledText("Rights/Clearance", text(record, ["Rights/Clearance Status"])),
        labeledText("Usage/Placement", text(record, ["Usage/Placement Summary"])),
        labeledText("Web image reference", urlText(record, ["Find Web Image (Reference only)"])),
      ),
      date_uploaded: dateText(record, ["Date Uploaded", "Uploaded"]),
    }),
  },
  {
    key: "assets",
    airtableTable: "Assets",
    postgresTable: "media_assets",
    description: "Airtable implementation assets imported as media asset metadata",
    defaultEnabled: false,
    map: (record) => ({
      id: record.id,
      asset_name: text(record, ["Asset Name", "Name"]) ?? `Airtable Asset ${record.id}`,
      asset_type: "Airtable Asset",
      version: null,
      approval_status: "imported",
      delivery_status: "not_sent",
      file_link: null,
      notes: joinNotes(
        text(record, ["Content"]),
        labeledText("Last updated", dateText(record, ["Last Updated"])),
      ),
      date_uploaded: dateText(record, ["Last Updated"]),
    }),
  },
  {
    key: "documents",
    airtableTable: "Documents",
    postgresTable: "documents",
    description: "Documents",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      name: text(record, ["Name", "Document", "Document Name"]) ?? `Airtable Document ${record.id}`,
      doc_type: text(record, ["Doc Type", "Type"]),
      release_id: link(record, context, ["Release", "Linked Release"]),
      artist_id: link(record, context, ["Artist", "Linked Artist"]),
      contact_id: link(record, context, ["Contact", "Linked Contact"]),
      status: text(record, ["Status"]) ?? "draft",
      file_link: urlText(record, ["File Link", "File", "URL"]),
      notes: text(record, ["Notes"]),
    }),
  },
  {
    key: "side_artists",
    airtableTable: "Side Artists",
    postgresTable: "side_artists",
    description: "Side artists",
    defaultEnabled: true,
    map: (record, context) => ({
      id: record.id,
      name: text(record, ["Name", "Side Artist", "Artist"]) ?? `Airtable Side Artist ${record.id}`,
      artist_id: link(record, context, ["Artist", "Main Artist", "Linked Artist"]),
      release_id: link(record, context, ["Release", "Linked Release"]),
      type: text(record, ["Type", "Role"]),
    }),
  },
  {
    key: "bugs",
    airtableTable: "Bugs",
    postgresTable: "bugs",
    description: "Airtable bugs, optional because many are formula/migration scaffolding",
    defaultEnabled: false,
    uniqueChecks: [{ label: "bug key", columns: ["bug_key"] }],
    map: (record) => ({
      id: record.id,
      bug_key: `airtable-${record.id}`,
      source_table: text(record, ["Source Table"]),
      source_record_id: text(record, ["Source Record ID"]),
      title: text(record, ["Name", "Title", "Bug"]) ?? `Airtable Bug ${record.id}`,
      description: text(record, ["Description", "Notes"]),
      priority: text(record, ["Priority"]) ?? "P2",
      status: text(record, ["Status"]) ?? "logged",
      auto_generated: booleanValue(record, ["Auto Generated", "Auto"]) ?? false,
    }),
  },
];

function text(record: AirtableRecord, names: string[]): string | null {
  const value = firstField(record, names);
  if (value == null || value === "") return null;
  if (Array.isArray(value)) {
    return value.map(formatFieldValue).filter(Boolean).join(", ") || null;
  }
  return formatFieldValue(value);
}

function isAirtableOrganizationContact(record: AirtableRecord): boolean {
  return text(record, ["Type"])?.trim().toLowerCase() === "organization";
}

function numberValue(record: AirtableRecord, names: string[]): number | null {
  const value = firstField(record, names);
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[%,$]/g, "").trim();
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function integer(record: AirtableRecord, names: string[]): number | null {
  const value = numberValue(record, names);
  return value == null ? null : Math.round(value);
}

function isrcYear(record: AirtableRecord): number | null {
  const fullYear = integer(record, ["Year"]);
  if (fullYear) return fullYear;

  const shortYear = text(record, ["Year (YY)", "YY"]);
  if (!shortYear) return null;

  const parsed = Number(shortYear.replace(/\D/g, ""));
  if (!Number.isInteger(parsed)) return null;
  if (parsed >= 1000) return parsed;
  return 2000 + parsed;
}

function normalizeBudgetStatus(value: string | null): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "aproved" || normalized === "approved") return "approved";
  if (normalized === "paid") return "paid";
  return "pending";
}

function normalizeDspPitchStatus(value: string | null, sentDate: Date | null): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "approved") return "approved";
  if (normalized === "responded") return "responded";
  if (normalized === "sent" || normalized === "trigger send") return "sent";
  return sentDate ? "sent" : "draft";
}

function normalizeWorkflowStatus(value: string | null, fallback: string): string {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!normalized) return fallback;
  if (normalized === "complete") return "completed";
  if (normalized === "canceled") return "cancelled";
  return normalized;
}

function booleanValue(record: AirtableRecord, names: string[]): boolean | null {
  const value = firstField(record, names);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "no", "n", "0"].includes(normalized)) return false;
  }
  return null;
}

function dateText(record: AirtableRecord, names: string[]): string | null {
  const value = firstField(record, names);
  if (typeof value !== "string" || !value.trim()) return null;
  return value.slice(0, 10);
}

function dateValue(record: AirtableRecord, names: string[]): Date | null {
  const value = firstField(record, names);
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function durationSeconds(record: AirtableRecord, names: string[]): number | null {
  const numeric = numberValue(record, names);
  if (numeric != null) return Math.round(numeric);
  const raw = text(record, names);
  if (!raw) return null;
  const parts = raw.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function urlText(record: AirtableRecord, names: string[]): string | null {
  const value = firstField(record, names);
  if (Array.isArray(value)) {
    const attachment = value.find((item) => isRecord(item) && typeof item.url === "string");
    if (isRecord(attachment) && typeof attachment.url === "string") return attachment.url;
  }
  return text(record, names);
}

function joinNotes(...parts: Array<string | null | undefined>): string | null {
  const note = parts.filter(Boolean).join("\n\n");
  return note || null;
}

function labeledText(label: string, value: string | null): string | null {
  return value ? `${label}: ${value}` : null;
}

function hashKey(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function link(record: AirtableRecord, context: ImportContext, names: string[]): string | null {
  const value = firstField(record, names);
  const airtableId = firstLinkedRecordId(value);
  if (!airtableId) return null;

  for (const [key, postgresId] of context.mappingBySource.entries()) {
    if (key.endsWith(`:${airtableId}`)) return postgresId;
  }

  return context.fallbackToAirtableIds ? airtableId : null;
}

function linkedPostgresIds(
  record: AirtableRecord,
  context: ImportContext,
  names: string[],
  airtableTable: string,
): string[] {
  const value = firstField(record, names);
  const airtableIds = linkedRecordIds(value);
  const postgresIds = new Set<string>();

  for (const airtableId of airtableIds) {
    const postgresId = context.mappingBySource.get(sourceKey(airtableTable, airtableId));
    if (postgresId) {
      postgresIds.add(postgresId);
    } else if (context.fallbackToAirtableIds) {
      postgresIds.add(airtableId);
    }
  }

  return [...postgresIds];
}

function linkedTrackWork(record: AirtableRecord, context: ImportContext, names: string[]): string | null {
  const value = firstField(record, names);
  const airtableId = firstLinkedRecordId(value);
  if (!airtableId) return null;
  return context.workByTrackSource.get(sourceKey("Release Tracks", airtableId)) ?? null;
}

function firstField(record: AirtableRecord, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record.fields, name)) {
      return record.fields[name];
    }
  }

  const lower = new Map(
    Object.keys(record.fields).map((field) => [field.toLowerCase(), field]),
  );
  for (const name of names) {
    const actual = lower.get(name.toLowerCase());
    if (actual) return record.fields[actual];
  }

  return undefined;
}

function firstLinkedRecordId(value: unknown): string | null {
  return linkedRecordIds(value)[0] ?? null;
}

function linkedRecordIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.startsWith("rec"));
  }
  if (typeof value === "string" && value.startsWith("rec")) return [value];
  return [];
}

function formatFieldValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    if (typeof value.name === "string") return value.name;
    if (typeof value.filename === "string") return value.filename;
    if (typeof value.url === "string") return value.url;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isEmptyUniqueValue(value: unknown): boolean {
  return value == null || value === "";
}

function sourceKey(table: string, recordId: string): string {
  return `${table}:${recordId}`;
}

function hashFields(fields: FieldMap): string {
  return createHash("sha256").update(stableStringify(fields)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sum(plans: TablePlan[], field: keyof Pick<TablePlan, "fetched" | "insertable" | "inserted" | "skipped">): number {
  return plans.reduce((total, plan) => total + plan[field], 0);
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
