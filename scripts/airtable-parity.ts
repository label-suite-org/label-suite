import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { buildKeyRecordEvidence, type ParityKeyRecord, type ParityKeyRow, type ParitySourceIdCheck } from "./m0-parity-audit-core";
import { normalizeParityKey } from "./airtable-parity-key";

if (process.argv.includes("--grants-v2")) {
  const { runGrantsV2ParityCli } = await import("./airtable-grants-v2");
  await runGrantsV2ParityCli();
  process.exit(0);
}

const DEFAULT_BASE_ID = "appoKM3ylTDhR60LY";
const SCHEMA = process.env.AIRTABLE_PARITY_DB_SCHEMA ?? "label_suite";
const ORG_ID = process.env.AIRTABLE_PARITY_ORG_ID ?? "true-nature";
const PAGE_SIZE = 100;

interface TableSpec {
  airtable: string;
  postgres?: string;
  status: "mapped" | "missing" | "skip";
  notes: string;
  large?: boolean;
  checks?: KeyCheckSpec[];
  sourceIdTargets?: string[];
  sourceIdSql?: string;
}

interface KeyCheckSpec {
  label: string;
  airtableFields: string[];
  postgresSql: string;
}

interface AirtableField {
  id: string;
  name: string;
  type: string;
}

interface AirtableTableMetadata {
  id: string;
  name: string;
  primaryFieldId?: string;
  fields: AirtableField[];
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface TableResult {
  spec: TableSpec;
  airtableCount: number | null;
  postgresCount: number | null;
  truncated: boolean;
  error?: string;
  records: AirtableRecord[];
  canonicalRecordIds: string[];
  metadata?: AirtableTableMetadata;
}

interface KeyCheckResult {
  table: string;
  label: string;
  airtableField: string | null;
  airtableKeyCount: number;
  postgresKeyCount: number;
  missingInPostgres: string[];
  extraInPostgres: string[];
  missingInPostgresRecords: ParityKeyRecord[];
  extraInPostgresRecords: ParityKeyRecord[];
}

interface SqlCheckResult {
  label: string;
  count: number;
  samples: string[];
}

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run airtable:parity -- [options]

Reads Airtable and Postgres, then prints a Markdown parity report.
It does not write to Airtable or Postgres.
Safety: Airtable calls are GET-only and Postgres calls are SELECT-only.

Options:
  --grants-v2          Characterize the Grant Applications V2 base only
  --snapshot <path>    With --grants-v2, read a saved JSON snapshot instead of the API
  --output <path>       Also write the report to a file
  --json                Print JSON instead of Markdown
  --counts-only         Skip key/semantic/deep DB checks
  --max-records <n>     Cap Airtable records fetched per table; counts become lower bounds

Environment:
  DATABASE_URL          Postgres connection string
  AIRTABLE_API_KEY      Airtable personal access token
  AIRTABLE_BASE_ID      Optional; defaults to ${DEFAULT_BASE_ID}
  AIRTABLE_PARITY_ORG_ID Optional; defaults to true-nature
`);
  process.exit(0);
}

const options = {
  output: readOption("--output"),
  json: args.includes("--json"),
  countsOnly: args.includes("--counts-only"),
  maxRecords: numberOption("--max-records"),
};

const token =
  process.env.AIRTABLE_API_KEY ??
  process.env.AIRTABLE_PAT ??
  process.env.AIRTABLE_TOKEN;
const baseId = process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  fail("DATABASE_URL is required.");
}

if (!token) {
  fail("AIRTABLE_API_KEY, AIRTABLE_PAT, or AIRTABLE_TOKEN is required.");
}

const pool = new Pool({ connectionString: databaseUrl });

const TABLE_SPECS: TableSpec[] = [
  {
    airtable: "Contacts",
    postgres: "contacts",
    sourceIdTargets: ["contacts", "organizations"],
    status: "mapped",
    notes: "Core contacts are present; richer legal/publisher fields still need product decisions.",
    checks: [
      {
        label: "email",
        airtableFields: ["Email", "E-mail"],
        postgresSql: `select id::text as record_id, email as value from ${qname("contacts")} where email is not null`,
      },
      {
        label: "name",
        airtableFields: ["Name", "Full Name", "Contact Name"],
        postgresSql: `select id::text as record_id, name as value from ${qname("contacts")} where name is not null`,
      },
    ],
  },
  {
    airtable: "Artists",
    postgres: "artists",
    status: "mapped",
    notes: "Core artists are present; metrics history/profile depth remains missing.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Artist", "Artist Name"],
        postgresSql: `select id::text as record_id, name as value from ${qname("artists")} where name is not null`,
      },
    ],
  },
  {
    airtable: "Releases (And Artist Events)",
    postgres: "releases",
    status: "mapped",
    notes: "Core releases are present; event/reporting/catalog fields remain partial.",
    checks: [
      {
        label: "title",
        airtableFields: ["Title", "Name", "Release", "Release Title"],
        postgresSql: `select id::text as record_id, title as value from ${qname("releases")} where title is not null`,
      },
    ],
  },
  {
    airtable: "Release Tracks",
    postgres: "tracks",
    status: "mapped",
    notes: "Core tracks are present; label-copy/curation fields remain partial.",
    checks: [
      {
        label: "title",
        airtableFields: ["Title", "Name", "Track", "Track Title", "Track Name"],
        postgresSql: `select id::text as record_id, title as value from ${qname("tracks")} where title is not null`,
      },
      {
        label: "isrc",
        airtableFields: ["ISRC", "ISRC Code"],
        postgresSql: `select id::text as record_id, isrc as value from ${qname("tracks")} where isrc is not null`,
      },
    ],
  },
  {
    airtable: "Recordings (Masters)",
    postgres: "works",
    status: "mapped",
    notes: "Mapped to works by current architecture; composition split is deferred.",
    checks: [
      {
        label: "title",
        airtableFields: ["Title", "Name", "Recording", "Recording Title"],
        postgresSql: `select id::text as record_id, title as value from ${qname("works")} where title is not null`,
      },
      {
        label: "isrc",
        airtableFields: ["ISRC", "ISRC Code"],
        postgresSql: `select id::text as record_id, isrc as value from ${qname("works")} where isrc is not null`,
      },
    ],
  },
  {
    airtable: "Rights Lines (Roles)",
    postgres: "roles",
    status: "mapped",
    notes: "Core roles are present; Neighboring scope, Contacted/Negotiating statuses, fees, and attachments remain gaps.",
  },
  {
    airtable: "ISRC Sequences",
    postgres: "isrc_sequences",
    status: "mapped",
    notes: "Covered.",
  },
  {
    airtable: "Reporting",
    postgres: "release_reporting",
    status: "mapped",
    notes: "Mapped to release assignments within reporting weeks.",
  },
  {
    airtable: "Budget Line Items",
    postgres: "budget_line_items",
    status: "mapped",
    notes: "Covered/partial; release budget targets remain open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Item", "Line Item"],
        postgresSql: `select id::text as record_id, name as value from ${qname("budget_line_items")} where name is not null`,
      },
    ],
  },
  {
    airtable: "Budget Categories",
    postgres: "budget_categories",
    status: "mapped",
    notes: "Covered.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Category"],
        postgresSql: `select id::text as record_id, name as value from ${qname("budget_categories")} where name is not null`,
      },
    ],
  },
  {
    airtable: "DSP Pitches",
    postgres: "dsp_pitches",
    status: "mapped",
    notes: "Partial; campaign/task linkage and recipient copy depth remain open.",
  },
  {
    airtable: "Projects",
    postgres: "budget_projects",
    status: "mapped",
    notes: "Mapped to the existing operational budget project domain.",
  },
  {
    airtable: "Grants",
    postgres: "grants",
    status: "mapped",
    notes: "Mapped to the grant opportunity catalogue.",
  },
  {
    airtable: "Applications",
    postgres: "grant_applications",
    status: "mapped",
    notes: "Mapped to project grant applications and Today Hub deadlines.",
  },
  {
    airtable: "Assets",
    status: "skip",
    notes: "Airtable implementation asset tracking; replace with storage/media/documents unless operational records matter.",
  },
  {
    airtable: "Bugs",
    postgres: "bugs",
    status: "mapped",
    notes: "Covered/partial; audit/reporting remains open.",
    checks: [
      {
        label: "title",
        airtableFields: ["Name", "Title", "Bug"],
        postgresSql: `select id::text as record_id, title as value from ${qname("bugs")} where title is not null`,
      },
    ],
  },
  {
    airtable: "Calls",
    postgres: "calls",
    status: "mapped",
    notes: "Mapped with status, type, project, contact, release, and schedule fields.",
    checks: [
      {
        label: "title",
        airtableFields: ["Name", "Title", "Call"],
        postgresSql: `select id::text as record_id, title as value from ${qname("calls")} where title is not null`,
      },
    ],
  },
  {
    airtable: "Implementation Log",
    status: "skip",
    notes: "Replace with git history and audit log.",
  },
  {
    airtable: "Schema Snapshots",
    status: "skip",
    notes: "Replace with Drizzle migrations.",
  },
  {
    airtable: "RUNS",
    status: "skip",
    notes: "Replace with job run logs.",
  },
  {
    airtable: "Personal Writings",
    status: "skip",
    notes: "Out of product scope unless explicitly desired.",
  },
  {
    airtable: "Ops Tasks",
    postgres: "ops_tasks",
    status: "mapped",
    notes: "Mapped with artist, release, campaign, contact, owner-contact, and project links.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Task", "Task Name"],
        postgresSql: `select id::text as record_id, task_name as value from ${qname("ops_tasks")} where task_name is not null`,
      },
    ],
  },
  {
    airtable: "Campaigns",
    postgres: "campaigns",
    status: "mapped",
    notes: "Partial; workflow/task/pitch integration remains open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Campaign", "Campaign Name"],
        postgresSql: `select id::text as record_id, campaign_name as value from ${qname("campaigns")} where campaign_name is not null`,
      },
    ],
  },
  {
    airtable: "Royalties / Revenue",
    postgres: "royalties_revenue",
    status: "mapped",
    notes: "Flat record store only; real money pipeline is still missing.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Record Name", "Statement"],
        postgresSql: `select id::text as record_id, record_name as value from ${qname("royalties_revenue")} where record_name is not null`,
      },
    ],
  },
  {
    airtable: "Media Assets",
    postgres: "media_assets",
    status: "mapped",
    notes: "Partial; upload workflow and usage/rights fields remain open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Asset", "Asset Name"],
        postgresSql: `select id::text as record_id, asset_name as value from ${qname("media_assets")} where asset_name is not null`,
      },
    ],
  },
  {
    airtable: "Compositions (Works)",
    status: "missing",
    notes: "Deliberately deferred while current architecture keeps one works table.",
  },
  {
    airtable: "Sheet",
    postgres: "royalty_earnings",
    sourceIdSql: `
      select source_row_id::text as source_record_id, id::text as canonical_record_id
      from ${qname("royalty_earnings")}
      where org_id = $1 and source = 'airtable_sheet'
    `,
    status: "mapped",
    notes: "Imported by scripts/royalty-sheet-import.ts with ISRC attribution and unresolved-match status.",
    large: true,
  },
  {
    airtable: "Documents",
    postgres: "documents",
    status: "mapped",
    notes: "Partial; file/legal workflow depth remains open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Document", "Document Name"],
        postgresSql: `select id::text as record_id, name as value from ${qname("documents")} where name is not null`,
      },
    ],
  },
  {
    airtable: "Side Artists",
    postgres: "side_artists",
    status: "mapped",
    notes: "Schema exists; release workflow integration remains open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Side Artist", "Artist"],
        postgresSql: `select id::text as record_id, name as value from ${qname("side_artists")} where name is not null`,
      },
    ],
  },
  {
    airtable: "Artist Metrics",
    status: "missing",
    notes: "Metrics history domain is missing.",
  },
  {
    airtable: "Radio Stations",
    postgres: "radio_stations",
    status: "mapped",
    notes: "Partial; import polish and extra radio fields remain open.",
    checks: [
      {
        label: "name",
        airtableFields: ["Name", "Station", "Station Name"],
        postgresSql: `select id::text as record_id, name as value from ${qname("radio_stations")} where name is not null`,
      },
      {
        label: "call sign",
        airtableFields: ["Call Sign", "Callsign", "Call Letters"],
        postgresSql: `select id::text as record_id, call_sign as value from ${qname("radio_stations")} where call_sign is not null`,
      },
    ],
  },
  {
    airtable: "Campaign Stations",
    postgres: "campaign_stations",
    status: "mapped",
    notes: "Join table exists; campaign outreach UI remains partial.",
  },
  {
    airtable: "Reporting Weeks",
    postgres: "reporting_weeks",
    status: "mapped",
    notes: "Mapped to the reporting calendar used by Today Hub.",
  },
];

async function main() {
  try {
    const metadataByName = await readAirtableMetadata();
    const tableResults = await readAllTableResults(metadataByName);
    const postgresTables = await readPostgresTables(TABLE_SPECS);

    for (const result of tableResults) {
      const canonical = result.spec.postgres ? postgresTables.get(result.spec.postgres) : undefined;
      result.postgresCount = canonical?.count ?? null;
      result.canonicalRecordIds = canonical?.recordIds ?? [];
    }

    const keyChecks = options.countsOnly
      ? []
      : await runKeyChecks(tableResults);
    const sourceIdChecks = options.countsOnly
      ? []
      : await runSourceIdChecks(tableResults);
    const rightsSemantics = options.countsOnly
      ? null
      : collectRightsSemantics(tableResults);
    const integrityChecks = options.countsOnly
      ? []
      : await runSqlChecks(INTEGRITY_CHECKS);
    const readinessChecks = options.countsOnly
      ? []
      : await runSqlChecks(READINESS_CHECKS);

    const report = {
      generatedAt: new Date().toISOString(),
      baseId,
      schema: SCHEMA,
      metadataAvailable: metadataByName.size > 0,
      tableResults: tableResults.map(({ records, ...rest }) => ({
        ...rest,
        sourceRecordIds: records.map((record) => record.id).sort(),
      })),
      keyChecks,
      sourceIdChecks,
      rightsSemantics,
      integrityChecks,
      readinessChecks,
    };

    const output = options.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderMarkdown(report);

    if (options.output) {
      await writeFile(options.output, output);
      console.error(`Wrote ${options.output}`);
    }

    process.stdout.write(output);
  } finally {
    await pool.end();
  }
}

async function readAirtableMetadata(): Promise<Map<string, AirtableTableMetadata>> {
  const url = `https://api.airtable.com/v0/meta/bases/${baseId}/tables`;
  try {
    const data = await airtableJson(url);
    const tables = Array.isArray(data.tables) ? data.tables : [];
    return new Map(
      tables.map((table: AirtableTableMetadata) => [table.name, table]),
    );
  } catch (error) {
    console.error(
      `Airtable metadata unavailable; continuing with known table names. ${errorMessage(error)}`,
    );
    return new Map();
  }
}

async function readAllTableResults(
  metadataByName: Map<string, AirtableTableMetadata>,
): Promise<TableResult[]> {
  const results: TableResult[] = [];

  for (const spec of TABLE_SPECS) {
    const metadata = metadataByName.get(spec.airtable);
    const wantedFields = metadata ? wantedFieldsFor(spec, metadata) : undefined;
    try {
      const { records, truncated } = await readAirtableRecords(spec.airtable, wantedFields);
      results.push({
        spec,
        metadata,
        airtableCount: records.length,
        postgresCount: null,
        truncated,
        records,
        canonicalRecordIds: [],
      });
      console.error(
        `${spec.airtable}: ${records.length}${truncated ? "+" : ""} Airtable records`,
      );
    } catch (error) {
      results.push({
        spec,
        metadata,
        airtableCount: null,
        postgresCount: null,
        truncated: false,
        records: [],
        canonicalRecordIds: [],
        error: errorMessage(error),
      });
    }
  }

  return results;
}

function wantedFieldsFor(spec: TableSpec, metadata: AirtableTableMetadata): string[] {
  const available = new Set(metadata.fields.map((field) => field.name));
  const primaryField = metadata.fields.find((field) => field.id === metadata.primaryFieldId);
  const wanted = new Set<string>();

  if (primaryField) {
    wanted.add(primaryField.name);
  }

  for (const check of spec.checks ?? []) {
    const field = findFieldName(available, check.airtableFields);
    if (field) wanted.add(field);
  }

  if (spec.airtable === "Rights Lines (Roles)") {
    for (const field of [
      "Scope",
      "Rights Scope",
      "Clearance Scope",
      "Clearance Status",
      "Status",
      "Rights Status",
      "Ownership Type",
      "Ownership",
      "Type",
      "Percent Share",
      "% Share",
      "Share",
      "Split %",
      "Share %",
    ]) {
      if (available.has(field)) wanted.add(field);
    }
  }

  return [...wanted];
}

async function readAirtableRecords(
  tableName: string,
  wantedFields?: string[],
): Promise<{ records: AirtableRecord[]; truncated: boolean }> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  const maxRecords = options.maxRecords ?? Number.POSITIVE_INFINITY;

  do {
    const url = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
    );
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);
    for (const field of wantedFields ?? []) {
      url.searchParams.append("fields[]", field);
    }

    const data = await airtableJson(url.toString());
    const page = Array.isArray(data.records) ? data.records : [];
    records.push(...page);
    offset = typeof data.offset === "string" ? data.offset : undefined;
    await sleep(225);
  } while (offset && records.length < maxRecords);

  const truncated = Boolean(offset && records.length >= maxRecords);
  if (records.length > maxRecords) {
    records.length = maxRecords;
  }

  return { records, truncated };
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

    if (response.ok) {
      return response.json();
    }

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

async function readPostgresTables(specs: TableSpec[]): Promise<Map<string, { count: number; recordIds: string[] }>> {
  const tablesByName = new Map<string, { count: number; recordIds: string[] }>();
  const tables = [...new Set(specs.map((spec) => spec.postgres).filter(Boolean))] as string[];

  for (const table of tables) {
    const result = await readOnlyQuery(`select id::text as record_id from ${qname(table)} order by id::text`);
    const recordIds = result.rows.map((row) => String(row.record_id));
    tablesByName.set(table, { count: recordIds.length, recordIds });
  }

  return tablesByName;
}

async function runKeyChecks(tableResults: TableResult[]): Promise<KeyCheckResult[]> {
  const results: KeyCheckResult[] = [];

  for (const result of tableResults) {
    if (result.error || !result.spec.checks?.length) continue;
    const available = new Set(result.metadata?.fields.map((field) => field.name) ?? []);

    for (const check of result.spec.checks) {
      const airtableField =
        findFieldName(available, check.airtableFields) ??
        findFieldNameFromRecords(result.records, check.airtableFields);
      if (!airtableField) {
        results.push({
          table: result.spec.airtable,
          label: check.label,
          airtableField: null,
          airtableKeyCount: 0,
          postgresKeyCount: 0,
          missingInPostgres: [],
          extraInPostgres: [],
          missingInPostgresRecords: [],
          extraInPostgresRecords: [],
        });
        continue;
      }

      const airtableRows = result.records.flatMap((record): ParityKeyRow[] => {
        const value = fieldValues(record.fields[airtableField]).join(" ");
        const normalizedValue = normalizeParityKey(result.spec.airtable, check.label, value);
        if (!normalizedValue) return [];
        return [{ recordId: record.id, normalizedValue, value }];
      });
      const postgresRows = await readPostgresKeyRows(result.spec.airtable, check.label, check.postgresSql);
      const evidence = buildKeyRecordEvidence(airtableRows, postgresRows);

      results.push({
        table: result.spec.airtable,
        label: check.label,
        airtableField,
        airtableKeyCount: new Set(airtableRows.map((row) => row.normalizedValue)).size,
        postgresKeyCount: new Set(postgresRows.map((row) => row.normalizedValue)).size,
        ...evidence,
      });
    }
  }

  return results;
}

async function readPostgresKeyRows(table: string, label: string, sql: string): Promise<ParityKeyRow[]> {
  const result = await readOnlyQuery(sql);
  return result.rows.flatMap((row): ParityKeyRow[] => {
    const value = fieldValues(row.value).join(" ");
    const normalizedValue = normalizeParityKey(table, label, value);
    if (!normalizedValue) return [];
    return [{ recordId: String(row.record_id), normalizedValue, value }];
  });
}

async function runSourceIdChecks(
  tableResults: TableResult[],
): Promise<ParitySourceIdCheck[]> {
  const rows: ParitySourceIdCheck[] = [];

  for (const result of tableResults) {
    if (!result.spec.postgres || result.error) continue;
    const sourceIds = new Set(result.records.map((record) => record.id));
    const importedIds = new Set<string>();
    const preservedIds = new Set<string>();
    const canonicalIds = new Set<string>();

    if (sourceIds.size > 0) {
      const direct = await readOnlyQuery(
        `select id::text as source_record_id from ${qname(result.spec.postgres)} where org_id = $1 and id::text = any($2::text[])`,
        [ORG_ID, [...sourceIds]],
      );
      for (const row of direct.rows) {
        const sourceRecordId = String(row.source_record_id);
        importedIds.add(sourceRecordId);
        preservedIds.add(sourceRecordId);
        canonicalIds.add(sourceRecordId);
      }
    }

    for (const target of result.spec.sourceIdTargets ?? [result.spec.postgres]) {
      const mappings = await readOnlyQuery(
        `
          select mapping.airtable_record_id as source_record_id,
                 mapping.postgres_record_id as canonical_record_id,
                 target.id is not null as target_exists
          from ${qname("airtable_record_mappings")} mapping
          left join ${qname(target)} target
            on target.org_id = mapping.org_id
           and target.id = mapping.postgres_record_id
          where mapping.org_id = $1
            and mapping.airtable_base_id = $2
            and mapping.airtable_table_name = $3
            and mapping.postgres_table_name = $4
        `,
        [ORG_ID, baseId, result.spec.airtable, target],
      );
      for (const row of mappings.rows) {
        const sourceRecordId = String(row.source_record_id);
        if (!sourceIds.has(sourceRecordId)) continue;
        importedIds.add(sourceRecordId);
        canonicalIds.add(String(row.canonical_record_id));
        if (row.target_exists) preservedIds.add(sourceRecordId);
      }
    }

    if (result.spec.sourceIdSql) {
      const nativeIds = await readOnlyQuery(result.spec.sourceIdSql, [ORG_ID]);
      for (const row of nativeIds.rows) {
        const sourceRecordId = String(row.source_record_id);
        if (!sourceIds.has(sourceRecordId)) continue;
        importedIds.add(sourceRecordId);
        preservedIds.add(sourceRecordId);
        canonicalIds.add(String(row.canonical_record_id));
      }
    }

    rows.push({
      airtable: result.spec.airtable,
      postgres: result.spec.postgres,
      preservedIds: preservedIds.size,
      importedRecords: importedIds.size,
      airtableRecords: result.records.length,
      sourceRecordIds: result.records.map((record) => record.id).sort(),
      canonicalRecordIds: [...canonicalIds].sort(),
    });
  }

  return rows;
}

function collectRightsSemantics(tableResults: TableResult[]) {
  const result = tableResults.find((row) => row.spec.airtable === "Rights Lines (Roles)");
  if (!result || result.error) return null;
  const records = result.records;
  const fieldNames = new Set(result.metadata?.fields.map((field) => field.name) ?? []);

  return {
    scopeField: findFieldName(fieldNames, [
      "Scope",
      "Rights Scope",
      "Clearance Scope",
      "Publishing/Master",
      "Universe",
    ]) ?? findFieldNameFromRecords(records, ["Scope", "Rights Scope", "Clearance Scope"]),
    statusField: findFieldName(fieldNames, [
      "Clearance Status",
      "Status",
      "Rights Status",
      "Agreement Status",
    ]) ?? findFieldNameFromRecords(records, ["Clearance Status", "Status", "Rights Status"]),
    ownershipField: findFieldName(fieldNames, [
      "Ownership Type",
      "Ownership",
      "Type",
    ]) ?? findFieldNameFromRecords(records, ["Ownership Type", "Ownership", "Type"]),
    scopes: tallyField(records, [
      "Scope",
      "Rights Scope",
      "Clearance Scope",
      "Publishing/Master",
      "Universe",
    ]),
    statuses: tallyField(records, [
      "Clearance Status",
      "Status",
      "Rights Status",
      "Agreement Status",
    ]),
    ownershipTypes: tallyField(records, ["Ownership Type", "Ownership", "Type"]),
  };
}

const INTEGRITY_CHECKS = [
  {
    label: "Releases with missing artist reference",
    sql: `
      select r.id
      from ${qname("releases")} r
      left join ${qname("artists")} a on a.id = r.artist_id
      where r.artist_id is not null and a.id is null
    `,
  },
  {
    label: "Tracks missing release",
    sql: `select id from ${qname("tracks")} where release_id is null`,
  },
  {
    label: "Tracks with invalid release reference",
    sql: `
      select t.id
      from ${qname("tracks")} t
      left join ${qname("releases")} r on r.id = t.release_id
      where t.release_id is not null and r.id is null
    `,
  },
  {
    label: "Tracks missing work",
    sql: `select id from ${qname("tracks")} where work_id is null`,
  },
  {
    label: "Tracks with invalid work reference",
    sql: `
      select t.id
      from ${qname("tracks")} t
      left join ${qname("works")} w on w.id = t.work_id
      where t.work_id is not null and w.id is null
    `,
  },
  {
    label: "Roles missing work",
    sql: `select id from ${qname("roles")} where work_id is null`,
  },
  {
    label: "Roles with invalid work reference",
    sql: `
      select r.id
      from ${qname("roles")} r
      left join ${qname("works")} w on w.id = r.work_id
      where r.work_id is not null and w.id is null
    `,
  },
  {
    label: "Roles with invalid contact reference",
    sql: `
      select r.id
      from ${qname("roles")} r
      left join ${qname("contacts")} c on c.id = r.contact_id
      where r.contact_id is not null and c.id is null
    `,
  },
  {
    label: "Budget items with invalid release/category reference",
    sql: `
      select b.id
      from ${qname("budget_line_items")} b
      left join ${qname("releases")} r on r.id = b.release_id
      left join ${qname("budget_categories")} c on c.id = b.category_id
      where (b.release_id is not null and r.id is null)
         or (b.category_id is not null and c.id is null)
    `,
  },
  {
    label: "Campaign stations with invalid campaign/station reference",
    sql: `
      select cs.id
      from ${qname("campaign_stations")} cs
      left join ${qname("campaigns")} c on c.id = cs.campaign_id
      left join ${qname("radio_stations")} rs on rs.id = cs.station_id
      where (cs.campaign_id is not null and c.id is null)
         or (cs.station_id is not null and rs.id is null)
    `,
  },
  {
    label: "Documents with invalid linked records",
    sql: `
      select d.id
      from ${qname("documents")} d
      left join ${qname("releases")} r on r.id = d.release_id
      left join ${qname("artists")} a on a.id = d.artist_id
      left join ${qname("contacts")} c on c.id = d.contact_id
      where (d.release_id is not null and r.id is null)
         or (d.artist_id is not null and a.id is null)
         or (d.contact_id is not null and c.id is null)
    `,
  },
  {
    label: "Media assets with invalid linked records",
    sql: `
      select m.id
      from ${qname("media_assets")} m
      left join ${qname("releases")} r on r.id = m.linked_release_id
      left join ${qname("artists")} a on a.id = m.linked_artist_id
      where (m.linked_release_id is not null and r.id is null)
         or (m.linked_artist_id is not null and a.id is null)
    `,
  },
  {
    label: "Ops tasks with invalid linked records",
    sql: `
      select o.id
      from ${qname("ops_tasks")} o
      left join ${qname("releases")} r on r.id = o.linked_release_id
      left join ${qname("artists")} a on a.id = o.linked_artist_id
      where (o.linked_release_id is not null and r.id is null)
         or (o.linked_artist_id is not null and a.id is null)
    `,
  },
];

const READINESS_CHECKS = [
  {
    label: "Tracks marked ready while missing ISRC",
    sql: `select id from ${qname("tracks")} where track_ready = true and isrc is null`,
  },
  {
    label: "Tracks marked ready while missing audio",
    sql: `select id from ${qname("tracks")} where track_ready = true and audio_url is null`,
  },
  {
    label: "Tracks marked ready while missing work",
    sql: `select id from ${qname("tracks")} where track_ready = true and work_id is null`,
  },
  {
    label: "Tracks marked ready while clearance is incomplete",
    sql: `select id from ${qname("tracks")} where track_ready = true and coalesce(clearance_progress, 0) < 1`,
  },
  {
    label: "Tracks that look ready but cache says not ready",
    sql: `
      select id
      from ${qname("tracks")}
      where track_ready = false
        and isrc is not null
        and audio_url is not null
        and work_id is not null
        and coalesce(clearance_progress, 0) >= 1
    `,
  },
  {
    label: "Releases marked ready while missing UPC/EAN",
    sql: `select id from ${qname("releases")} where release_ready = true and upc_ean is null`,
  },
  {
    label: "Releases marked ready while missing cover art",
    sql: `select id from ${qname("releases")} where release_ready = true and cover_art_url is null`,
  },
  {
    label: "Releases marked ready while missing release date",
    sql: `select id from ${qname("releases")} where release_ready = true and release_date is null`,
  },
  {
    label: "Releases marked ready with no tracks",
    sql: `
      select r.id
      from ${qname("releases")} r
      left join ${qname("tracks")} t on t.release_id = r.id
      where r.release_ready = true
      group by r.id
      having count(t.id) = 0
    `,
  },
  {
    label: "Releases marked ready with at least one non-ready track",
    sql: `
      select distinct r.id
      from ${qname("releases")} r
      join ${qname("tracks")} t on t.release_id = r.id
      where r.release_ready = true and coalesce(t.track_ready, false) = false
    `,
  },
];

async function runSqlChecks(
  checks: Array<{ label: string; sql: string }>,
): Promise<SqlCheckResult[]> {
  const results: SqlCheckResult[] = [];
  for (const check of checks) {
    const recordResult = await readOnlyQuery(
      `select id::text from (${check.sql}) issue order by id::text`,
    );
    results.push({
      label: check.label,
      count: recordResult.rows.length,
      samples: recordResult.rows.map((row) => row.id),
    });
  }
  return results;
}

function renderMarkdown(report: any): string {
  const lines: string[] = [];
  const tableResults = report.tableResults as Omit<TableResult, "records">[];
  const missingWithData = tableResults.filter(
    (row) => row.spec.status === "missing" && (row.airtableCount ?? 0) > 0,
  );
  const mappedDeltas = tableResults.filter(
    (row) =>
      row.spec.status === "mapped" &&
      row.airtableCount !== null &&
      row.postgresCount !== null &&
      row.airtableCount !== row.postgresCount,
  );
  const readinessIssues = (report.readinessChecks as SqlCheckResult[]).filter(
    (check) => check.count > 0,
  );

  lines.push("# Airtable / Postgres Parity Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Airtable base: \`${report.baseId}\``);
  lines.push(`Postgres schema: \`${report.schema}\``);
  lines.push(`Airtable metadata available: ${report.metadataAvailable ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Airtable tables checked: ${tableResults.length}`);
  lines.push(`- Missing Postgres domains with Airtable records: ${missingWithData.length}`);
  lines.push(`- Mapped tables with count deltas: ${mappedDeltas.length}`);
  lines.push(`- Readiness cache risk checks failing: ${readinessIssues.length}`);
  lines.push("");

  lines.push("## Table Counts");
  lines.push("");
  lines.push("| Airtable table | Airtable records | Postgres table | Postgres rows | Delta | Status | Notes |");
  lines.push("|---|---:|---|---:|---:|---|---|");
  for (const row of tableResults) {
    const airtableCount = formatCount(row.airtableCount, row.truncated);
    const postgres = row.spec.postgres ?? "";
    const postgresCount = row.postgresCount ?? "";
    const delta =
      row.airtableCount !== null && row.postgresCount !== null
        ? String(row.postgresCount - row.airtableCount)
        : "";
    const status = row.error ? `error: ${escapeCell(row.error)}` : row.spec.status;
    lines.push(
      `| ${escapeCell(row.spec.airtable)} | ${airtableCount} | ${postgres} | ${postgresCount} | ${delta} | ${status} | ${escapeCell(row.spec.notes)} |`,
    );
  }
  lines.push("");

  if (!options.countsOnly) {
    lines.push("## Key Parity Checks");
    lines.push("");
    lines.push("| Airtable table | Key | Airtable field | Airtable keys | Postgres keys | Missing in Postgres | Extra in Postgres |");
    lines.push("|---|---|---|---:|---:|---|---|");
    for (const check of report.keyChecks as KeyCheckResult[]) {
      lines.push(
        `| ${escapeCell(check.table)} | ${escapeCell(check.label)} | ${escapeCell(check.airtableField ?? "not found")} | ${check.airtableKeyCount} | ${check.postgresKeyCount} | ${escapeCell(formatSamples(check.missingInPostgres))} | ${escapeCell(formatSamples(check.extraInPostgres))} |`,
      );
    }
    lines.push("");

    lines.push("## Source ID Preservation");
    lines.push("");
    lines.push("This checks whether records with evidence of import retain tenant-scoped source identity through direct IDs, the Airtable mapping table, or a native provenance field.");
    lines.push("");
    lines.push("| Airtable table | Postgres table | Preserved IDs | Evidenced imports | Airtable records |");
    lines.push("|---|---|---:|---:|---:|");
    for (const check of report.sourceIdChecks as ParitySourceIdCheck[]) {
      lines.push(
        `| ${escapeCell(check.airtable)} | ${check.postgres} | ${check.preservedIds} | ${check.importedRecords} | ${check.airtableRecords} |`,
      );
    }
    lines.push("");

    if (report.rightsSemantics) {
      lines.push("## Airtable Rights Semantics");
      lines.push("");
      lines.push(`- Scope field detected: \`${report.rightsSemantics.scopeField ?? "not found"}\``);
      lines.push(`- Status field detected: \`${report.rightsSemantics.statusField ?? "not found"}\``);
      lines.push(`- Ownership field detected: \`${report.rightsSemantics.ownershipField ?? "not found"}\``);
      lines.push("");
      appendTally(lines, "Scopes", report.rightsSemantics.scopes);
      appendTally(lines, "Clearance Statuses", report.rightsSemantics.statuses);
      appendTally(lines, "Ownership Types", report.rightsSemantics.ownershipTypes);
    }

    appendSqlChecks(lines, "Postgres Integrity Checks", report.integrityChecks);
    appendSqlChecks(lines, "Readiness Cache Risk Checks", report.readinessChecks);

    lines.push("## Recommended Next Actions");
    lines.push("");
    lines.push("1. Migrate or explicitly defer missing Airtable domains that still have live records.");
    lines.push("2. Investigate mapped tables with large count deltas before freezing Airtable.");
    lines.push("3. Repair missing or stale provenance only for records with evidence of import; keep source-only and canonical-native records distinct.");
    lines.push("4. Resolve readiness cache risk checks with `npm run sweep` or targeted service fixes.");
    lines.push("5. Decide Airtable rights semantic mappings for `Neighboring`, `Contacted`, and `Negotiating` before final parity sign-off.");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function appendTally(lines: string[], title: string, tally: Record<string, number>) {
  lines.push(`### ${title}`);
  lines.push("");
  lines.push("| Value | Count |");
  lines.push("|---|---:|");
  for (const [value, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${escapeCell(value)} | ${count} |`);
  }
  if (!Object.keys(tally).length) {
    lines.push("| none detected | 0 |");
  }
  lines.push("");
}

function appendSqlChecks(lines: string[], title: string, checks: SqlCheckResult[]) {
  lines.push(`## ${title}`);
  lines.push("");
  lines.push("| Check | Count | Sample IDs |");
  lines.push("|---|---:|---|");
  for (const check of checks) {
    lines.push(
      `| ${escapeCell(check.label)} | ${check.count} | ${escapeCell(formatSamples(check.samples))} |`,
    );
  }
  lines.push("");
}

function tallyField(records: AirtableRecord[], candidates: string[]): Record<string, number> {
  const field = findFieldNameFromRecords(records, candidates);
  if (!field) return {};
  const tally: Record<string, number> = {};
  for (const record of records) {
    const values = fieldValues(record.fields[field]);
    for (const value of values.length ? values : ["(blank)"]) {
      tally[value] = (tally[value] ?? 0) + 1;
    }
  }
  return tally;
}

function findFieldName(available: Set<string>, candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (available.has(candidate)) return candidate;
  }

  const lower = new Map([...available].map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const exact = lower.get(candidate.toLowerCase());
    if (exact) return exact;
  }

  return null;
}

function findFieldNameFromRecords(
  records: AirtableRecord[],
  candidates: string[],
): string | null {
  const available = new Set<string>();
  for (const record of records) {
    for (const field of Object.keys(record.fields)) {
      available.add(field);
    }
  }
  return findFieldName(available, candidates);
}

function fieldValues(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (Array.isArray(value)) {
    return value.flatMap(fieldValues);
  }
  if (typeof value === "object") {
    return [JSON.stringify(value)];
  }
  return [String(value)];
}

function formatSamples(samples: string[]): string {
  if (!samples.length) return "";
  return samples.join(", ");
}

function formatCount(count: number | null, truncated: boolean): string {
  if (count === null) return "";
  return `${count}${truncated ? "+" : ""}`;
}

function escapeCell(value: unknown): string {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
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
  if (!Number.isFinite(n) || n <= 0) {
    fail(`${name} must be a positive number.`);
  }
  return n;
}

function qname(table: string): string {
  return `${quoteIdent(SCHEMA)}.${quoteIdent(table)}`;
}

function readOnlyQuery(sql: string, values?: unknown[]) {
  if (!sql.trim().toLowerCase().startsWith("select")) {
    fail(`Refusing non-read-only SQL in parity report: ${sql.slice(0, 80)}`);
  }
  return pool.query(sql, values);
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
