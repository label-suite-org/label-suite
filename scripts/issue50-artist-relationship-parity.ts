import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { Pool, type QueryResultRow } from "pg";

const DEFAULT_BASE_ID = "appoKM3ylTDhR60LY";
const DEFAULT_SCHEMA = process.env.AIRTABLE_PARITY_DB_SCHEMA ?? "label_suite";
const PAGE_SIZE = 100;
const DEFAULT_ORG_ID = process.env.ARTIST_RELATIONSHIP_ORG_ID ?? "true-nature";
const DEFAULT_REPORT_PATH = "docs/audit/issue-50-artist-relationship-parity.md";

type AirtableFieldValue = string | number | boolean | null | undefined | AirtableFieldValue[] | AirtableRecord[];

interface AirtableRecord {
  id: string;
  fields: Record<string, AirtableFieldValue>;
}

interface AirtableSnapshot {
  baseId: string;
  generatedAt?: string;
  tables: Record<string, AirtableRecord[]>;
}

interface SuiteArtistRow {
  id: string;
  name: string;
  relationship: string | null;
  contactId: string | null;
  airtableRecordId: string | null;
  updatedAt: string | null;
}

interface SuiteContactRow {
  id: string;
  name: string;
  role: string | null;
  linkedArtistId: string | null;
}

interface SuiteContributorRoleSummary {
  contactId: string;
  contactName: string;
  roles: string[];
}

interface Issue50Report {
  generatedAt: string;
  orgId: string;
  baseId: string;
  dataSourceMode: {
    configuredMode: string;
    migrationMode: string;
    note: string;
  };
  suite: {
    artistCountByRelationship: Record<string, number>;
    artistsWithoutContactCount: number;
    linkedArtistContactCount: number;
    contactCount: number;
    contactsWithArtistLinks: number;
    contributorContactsWithNoArtistProfile: number;
    duplicateContactLinks: string[];
  };
  airtable: {
    artistRecordCount: number;
    artistsWithBlankNameCount: number;
    artistsWithContactLinkCount: number;
    blankPlaceholderRecords: string[];
  };
  issues: {
    unmappedSuiteArtists: Array<{ id: string; name: string; relationship: string | null }>;
    suiteArtistsMissingContact: Array<{ id: string; name: string; relationship: string | null; airtableRecordId?: string }>;
    airtableUnmappedRecords: Array<{ id: string; name: string; hasContactLink: boolean }>;
    contributorContactsUnlinked: Array<{ id: string; name: string; roles: string[] }>;
  };
  unresolvedReviewList: string[];
}

const CONTRIB_ROLES = new Set([
  "main artist",
  "songwriter",
  "co-writer",
  "composer",
  "lyrics",
  "producer",
  "co. producer",
  "executive producer",
  "master owner",
  "rights",
  "mixing engineer",
  "mastering engineer",
]);

const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run issue50:parity -- [options]

Generates a focused Artist relationship parity report and unresolved-review items for Issue #50.

Options:
  --output <path>      Write markdown report to path in addition to stdout.
                       Defaults to ${DEFAULT_REPORT_PATH} for markdown output.
  --json               Emit raw JSON instead of markdown.
  --base <id>          Airtable base id (defaults to ${DEFAULT_BASE_ID}).
  --org <id>           Tenant/org id (defaults to ${DEFAULT_ORG_ID}).
  --schema <name>      DB schema (defaults to ${DEFAULT_SCHEMA}).
  --snapshot <path>    Read Airtable records from saved snapshot JSON instead of API.
  --max-records <n>    Limit Airtable artist records fetched (for speed / lower-cost preview).

Safety:
  Airtable calls are GET-only and Postgres calls are SELECT-only.
  Postgres is required for this command because suite counts and mappings are sourced from Label Suite.
`);
  process.exit(0);
}

const options = {
  output: stringOption("--output") ?? (args.includes("--json") ? undefined : DEFAULT_REPORT_PATH),
  json: args.includes("--json"),
  baseId: stringOption("--base") ?? process.env.AIRTABLE_BASE_ID ?? DEFAULT_BASE_ID,
  orgId: stringOption("--org") ?? DEFAULT_ORG_ID,
  schema: stringOption("--schema") ?? DEFAULT_SCHEMA,
  snapshot: stringOption("--snapshot"),
  maxRecords: numberOption("--max-records"),
};

const token = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_TOKEN;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  fail("DATABASE_URL is required (suite reads and mappings are loaded from Label Suite DB).");
}

if (!options.snapshot && !token) {
  fail("AIRTABLE_API_KEY, AIRTABLE_PAT, or AIRTABLE_TOKEN is required when not using --snapshot.");
}

const pool = databaseUrl ? new Pool({ connectionString: databaseUrl }) : null;

main()
  .then(async () => {
    await pool?.end();
  })
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    await pool?.end();
    process.exit(1);
  });

async function main() {
  const qname = (name: string) => `${quoteIdent(options.schema)}.${quoteIdent(name)}`;
  const artists = await readSuiteArtists(qname);
  const contacts = await readSuiteContacts(qname);
  const mapping = await readArtistMappings(qname);
  const contributorSummaries = await readContributorRoleSummaries(qname);
  const airtableArtists = options.snapshot
    ? await readAirtableSnapshot(options.snapshot)
    : await readAirtableArtists();

  const suiteArtistRows = artists.map((artist) => ({
    ...artist,
    airtableRecordId: mapping.get(artist.id) ?? null,
  }));

  const artistsByAirtableId = new Map<string, SuiteArtistRow>();
  for (const row of suiteArtistRows) {
    if (row.airtableRecordId) {
      artistsByAirtableId.set(row.airtableRecordId, row);
    }
  }

  const suiteArtistsByName = new Map<string, SuiteArtistRow[]>();
  for (const row of suiteArtistRows) {
    suiteArtistsByName.set(normalizeName(row.name), [...(suiteArtistsByName.get(normalizeName(row.name)) ?? []), row]);
  }

  const unmappedSuiteArtists = suiteArtistRows
    .filter((row) => !row.airtableRecordId)
    .map((row) => ({ id: row.id, name: row.name, relationship: row.relationship }));

  const suiteArtistsMissingContact: Array<{ id: string; name: string; relationship: string | null; airtableRecordId?: string }> =
    suiteArtistRows
      .filter((row) => !row.contactId)
      .map((row) => ({
        id: row.id,
        name: row.name,
        relationship: row.relationship,
        ...(row.airtableRecordId ? { airtableRecordId: row.airtableRecordId } : {}),
      }));

  const airtableRows = airtableArtists
    .map((record) => {
      const name = firstText(record.fields, ["Artist", "Artist Name", "Name"])?.trim() ?? "";
      const contactLinks = linkedIds(record.fields, ["Contact", "Primary Contact", "Manager", "Manager Contact", "Source Contact"]);
      return {
        id: record.id,
        name,
        hasContactLink: contactLinks.length > 0,
        blank: name.length === 0,
      };
    })
    .filter((row) => row.id);

  const unmappedAirtableArtists = airtableRows
    .filter((row) => !artistsByAirtableId.has(row.id) && !row.blank)
    .map((row) => ({ id: row.id, name: row.name, hasContactLink: row.hasContactLink }));

  const placeholderAirtableArtists = airtableRows
    .filter((row) => row.blank)
    .map((row) => row.id);

  const nameMismatches: string[] = [];
  for (const record of airtableRows.filter((row) => !row.blank && !artistsByAirtableId.has(row.id))) {
    const normalized = normalizeName(record.name);
    const suiteMatches = suiteArtistsByName.get(normalized) ?? [];
    if (suiteMatches.length === 1) {
      nameMismatches.push(`${record.id}: ${record.name} → candidates ${suiteMatches.map((row) => row.id).join(",")}`);
    }
  }

  const contributorContactsUnlinked = contributorSummaries
    .filter((item) => !artists.some((artist) => artist.contactId === item.contactId))
    .map((item) => ({ id: item.contactId, name: item.contactName, roles: item.roles }));

  const duplicateContactLinks = (() => {
    const contactMap = new Map<string, string[]>();
    for (const row of suiteArtistRows) {
      if (!row.contactId) continue;
      const artistIds = contactMap.get(row.contactId) ?? [];
      artistIds.push(row.id);
      contactMap.set(row.contactId, artistIds);
    }
    return Array.from(contactMap)
      .filter(([, artistIds]) => artistIds.length > 1)
      .map(([contactId, artistIds]) => `${contactId}: ${artistIds.join(",")}`);
  })();

  const suiteCounts = {
    roster: 0,
    collaborator: 0,
    unlabeled: 0,
  };
  for (const artist of suiteArtistRows) {
    if (artist.relationship === "roster") suiteCounts.roster += 1;
    else if (artist.relationship === "collaborator") suiteCounts.collaborator += 1;
    else suiteCounts.unlabeled += 1;
  }

  const unresolved: string[] = [];
  if (unmappedSuiteArtists.length) {
    unresolved.push(`${unmappedSuiteArtists.length} artists in Suite without Airtable Artist mapping`);
  }
  if (airtableRows.filter((row) => !row.blank).length !== artistsByAirtableId.size) {
    unresolved.push("Airtable artist rows with no Suite counterpart remain for human review");
  }
  if (contributorContactsUnlinked.length) {
    unresolved.push(`${contributorContactsUnlinked.length} contributor Contacts have no linked Artist record`);
  }
  if (suiteArtistsMissingContact.length) {
    unresolved.push("Suite artists with missing contact links exist");
  }

  const report: Issue50Report = {
    generatedAt: new Date().toISOString(),
    orgId: options.orgId,
    baseId: options.baseId,
    dataSourceMode: {
      configuredMode: process.env.LABEL_SUITE_DATA_SOURCE_MODE ?? "airtable_migration",
      migrationMode: "migration-aware",
      note: "Current active relationship, contact-link, PRO, and IPI authority live on Label Suite artist rows. Airtable remains migration/reference evidence only, and no automatic reclassification is performed.",
    },
    suite: {
      artistCountByRelationship: suiteCounts,
      artistsWithoutContactCount: suiteArtistsMissingContact.length,
      linkedArtistContactCount: suiteArtistRows.filter((row) => row.contactId).length,
      contactCount: contacts.length,
      contactsWithArtistLinks: contacts.filter((contact) => contact.linkedArtistId).length,
      contributorContactsWithNoArtistProfile: contributorContactsUnlinked.length,
      duplicateContactLinks,
    },
    airtable: {
      artistRecordCount: airtableRows.length,
      artistsWithBlankNameCount: placeholderAirtableArtists.length,
      artistsWithContactLinkCount: airtableRows.filter((row) => row.hasContactLink).length,
      blankPlaceholderRecords: placeholderAirtableArtists,
    },
    issues: {
      unmappedSuiteArtists,
      suiteArtistsMissingContact,
      airtableUnmappedRecords: unmappedAirtableArtists,
      contributorContactsUnlinked,
    },
    unresolvedReviewList: [...unresolved, ...nameMismatches],
  };

  const output = options.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : renderMarkdown(report);

  if (options.output) {
    await writeFile(options.output, output, "utf8");
    console.error(`Wrote ${options.output}`);
  }

  process.stdout.write(output);
}

function renderMarkdown(report: Issue50Report): string {
  return [
    `# Issue #50 Artist relationship parity report`,
    ``,
    `Generated: ${report.generatedAt}`,
    `Base: ${report.baseId}`,
    `Org: ${report.orgId}`,
    ``,
    `## Source-of-truth note`,
    ``,
    `- Current mode: ${report.dataSourceMode.configuredMode}`,
    `- This report is read-only and does not write to Airtable or Postgres.`,
    `- Active relationship/contact/PRO/IPI authority lives in Label Suite artist rows; Airtable is used only as migration/reference baseline.`,
    `- Contact-role rows (for example label/org/contact-management records) are shown for review but are not treated as artist identity mappings.`,
    `- Relationship values are interpreted only as current effective values (single active value per Artist).`,
    ``,
    `## Suite summary`,
    ``,
    `- roster: ${report.suite.artistCountByRelationship.roster}`,
    `- collaborator: ${report.suite.artistCountByRelationship.collaborator}`,
    `- unclassified: ${report.suite.artistCountByRelationship.unclassified ?? report.suite.artistCountByRelationship.unlabeled}`,
    `- artist rows without contact links: ${report.suite.artistsWithoutContactCount}`,
    `- contacts with artist links: ${report.suite.contactsWithArtistLinks}/${report.suite.contactCount}`,
    `- contributor contacts with no artist profile: ${report.suite.contributorContactsWithNoArtistProfile}`,
    ``,
    `## Airtable summary`,
    ``,
    `- artist rows in source table: ${report.airtable.artistRecordCount}`,
    `- rows with no obvious artist name (placeholder/blank): ${report.airtable.artistsWithBlankNameCount}`,
    `- rows with contact link fields: ${report.airtable.artistsWithContactLinkCount}`,
    ``,
    `## Unresolved items requiring human review`,
    ``,
    `### Unmapped Suite artists (present in Suite, absent in Airtable mapping)`,
    listOrNone(report.issues.unmappedSuiteArtists.map((item) => `- ${item.name} (${item.id}) [${item.relationship ?? "unclassified"}]`)),
    ``,
    `### Suite artists with missing contact links`,
    listOrNone(report.issues.suiteArtistsMissingContact.map((item) => `- ${item.name} (${item.id}) [${item.relationship ?? "unclassified"}]${item.airtableRecordId ? ` source=${item.airtableRecordId}` : ""}`)),
    ``,
    `### Airtable artist records without Suite equivalent`,
    listOrNone(report.issues.airtableUnmappedRecords.map((item) => `- ${item.name || "<blank>"} (${item.id})${item.hasContactLink ? " [contact-linked]" : ""}`)),
    ``,
    `### Contributor contacts in Suite with no Artist profile`,
    listOrNone(report.issues.contributorContactsUnlinked.map((item) => `- ${item.name} (${item.id}) — ${item.roles.join(", ")}`)),
    ``,
    `### Airtable placeholders that should be excluded from classification`,
    listOrNone(report.airtable.blankPlaceholderRecords.map((id) => `- ${id}`)),
    ``,
    report.unresolvedReviewList.length
      ? ["## Notes for review", "", ...report.unresolvedReviewList.map((item) => `- ${item}`)].join("\n")
      : "",
    "",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function listOrNone(lines: string[]): string {
  return lines.length ? lines.join("\n") : "- None";
}

async function readSuiteArtists(qname: (table: string) => string): Promise<SuiteArtistRow[]> {
  const result = await readOnlyQuery<{
    id: string;
    name: string;
    relationship: string | null;
    contact_id: string | null;
    updated_at: string | null;
    mapping_record_id: string | null;
  }>(
    `
      select a.id, a.name, a.relationship, a.contact_id, a.updated_at, m.airtable_record_id as mapping_record_id
      from ${qname("artists")} a
      left join ${qname("airtable_record_mappings")} m
        on m.org_id = a.org_id
       and m.airtable_base_id = $2
       and m.airtable_table_name = 'Artists'
       and m.postgres_record_id = a.id
      where a.org_id = $1
      order by a.name asc nulls last;
    `,
    [options.orgId, options.baseId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    contactId: row.contact_id,
    airtableRecordId: row.mapping_record_id,
    updatedAt: row.updated_at,
  }));
}

async function readSuiteContacts(qname: (table: string) => string): Promise<SuiteContactRow[]> {
  const result = await readOnlyQuery<{ id: string; name: string; role: string | null; artist_id: string | null }>(
    `
      select c.id, c.name, c.role,
             a.id as artist_id
      from ${qname("contacts")} c
      left join lateral (
        select a2.id
        from ${qname("artists")} a2
        where a2.contact_id = c.id
          and a2.org_id = c.org_id
        order by a2.created_at asc
        limit 1
      ) a(id) on true
      where c.org_id = $1
      order by c.name asc nulls last;
    `,
    [options.orgId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    linkedArtistId: row.artist_id,
  }));
}

async function readArtistMappings(qname: (table: string) => string): Promise<Map<string, string>> {
  const rows = await readOnlyQuery<{ postgres_record_id: string; airtable_record_id: string }>(
    `
      select postgres_record_id, airtable_record_id
      from ${qname("airtable_record_mappings")}
      where org_id = $1
        and airtable_base_id = $2
        and airtable_table_name = 'Artists'
    `,
    [options.orgId, options.baseId],
  );

  const map = new Map<string, string>();
  for (const row of rows.rows) {
    map.set(row.postgres_record_id, row.airtable_record_id);
  }

  return map;
}

async function readContributorRoleSummaries(qname: (table: string) => string): Promise<SuiteContributorRoleSummary[]> {
  const result = await readOnlyQuery<{
    id: string;
    name: string;
    role: string | null;
  }>(
    `
      select c.id, c.name, lower(r.role) as role
      from ${qname("roles")} r
      join ${qname("contacts")} c
        on c.id = r.contact_id
       and c.org_id = r.org_id
      where r.org_id = $1
        and r.contact_id is not null
        and r.role is not null
      order by c.name asc;
    `,
    [options.orgId],
  );

  const grouped = new Map<string, SuiteContributorRoleSummary>();
  for (const row of result.rows) {
    const role = (row.role ?? "").trim().toLowerCase();
    if (!CONTRIB_ROLES.has(role)) continue;
    const existing = grouped.get(row.id);
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
      continue;
    }

    grouped.set(row.id, {
      contactId: row.id,
      contactName: row.name,
      roles: [role],
    });
  }

  return Array.from(grouped.values());
}

async function readAirtableArtists(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  const limit = options.maxRecords;

  do {
    const url = new URL(`https://api.airtable.com/v0/${options.baseId}/${encodeURIComponent("Artists")}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Airtable GET failed (${response.status}): ${body.slice(0, 300)}`);
    }

    const data = await response.json() as { records?: AirtableRecord[]; offset?: string };
    records.push(...(Array.isArray(data.records) ? data.records : []));
    offset = typeof data.offset === "string" ? data.offset : undefined;
    if (limit && records.length >= limit) break;
  } while (offset);

  if (limit && records.length > limit) records.length = limit;

  return records;
}

async function readAirtableSnapshot(snapshotPath: string): Promise<AirtableRecord[]> {
  const raw = await readFile(snapshotPath, "utf8");
  const parsed = JSON.parse(raw) as AirtableSnapshot;
  if (!parsed || !parsed.tables || !Array.isArray(parsed.tables.Artists)) {
    throw new Error("Snapshot must contain tables.Artists as an array of records.");
  }
  return parsed.tables.Artists;
}

async function readOnlyQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: Array<string | number> = [],
): Promise<{ rows: T[] }> {
  if (!pool) throw new Error("DATABASE_URL is required for DB reads.");
  if (!/\b(delete|insert|update|alter|drop|truncate|create|grant|revoke)\b/i.test(text)) {
    const result = await pool.query<T>(text, values);
    return { rows: result.rows as T[] };
  }
  throw new Error("Non-readonly query blocked by script guard.");
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function linkedIds(fields: Record<string, AirtableFieldValue>, candidates: string[]): string[] {
  const out: string[] = [];
  for (const key of candidates) {
    const value = fields[key];
    if (!value) continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item === "object" && "id" in (item as { id?: unknown }) && typeof (item as { id?: unknown }).id === "string") {
          out.push((item as { id: string }).id);
        }
      }
    } else if (typeof value === "string") {
      out.push(value);
    }
  }
  return out;
}

function firstText(fields: Record<string, AirtableFieldValue>, candidates: string[]): string | null {
  for (const key of candidates) {
    const value = fields[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function quoteIdent(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function stringOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function numberOption(name: string): number | undefined {
  const value = stringOption(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
