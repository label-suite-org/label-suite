import "dotenv/config";
import { createHash } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { addMoney, createMoney, toDatabaseString } from "../src/server/royalty-engine/money";

const canonicalDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgId = readOption("--org") ?? "true-nature";
const maxRecords = numberOption("--max-records");
const baseId = process.env.AIRTABLE_BASE_ID ?? "appoKM3ylTDhR60LY";
const token = process.env.AIRTABLE_API_KEY ?? process.env.AIRTABLE_PAT ?? process.env.AIRTABLE_TOKEN;
const databaseUrl = process.env.DATABASE_URL;

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npx tsx scripts/royalty-sheet-import.ts [--apply] [--org <org-id>] [--max-records <n>]

Imports Airtable Sheet royalty rows into the normalized royalty ledger.
Dry-run is the default. --apply inserts or refreshes rows by Airtable record ID.`);
  process.exit(0);
}

if (!token) throw new Error("AIRTABLE_API_KEY, AIRTABLE_PAT, or AIRTABLE_TOKEN is required");
if (!databaseUrl) throw new Error("DATABASE_URL is required");

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

interface MatchTarget {
  workId: string | null;
  trackId: string | null;
  releaseId: string | null;
  artistId: string | null;
  status: "matched_track" | "matched_work";
}

interface EarningRow {
  id: string;
  orgId: string;
  importId: string;
  sourceRowId: string;
  source: string;
  reportPeriod: string | null;
  platform: string | null;
  platformDetail: string | null;
  territoryCode: string | null;
  revenueStream: string | null;
  usageType: string | null;
  units: number;
  percentage: string | null;
  netAmount: string;
  currency: string;
  isrc: string | null;
  upc: string | null;
  trackTitle: string | null;
  artistName: string | null;
  workId: string | null;
  trackId: string | null;
  releaseId: string | null;
  artistId: string | null;
  matchStatus: string;
  rawData: Record<string, unknown>;
}

const pool = new Pool({ connectionString: databaseUrl });

try {
  const records = await readAirtableSheet();
  const checksum = createHash("sha256")
    .update(JSON.stringify(records.map((record) => [record.id, record.fields])))
    .digest("hex");
  const importId = `royalty_import_${checksum.slice(0, 24)}`;
  const matchMap = await readIsrcMatches();
  const rows = records.map((record) => {
    try {
      return mapRecord(record, importId, matchMap);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid royalty row";
      throw new Error(`Airtable record ${record.id}: ${message}`);
    }
  });
  const matchedCount = rows.filter((row) => row.matchStatus !== "unmatched").length;
  const unmatchedCount = rows.length - matchedCount;
  const netTotal = sumImportedNetAmounts(rows);
  const periods = rows.map((row) => row.reportPeriod).filter((value): value is string => Boolean(value)).sort();

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    rows: rows.length,
    matched: matchedCount,
    unmatched: unmatchedCount,
    netTotal,
    periodStart: periods[0] ?? null,
    periodEnd: periods.at(-1) ?? null,
    checksum,
  }, null, 2));

  if (apply) {
    await applyRows(rows, {
      importId,
      checksum,
      matchedCount,
      unmatchedCount,
      periodStart: periods[0] ?? null,
      periodEnd: periods.at(-1) ?? null,
    });
    console.log(`Applied ${rows.length} royalty rows.`);
  }
} finally {
  await pool.end();
}

async function readAirtableSheet(): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = [];
  let offset: string | undefined;
  const limit = maxRecords ?? Number.POSITIVE_INFINITY;

  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent("Sheet")}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Airtable Sheet request failed: ${response.status} ${await response.text()}`);
    const data = await response.json() as { records?: AirtableRecord[]; offset?: string };
    records.push(...(data.records ?? []));
    offset = data.offset;
    if (offset && records.length < limit) await new Promise((resolve) => setTimeout(resolve, 225));
  } while (offset && records.length < limit);

  if (records.length > limit) records.length = limit;
  return records;
}

async function readIsrcMatches(): Promise<Map<string, MatchTarget>> {
  const result = await pool.query<{
    isrc: string;
    work_id: string | null;
    track_id: string | null;
    release_id: string | null;
    artist_id: string | null;
  }>(`
    select
      regexp_replace(upper(coalesce(track.isrc, work.isrc)), '[^A-Z0-9]', '', 'g') as isrc,
      coalesce(track.work_id, work.id) as work_id,
      track.id as track_id,
      track.release_id,
      release.artist_id
    from label_suite.works work
    left join label_suite.tracks track
      on track.org_id = work.org_id and track.work_id = work.id
    left join label_suite.releases release
      on release.org_id = work.org_id and release.id = track.release_id
    where work.org_id = $1 and coalesce(track.isrc, work.isrc) is not null
  `, [orgId]);

  const map = new Map<string, MatchTarget>();
  for (const row of result.rows) {
    if (!row.isrc) continue;
    const target: MatchTarget = {
      workId: row.work_id,
      trackId: row.track_id,
      releaseId: row.release_id,
      artistId: row.artist_id,
      status: row.track_id ? "matched_track" : "matched_work",
    };
    const existing = map.get(row.isrc);
    if (!existing || (!existing.trackId && target.trackId)) map.set(row.isrc, target);
  }
  return map;
}

function mapRecord(record: AirtableRecord, importId: string, matchMap: Map<string, MatchTarget>): EarningRow {
  const fields = record.fields;
  const reportYear = integer(fields.report_year);
  const reportMonth = integer(fields.report_month);
  const reportPeriod = reportYear && reportMonth ? `${reportYear}-${String(reportMonth).padStart(2, "0")}` : null;
  const rawIsrc = stringValue(fields.isrc);
  const normalizedIsrc = normalizeIsrc(rawIsrc);
  const match = normalizedIsrc ? matchMap.get(normalizedIsrc) : undefined;
  const currency = currencyValue(fields.currency);

  return {
    id: `airtable_sheet_${record.id}`,
    orgId,
    importId,
    sourceRowId: record.id,
    source: "airtable_sheet",
    reportPeriod,
    platform: stringValue(fields.platform),
    platformDetail: stringValue(fields.platform_detail),
    territoryCode: stringValue(fields.territory_code),
    revenueStream: stringValue(fields.revenue_stream),
    usageType: stringValue(fields.type_code) ?? stringValue(fields.seed_type),
    units: integer(fields.count) ?? integer(fields.downloads) ?? 0,
    percentage: canonicalDecimalString(fields.percentage, 6),
    netAmount: canonicalMoneyString(fields.net_earnings, currency),
    currency,
    isrc: rawIsrc,
    upc: stringValue(fields.upc),
    trackTitle: stringValue(fields.title),
    artistName: stringValue(fields.primary_artists),
    workId: match?.workId ?? null,
    trackId: match?.trackId ?? null,
    releaseId: match?.releaseId ?? null,
    artistId: match?.artistId ?? null,
    matchStatus: match?.status ?? "unmatched",
    rawData: fields,
  };
}

async function applyRows(
  rows: EarningRow[],
  summary: {
    importId: string;
    checksum: string;
    matchedCount: number;
    unmatchedCount: number;
    periodStart: string | null;
    periodEnd: string | null;
  },
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query(`
      insert into label_suite.royalty_imports (
        id, org_id, source, file_name, sha256, period_start, period_end, currency,
        status, row_count, matched_count, unmatched_count, error_count, metadata,
        started_at, completed_at, created_at
      ) values ($1, $2, 'airtable_sheet', 'Airtable Sheet', $3, $4, $5, 'USD',
        'received', $6, $7, $8, 0, $9::jsonb, now(), null, now())
      on conflict (id) do update set
        status = case
          when royalty_imports.status = 'completed'
            and royalty_imports.source = 'airtable_sheet'
            and royalty_imports.id ~ '^royalty_import_[0-9a-f]{24}$'
          then 'parsed'
          else royalty_imports.status
        end,
        row_count = excluded.row_count,
        matched_count = excluded.matched_count,
        unmatched_count = excluded.unmatched_count,
        error_count = excluded.error_count,
        metadata = excluded.metadata,
        completed_at = case
          when royalty_imports.status = 'completed' then now()
          else royalty_imports.completed_at
        end
    `, [
      summary.importId,
      orgId,
      summary.checksum,
      summary.periodStart ? `${summary.periodStart}-01` : null,
      summary.periodEnd ? endOfMonth(summary.periodEnd) : null,
      rows.length,
      summary.matchedCount,
      summary.unmatchedCount,
      JSON.stringify({ airtableBaseId: baseId, table: "Sheet" }),
    ]);

    await client.query(`
      update label_suite.royalty_imports
      set status = 'parsing'
      where id = $1 and status = 'received'
    `, [summary.importId]);

    for (let index = 0; index < rows.length; index += 200) {
      await insertBatch(client, rows.slice(index, index + 200));
    }

    await client.query(`
      update label_suite.royalty_imports
      set status = 'parsed', completed_at = now()
      where id = $1 and status = 'parsing'
    `, [summary.importId]);

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function insertBatch(client: PoolClient, rows: EarningRow[]) {
  const columns = [
    "id", "org_id", "import_id", "source_row_id", "source", "report_period",
    "platform", "platform_detail", "territory_code", "revenue_stream", "usage_type",
    "units", "percentage", "net_amount", "currency", "isrc", "upc", "track_title",
    "artist_name", "work_id", "track_id", "release_id", "artist_id", "match_status", "raw_data",
  ];
  const values: unknown[] = [];
  const tuples = rows.map((row) => {
    const rowValues = [
      row.id, row.orgId, row.importId, row.sourceRowId, row.source, row.reportPeriod,
      row.platform, row.platformDetail, row.territoryCode, row.revenueStream, row.usageType,
      row.units, row.percentage, row.netAmount, row.currency, row.isrc, row.upc, row.trackTitle,
      row.artistName, row.workId, row.trackId, row.releaseId, row.artistId, row.matchStatus,
      JSON.stringify(row.rawData),
    ];
    const placeholders = rowValues.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    placeholders[placeholders.length - 1] += "::jsonb";
    return `(${placeholders.join(",")})`;
  });

  await client.query(`
    insert into label_suite.royalty_earnings (${columns.join(",")})
    values ${tuples.join(",")}
    on conflict (org_id, source, source_row_id) do update set
      import_id = excluded.import_id,
      report_period = excluded.report_period,
      platform = excluded.platform,
      platform_detail = excluded.platform_detail,
      territory_code = excluded.territory_code,
      revenue_stream = excluded.revenue_stream,
      usage_type = excluded.usage_type,
      units = excluded.units,
      percentage = excluded.percentage,
      net_amount = excluded.net_amount,
      currency = excluded.currency,
      isrc = excluded.isrc,
      upc = excluded.upc,
      track_title = excluded.track_title,
      artist_name = excluded.artist_name,
      work_id = excluded.work_id,
      track_id = excluded.track_id,
      release_id = excluded.release_id,
      artist_id = excluded.artist_id,
      match_status = excluded.match_status,
      raw_data = excluded.raw_data,
      updated_at = now()
  `, values);
}

function normalizeIsrc(value: string | null): string {
  return value?.replace(/[^a-z0-9]/gi, "").toUpperCase() ?? "";
}

function stringValue(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function canonicalDecimalInput(value: unknown, fieldName: string, required = false): string | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    if (required) {
      throw new TypeError(`Airtable ${fieldName} must be a non-empty canonical decimal string`);
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new TypeError(`Airtable ${fieldName} must be supplied as a decimal string`);
  }
  const input = value.trim();
  if (!canonicalDecimalPattern.test(input)) {
    throw new TypeError(`Airtable ${fieldName} must be a canonical decimal string`);
  }
  return input;
}

function canonicalDecimalString(value: unknown, scale: number): string | null {
  const input = canonicalDecimalInput(value, "percentage");
  if (input == null) return null;
  const unsigned = input.startsWith("-") ? input.slice(1) : input;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale) {
    throw new RangeError(`Airtable numeric value exceeds scale ${scale}`);
  }
  const isZero = /^0+$/.test(`${whole}${fraction}`);
  const sign = input.startsWith("-") && !isZero ? "-" : "";
  return `${sign}${whole}.${fraction.padEnd(scale, "0")}`;
}

function canonicalMoneyString(value: unknown, currency: string): string {
  const input = canonicalDecimalInput(value, "net_earnings", true)!;
  const fraction = input.split(".")[1] ?? "";
  if (fraction.length > 8) {
    throw new RangeError("Airtable net_earnings exceeds scale 8");
  }
  return toDatabaseString(createMoney(input, royaltyMoneySpec(currency)));
}

function royaltyMoneySpec(currency: string) {
  return {
    currency,
    scale: 8,
    roundingMode: "ROUND_HALF_EVEN",
  } as const;
}

function sumImportedNetAmounts(rows: EarningRow[]): string {
  if (rows.length === 0) return "0.00000000";
  let total = createMoney("0", royaltyMoneySpec(rows[0].currency));
  for (const row of rows) {
    total = addMoney(total, createMoney(row.netAmount, royaltyMoneySpec(row.currency)));
  }
  return toDatabaseString(total);
}

function currencyValue(value: unknown): string {
  return stringValue(value)?.trim().toUpperCase() || "USD";
}

function integer(value: unknown): number | null {
  const number = numberValue(value);
  return number == null ? null : Math.round(number);
}

function endOfMonth(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function readOption(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string): number | undefined {
  const value = readOption(name);
  if (!value) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer`);
  return number;
}
