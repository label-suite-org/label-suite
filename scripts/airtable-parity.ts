import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { scopedParityTable, compareRecordEvidence, type ParityRecordCheck, buildKeyRecordEvidence, type ParityKeyRecord, type ParityKeyRow, type ParitySourceIdCheck } from "./m0-parity-audit-core";
import { normalizeParityKey, findFieldName, fieldValues, sourceFieldName } from "./airtable-parity-key";

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
  canonicalTable?: string;
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
        postgresSql: `select id::text as record_id, email as value from ${scopedTable("contacts")} where email is not null`,
      },
      {
        label: "name",
        airtableFields: ["Name", "Full Name", "Contact Name"],
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("contacts")} where name is not null`,
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("artists")} where name is not null`,
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
        postgresSql: `select id::text as record_id, title as value from ${scopedTable("releases")} where title is not null`,
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
        postgresSql: `select id::text as record_id, title as value from ${scopedTable("tracks")} where title is not null`,
      },
      {
        label: "isrc",
        airtableFields: ["ISRC", "ISRC Code"],
        postgresSql: `select id::text as record_id, isrc as value from ${scopedTable("tracks")} where isrc is not null`,
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
        postgresSql: `select id::text as record_id, title as value from ${scopedTable("works")} where title is not null`,
      },
      {
        label: "isrc",
        airtableFields: ["ISRC", "ISRC Code"],
        postgresSql: `select id::text as record_id, isrc as value from ${scopedTable("works")} where isrc is not null`,
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("budget_line_items")} where name is not null`,
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("budget_categories")} where name is not null`,
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
        postgresSql: `select id::text as record_id, title as value from ${scopedTable("bugs")} where title is not null`,
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
        postgresSql: `select id::text as record_id, title as value from ${scopedTable("calls")} where title is not null`,
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
        postgresSql: `select id::text as record_id, task_name as value from ${scopedTable("ops_tasks")} where task_name is not null`,
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
        postgresSql: `select id::text as record_id, campaign_name as value from ${scopedTable("campaigns")} where campaign_name is not null`,
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
        postgresSql: `select id::text as record_id, record_name as value from ${scopedTable("royalties_revenue")} where record_name is not null`,
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
        postgresSql: `select id::text as record_id, asset_name as value from ${scopedTable("media_assets")} where asset_name is not null`,
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
      from ${scopedTable("royalty_earnings")}
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("documents")} where name is not null`,
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("side_artists")} where name is not null`,
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
        postgresSql: `select id::text as record_id, name as value from ${scopedTable("radio_stations")} where name is not null`,
      },
      {
        label: "call sign",
        airtableFields: ["Call Sign", "Callsign", "Call Letters"],
        postgresSql: `select id::text as record_id, call_sign as value from ${scopedTable("radio_stations")} where call_sign is not null`,
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

// These fields follow the existing import mappings; no source value authorizes a write.
const RECORD_CHECKS: Record<string, Array<{ column: string; fields: string[]; link?: string; date?: boolean; numeric?: boolean }>> = {
  "Artists": [
    { column: "contact_id", fields: ["Contact", "Primary Contact", "Manager"], link: "contacts" },
    { column: "relationship", fields: ["Relationship", "Artist Relationship"] },
    { column: "pro", fields: ["PRO", "Pro"] },
    { column: "ipi", fields: ["IPI", "IPI Number"] },
  ],
  "Releases (And Artist Events)": [
    { column: "artist_id", fields: ["Artist", "Artists", "Linked Artist"], link: "artists" },
    { column: "release_date", fields: ["Release Date", "Date"], date: true },
    { column: "status", fields: ["Status"] },
  ],
  "Release Tracks": [
    { column: "release_id", fields: ["Release", "Releases", "Release Event"], link: "releases" },
    { column: "work_id", fields: ["WORKS", "Work Title", "Recording", "Master", "Work", "Recordings (Masters)"], link: "works" },
  ],
  "Rights Lines (Roles)": [
    { column: "role", fields: ["Role", "Credit", "Role Type"] },
    { column: "contact_id", fields: ["Contact", "Person", "Contributor", "Payee"], link: "contacts" },
    { column: "work_id", fields: ["WORKS", "Recording", "Master", "Work", "Recordings (Masters)", "Track", "Release Track"], link: "works" },
    { column: "ownership_type", fields: ["Ownership Type", "Ownership", "Type"] },
    { column: "scope", fields: ["Scope", "Rights Scope", "Clearance Scope"] },
    { column: "percent_share", fields: ["Percent Share", "% Share", "Share", "Split %", "Share %"], numeric: true },
    { column: "clearance_status", fields: ["Clearance Status", "Status", "Rights Status"] },
  ],
};

const DIRECTORY_CHECKS = {
  contacts: [
    { column: "name", fields: ["Name", "Full Name", "Contact Name"] },
    { column: "email", fields: ["E-Mail", "Email"] },
    { column: "role", fields: ["Role", "Contact Role"] },
    { column: "company", fields: ["Company", "Organization", "Organisation"] },
  ],
  organizations: [
    { column: "name", fields: ["Name", "Company", "Organization"] },
    { column: "type", fields: ["Role", "Organization Type", "Type"] },
  ],
};

async function runRecordChecks(results: TableResult[]): Promise<{ checks: ParityRecordCheck[]; directoryCounts: TableResult[] }> {
  const checks: ParityRecordCheck[] = [];
  const directoryCounts: TableResult[] = [];
  const mappingRows = await readOnlyQuery(`select airtable_table_name, airtable_record_id, postgres_table_name, postgres_record_id from ${scopedTable("airtable_record_mappings")} where org_id = $1 and airtable_base_id = $2`, [ORG_ID, baseId]);
  const directory = results.find(result => result.spec.airtable === "Contacts" && !result.error);
  if (directory) {
    const rows: Array<Record<string, unknown> & { id: string; record_kind: string }> = [];
    for (const [table, fields] of Object.entries(DIRECTORY_CHECKS)) {
      const result = await readOnlyQuery(`select id, ${fields.map(field => field.column).join(", ")} from ${scopedTable(table)} where org_id = $1`, [ORG_ID]);
      rows.push(...result.rows.map(row => ({ ...row, record_kind: table })));
    }
    const available = new Set(directory.metadata?.fields.map(field => field.name) ?? []);
    const organizationLinks = await readOnlyQuery(`select link.contact_id, link.organization_id from ${scopedTable("contact_organizations")} link join ${scopedTable("contacts")} contact on contact.id = link.contact_id and contact.org_id = link.org_id join ${scopedTable("organizations")} organization on organization.id = link.organization_id and organization.org_id = link.org_id where link.org_id = $1`, [ORG_ID]);
    const typeField = findFieldName(available, ["Type"]) ?? findFieldNameFromRecords(directory.records, ["Type"]);
    const matchedDirectory = new Set<string>();
    for (const [table] of Object.entries(DIRECTORY_CHECKS)) {
      const records = directory.records.filter(record => (fieldValues(typeField ? record.fields[typeField] : null).join(" ").trim().toLowerCase() === "organization" ? "organizations" : "contacts") === table);
      const canonicalRecordIds = rows.filter(row => row.record_kind === table).map(row => row.id).sort();
      directoryCounts.push({ spec: { ...directory.spec, postgres: table }, records, airtableCount: records.length, postgresCount: canonicalRecordIds.length, canonicalRecordIds, truncated: directory.truncated, error: typeField ? undefined : "Directory classification unavailable" });
    }
    for (const record of directory.records) {
      const kind = fieldValues(typeField ? record.fields[typeField] : null).join(" ").trim().toLowerCase() === "organization" ? "organizations" : "contacts";
      // ponytail: scan the small directory; index source mappings if audit volume grows.
      const matches = rows.filter(row => mappingRows.rows.some(mapping =>
        mapping.airtable_table_name === "Contacts" && mapping.airtable_record_id === record.id && mapping.postgres_table_name === row.record_kind && mapping.postgres_record_id === row.id));
      matches.sort((a, b) => `${a.record_kind}:${a.id}`.localeCompare(`${b.record_kind}:${b.id}`));
      checks.push(compareRecordEvidence({ table: "Contacts", canonicalTable: kind, field: "record_kind", sourceRecordId: record.id,
        sourceField: typeField, sourceRawValue: fieldValues(typeField ? record.fields[typeField] : null).join(" ") || null,
        canonicalRecordIds: matches.map(row => `${row.record_kind}:${row.id}`), sourceValue: kind, canonicalValues: matches.map(row => row.record_kind) }, Boolean(typeField)));
      const typedMatches = matches.filter(row => row.record_kind === kind);
      for (const row of typedMatches) matchedDirectory.add(`${row.record_kind}:${row.id}`);
      for (const field of DIRECTORY_CHECKS[kind]) {
        const name = sourceFieldName(record.fields, field.fields, available);
        const values = fieldValues(name ? record.fields[name] : null);
        checks.push(compareRecordEvidence({ table: "Contacts", canonicalTable: kind, field: field.column, sourceRecordId: record.id,
          sourceField: name, sourceRawValue: values.length ? values.join(" ") : null,
          canonicalRecordIds: typedMatches.map(row => row.id), sourceValue: values.length ? values.join(" ").trim() : null,
          canonicalValues: typedMatches.map(row => row[field.column] == null ? null : String(row[field.column]).trim()) }, Boolean(name)));
      }
      if (kind === "contacts") {
        const aliases = ["Related Organization", "Related Company", "From field: Related Company"];
        const name = sourceFieldName(record.fields, aliases, available);
        const sourceIds = fieldValues(name ? record.fields[name] : null);
        const resolved = sourceIds.map(id => rows.filter(row => row.record_kind === "organizations" && (mappingRows.rows.some(mapping => mapping.airtable_table_name === "Contacts" && mapping.airtable_record_id === id && mapping.postgres_table_name === "organizations" && mapping.postgres_record_id === row.id))));
        const comparable = Boolean(name) && resolved.every(matches => matches.length === 1);
        checks.push(compareRecordEvidence({ table: "Contacts", canonicalTable: "contacts", field: "linked_organizations", sourceRecordId: record.id,
          sourceField: name, sourceRawValue: JSON.stringify(sourceIds),
          canonicalRecordIds: typedMatches.map(row => row.id), sourceValue: JSON.stringify(comparable ? [...new Set(resolved.map(matches => matches[0].id))].sort() : sourceIds.sort()),
          canonicalValues: typedMatches.map(row => JSON.stringify([...new Set(organizationLinks.rows.filter(link => link.contact_id === row.id).map(link => String(link.organization_id)))].sort())) }, comparable));
      }
    }
    for (const row of rows.filter(row => !matchedDirectory.has(`${row.record_kind}:${row.id}`))) {
      const columns = ["record_kind", ...DIRECTORY_CHECKS[row.record_kind as keyof typeof DIRECTORY_CHECKS].map(field => field.column), ...(row.record_kind === "contacts" ? ["linked_organizations"] : [])];
      for (const column of columns) {
        const value = column === "linked_organizations" ? JSON.stringify([...new Set(organizationLinks.rows.filter(link => link.contact_id === row.id).map(link => String(link.organization_id)))].sort()) : row[column];
        checks.push(compareRecordEvidence({ table: "Contacts", canonicalTable: row.record_kind, field: column, sourceRecordId: null, sourceValue: null,
          canonicalRecordIds: [row.id], canonicalValues: [value == null ? null : String(value).trim()] }));
      }
    }
  }
  const links = new Map<string, Map<string, Set<string>>>();
  for (const table of new Set(Object.values(RECORD_CHECKS).flatMap(fields => fields.flatMap(field => field.link ? [field.link] : [])))) {
    const ids = await readOnlyQuery(`select id from ${scopedTable(table)} where org_id = $1`, [ORG_ID]);
    const live = new Set(ids.rows.map(row => String(row.id)));
    const map = new Map<string, Set<string>>();
    for (const row of mappingRows.rows) {
      if (row.postgres_table_name !== table || !live.has(String(row.postgres_record_id))) continue;
      const source = String(row.airtable_record_id);
      map.set(source, new Set([...(map.get(source) ?? []), String(row.postgres_record_id)]));
    }
    links.set(table, map);
  }
  // Rights may link through a release track, as in the existing importer.
  const trackWorks = await readOnlyQuery(`select mapping.airtable_record_id, track.work_id from ${scopedTable("airtable_record_mappings")} mapping join ${scopedTable("tracks")} track on track.org_id = mapping.org_id and track.id = mapping.postgres_record_id join ${scopedTable("works")} work on work.org_id = track.org_id and work.id = track.work_id where mapping.org_id = $1 and mapping.airtable_base_id = $2 and mapping.airtable_table_name = 'Release Tracks' and mapping.postgres_table_name = 'tracks'`, [ORG_ID, baseId]);
  const works = links.get("works")!;
  for (const row of trackWorks.rows) {
    const source = String(row.airtable_record_id);
    works.set(source, new Set([...(works.get(source) ?? []), String(row.work_id)]));
  }
  for (const result of results) {
    const fields = RECORD_CHECKS[result.spec.airtable];
    const table = result.spec.postgres;
    if (!fields || !table || result.error) continue;
    const canonical = await readOnlyQuery(`select id, ${fields.map(field => field.column).join(", ")} from ${scopedTable(table)} where org_id = $1`, [ORG_ID]);
    const byId = new Map(canonical.rows.map(row => [String(row.id), row]));
    const available = new Set(result.metadata?.fields.map(field => field.name) ?? []);
    const matchedCanonical = new Set<string>();
    for (const record of result.records) {
      const ids = new Set<string>();
      for (const row of mappingRows.rows) {
        if (row.airtable_table_name === result.spec.airtable && row.postgres_table_name === table && row.airtable_record_id === record.id && byId.has(String(row.postgres_record_id))) ids.add(String(row.postgres_record_id));
      }
      const canonicalRecordIds = [...ids].sort();
      for (const id of canonicalRecordIds) matchedCanonical.add(id);
      for (const field of fields) {
        const name = sourceFieldName(record.fields, field.fields, available);
        const values = name ? fieldValues(record.fields[name]) : [];
        let sourceValue = values.length ? values.join(" ").trim() : null;
        let comparable = Boolean(name);
        if (field.numeric && sourceValue !== null) {
          const numeric = Number(sourceValue.replace(/[%,$]/g, "").trim());
          comparable = comparable && Number.isFinite(numeric);
          if (comparable) sourceValue = String(numeric);
        }
        if (field.date && sourceValue) sourceValue = sourceValue.slice(0, 10);
        if (field.link && values.length) {
          const targets = values.length === 1 ? [...(links.get(field.link)?.get(values[0]) ?? [])] : [];
          comparable = comparable && targets.length === 1;
          if (comparable) sourceValue = targets[0];
        }
        const canonicalValues = canonicalRecordIds.map(id => {
          const value = byId.get(id)![field.column];
          return value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim();
        });
        checks.push(compareRecordEvidence({ table: result.spec.airtable, canonicalTable: table, field: field.column, sourceRecordId: record.id, sourceField: name, sourceRawValue: values.length ? values.join(" ") : null, canonicalRecordIds, sourceValue, canonicalValues }, comparable));
      }
    }
    for (const row of canonical.rows.filter(row => !matchedCanonical.has(String(row.id)))) {
      for (const field of fields) {
        const value = row[field.column];
        checks.push(compareRecordEvidence({ table: result.spec.airtable, canonicalTable: table, field: field.column, sourceRecordId: null, sourceValue: null,
          canonicalRecordIds: [String(row.id)], canonicalValues: [value == null ? null : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).trim()] }));
      }
    }
  }
  return { checks, directoryCounts };
}

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

    const recordEvidence = options.countsOnly ? { checks: [], directoryCounts: [] } : await runRecordChecks(tableResults);
    const identityTables = [...tableResults.filter(result => result.spec.airtable !== "Contacts"), ...recordEvidence.directoryCounts.map(result => ({
      ...result, spec: { ...result.spec, sourceIdTargets: [result.spec.postgres!], checks: [{ label: "name", airtableFields: ["Name", "Full Name", "Contact Name"], postgresSql: `select id::text as record_id, name as value from ${scopedTable(result.spec.postgres!)} where name is not null` },
        ...(result.spec.postgres === "contacts" ? [{ label: "email", airtableFields: ["Email", "E-mail"], postgresSql: `select id::text as record_id, email as value from ${scopedTable("contacts")} where email is not null` }] : [])] },
    }))];
    const keyChecks = options.countsOnly
      ? []
      : await runKeyChecks(identityTables);
    const sourceIdChecks = options.countsOnly
      ? []
      : await runSourceIdChecks(identityTables);
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
      orgId: ORG_ID,
      metadataAvailable: metadataByName.size > 0,
      tableResults: tableResults.map(({ records, ...rest }) => ({
        ...rest,
        sourceRecordIds: records.map((record) => record.id).sort(),
      })),
      keyChecks,
      sourceIdChecks,
      rightsSemantics,
      recordChecks: recordEvidence.checks,
      directoryCounts: recordEvidence.directoryCounts.map(({ records, ...rest }) => ({ ...rest, sourceRecordIds: records.map(record => record.id).sort() })),
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

  for (const field of (RECORD_CHECKS[spec.airtable] ?? []).flatMap(check => check.fields)) {
    const actual = findFieldName(available, [field]);
    if (actual) wanted.add(actual);
  }

  if (spec.airtable === "Contacts") {
    for (const field of ["Type", "Related Organization", "Related Company", "From field: Related Company", ...Object.values(DIRECTORY_CHECKS).flatMap(fields => fields.flatMap(field => field.fields))]) {
      const actual = findFieldName(available, [field]);
      if (actual) wanted.add(actual);
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
    const result = await readOnlyQuery(`select id::text as record_id from ${scopedTable(table)} order by id::text`);
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
          canonicalTable: result.spec.postgres,
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
        const field = sourceFieldName(record.fields, check.airtableFields, available);
        const value = fieldValues(field ? record.fields[field] : null).join(" ");
        const normalizedValue = normalizeParityKey(result.spec.airtable, check.label, value);
        if (!normalizedValue) return [];
        return [{ recordId: record.id, normalizedValue, value }];
      });
      const postgresRows = await readPostgresKeyRows(result.spec.airtable, check.label, check.postgresSql);
      const evidence = buildKeyRecordEvidence(airtableRows, postgresRows);

      results.push({
        table: result.spec.airtable,
        canonicalTable: result.spec.postgres,
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
        `select id::text as source_record_id from ${scopedTable(result.spec.postgres)} where org_id = $1 and id::text = any($2::text[])`,
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
          from ${scopedTable("airtable_record_mappings")} mapping
          left join ${scopedTable(target)} target
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
      from ${scopedTable("releases")} r
      left join ${scopedTable("artists")} a on a.id = r.artist_id
      where r.artist_id is not null and a.id is null
    `,
  },
  {
    label: "Tracks missing release",
    sql: `select id from ${scopedTable("tracks")} where release_id is null`,
  },
  {
    label: "Tracks with invalid release reference",
    sql: `
      select t.id
      from ${scopedTable("tracks")} t
      left join ${scopedTable("releases")} r on r.id = t.release_id
      where t.release_id is not null and r.id is null
    `,
  },
  {
    label: "Tracks missing work",
    sql: `select id from ${scopedTable("tracks")} where work_id is null`,
  },
  {
    label: "Tracks with invalid work reference",
    sql: `
      select t.id
      from ${scopedTable("tracks")} t
      left join ${scopedTable("works")} w on w.id = t.work_id
      where t.work_id is not null and w.id is null
    `,
  },
  {
    label: "Roles missing work",
    sql: `select id from ${scopedTable("roles")} where work_id is null`,
  },
  {
    label: "Roles with invalid work reference",
    sql: `
      select r.id
      from ${scopedTable("roles")} r
      left join ${scopedTable("works")} w on w.id = r.work_id
      where r.work_id is not null and w.id is null
    `,
  },
  {
    label: "Roles with invalid contact reference",
    sql: `
      select r.id
      from ${scopedTable("roles")} r
      left join ${scopedTable("contacts")} c on c.id = r.contact_id
      where r.contact_id is not null and c.id is null
    `,
  },
  {
    label: "Budget items with invalid release/category reference",
    sql: `
      select b.id
      from ${scopedTable("budget_line_items")} b
      left join ${scopedTable("releases")} r on r.id = b.release_id
      left join ${scopedTable("budget_categories")} c on c.id = b.category_id
      where (b.release_id is not null and r.id is null)
         or (b.category_id is not null and c.id is null)
    `,
  },
  {
    label: "Campaign stations with invalid campaign/station reference",
    sql: `
      select cs.id
      from ${scopedTable("campaign_stations")} cs
      left join ${scopedTable("campaigns")} c on c.id = cs.campaign_id
      left join ${scopedTable("radio_stations")} rs on rs.id = cs.station_id
      where (cs.campaign_id is not null and c.id is null)
         or (cs.station_id is not null and rs.id is null)
    `,
  },
  {
    label: "Documents with invalid linked records",
    sql: `
      select d.id
      from ${scopedTable("documents")} d
      left join ${scopedTable("releases")} r on r.id = d.release_id
      left join ${scopedTable("artists")} a on a.id = d.artist_id
      left join ${scopedTable("contacts")} c on c.id = d.contact_id
      where (d.release_id is not null and r.id is null)
         or (d.artist_id is not null and a.id is null)
         or (d.contact_id is not null and c.id is null)
    `,
  },
  {
    label: "Media assets with invalid linked records",
    sql: `
      select m.id
      from ${scopedTable("media_assets")} m
      left join ${scopedTable("releases")} r on r.id = m.linked_release_id
      left join ${scopedTable("artists")} a on a.id = m.linked_artist_id
      where (m.linked_release_id is not null and r.id is null)
         or (m.linked_artist_id is not null and a.id is null)
    `,
  },
  {
    label: "Ops tasks with invalid linked records",
    sql: `
      select o.id
      from ${scopedTable("ops_tasks")} o
      left join ${scopedTable("releases")} r on r.id = o.linked_release_id
      left join ${scopedTable("artists")} a on a.id = o.linked_artist_id
      where (o.linked_release_id is not null and r.id is null)
         or (o.linked_artist_id is not null and a.id is null)
    `,
  },
];

const READINESS_CHECKS = [
  {
    label: "Tracks marked ready while missing ISRC",
    sql: `select id from ${scopedTable("tracks")} where track_ready = true and isrc is null`,
  },
  {
    label: "Tracks marked ready while missing audio",
    sql: `select id from ${scopedTable("tracks")} where track_ready = true and audio_url is null`,
  },
  {
    label: "Tracks marked ready while missing work",
    sql: `select id from ${scopedTable("tracks")} where track_ready = true and work_id is null`,
  },
  {
    label: "Tracks marked ready while clearance is incomplete",
    sql: `select id from ${scopedTable("tracks")} where track_ready = true and coalesce(clearance_progress, 0) < 1`,
  },
  {
    label: "Tracks that look ready but cache says not ready",
    sql: `
      select id
      from ${scopedTable("tracks")}
      where track_ready = false
        and isrc is not null
        and audio_url is not null
        and work_id is not null
        and coalesce(clearance_progress, 0) >= 1
    `,
  },
  {
    label: "Releases marked ready while missing UPC/EAN",
    sql: `select id from ${scopedTable("releases")} where release_ready = true and upc_ean is null`,
  },
  {
    label: "Releases marked ready while missing cover art",
    sql: `select id from ${scopedTable("releases")} where release_ready = true and cover_art_url is null`,
  },
  {
    label: "Releases marked ready while missing release date",
    sql: `select id from ${scopedTable("releases")} where release_ready = true and release_date is null`,
  },
  {
    label: "Releases marked ready with no tracks",
    sql: `
      select r.id
      from ${scopedTable("releases")} r
      left join ${scopedTable("tracks")} t on t.release_id = r.id
      where r.release_ready = true
      group by r.id
      having count(t.id) = 0
    `,
  },
  {
    label: "Releases marked ready with at least one non-ready track",
    sql: `
      select distinct r.id
      from ${scopedTable("releases")} r
      join ${scopedTable("tracks")} t on t.release_id = r.id
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

function scopedTable(table: string): string {
  return scopedParityTable(SCHEMA, table, ORG_ID);
}

function readOnlyQuery(sql: string, values?: unknown[]) {
  if (!sql.trim().toLowerCase().startsWith("select")) {
    fail(`Refusing non-read-only SQL in parity report: ${sql.slice(0, 80)}`);
  }
  return pool.query(sql, values);
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
