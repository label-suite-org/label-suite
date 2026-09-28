import type { APIRoute } from "astro";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import { handleApiError, json } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { matchIsrcToWork, matchIsrcToTrack } from "../../../server/royalties";
import {
  buildImportId,
  buildSourceRowId,
  endOfMonth,
  reportPeriod,
  sha256,
  STEM_IMPORT_SOURCE,
} from "../../../server/royalty-import-core";
import { db } from "../../../lib/db";
import {
  royalties_revenue,
  royalty_earnings,
  royalty_import_currency_totals,
  royalty_imports,
} from "../../../db/schema";

export const prerender = false;

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_STEM_ROWS = 50_000;

// STEM CSV/TSV columns (0-indexed):
// 0: ingest_year, 1: ingest_month, 2: payee_id, 3: account_email, 4: account_name
// 5: type_code, 6: resource_id, 7: upc, 8: isrc, 9: seed_type
// 10: contract_status, 11: title, 12: artists, 13: primary_artists
// 14: contract_id, 15: territory_code, 16: report_year, 17: report_month
// 18: revenue_stream, 19: platform, 20: platform_detail
// 21: downloads, 22: count, 23: percentage, 24: net_earnings

interface StemRow {
  rowIndex: number;
  rawData: Record<string, unknown>;
  isrc: string;
  title: string;
  primary_artists: string;
  type_code: string;
  upc: string;
  platform: string;
  platform_detail: string;
  territory_code: string;
  revenue_stream: string;
  units: number;
  percentage: string | null;
  report_year: number;
  report_month: number;
  net_earnings: string;
}

interface AggregatedRecord {
  isrc: string;
  title: string;
  primary_artists: string;
  type_code: string;
  statement_period: string;
  gross_revenue: number;
  net_revenue: number;
  platform_summary: string;
  revenue_stream: string;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");

    // Parse multipart form data with a bounded CSV/TSV export.
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "No file uploaded" }, 400);
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith(".csv") && !fileName.endsWith(".tsv") && !fileName.endsWith(".txt")) {
      return json({ error: "Please upload a STEM CSV or TSV export. XLSX parsing is disabled for safety." }, 400);
    }

    if (file.size > MAX_FILE_BYTES) {
      return json({ error: "STEM import file is too large. Export a smaller CSV/TSV file." }, 400);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const checksum = sha256(bytes);
    const importId = buildImportId(orgId, STEM_IMPORT_SOURCE, checksum);
    const existingImport = await db
      .select({ id: royalty_imports.id, status: royalty_imports.status, rowCount: royalty_imports.row_count })
      .from(royalty_imports)
      .where(and(eq(royalty_imports.org_id, orgId), eq(royalty_imports.source, STEM_IMPORT_SOURCE), eq(royalty_imports.sha256, checksum)))
      .limit(1);

    if (existingImport[0]?.status === "parsed") {
      return json({
        ok: true,
        duplicate: true,
        import_id: existingImport[0].id,
        rows_imported: existingImport[0].rowCount,
      });
    }

    const rawRows = parseDelimitedRows(text, fileName.endsWith(".tsv") ? "\t" : detectDelimiter(text));

    if (rawRows.length < 2) {
      return json({ error: "STEM import file has no data rows" }, 400);
    }
    if (rawRows.length > MAX_STEM_ROWS + 1) {
      return json({ error: `STEM import has too many rows. Limit is ${MAX_STEM_ROWS.toLocaleString()} data rows.` }, 400);
    }

    const headers = rawRows[0] ?? [];

    // Parse rows (skip header)
    const stemRows: StemRow[] = [];
    for (let i = 1; i < rawRows.length; i++) {
      const r = rawRows[i];
      if (!r || !r[8]) continue; // skip rows without ISRC
      stemRows.push({
        rowIndex: i,
        rawData: Object.fromEntries(headers.map((header, index) => [header || `column_${index}`, r[index] ?? ""])),
        isrc: String(r[8] || "").trim(),
        title: String(r[11] || "").trim(),
        primary_artists: String(r[13] || "").trim(),
        type_code: String(r[5] || "").trim(),
        upc: String(r[7] || "").trim(),
        platform: String(r[19] || "").trim(),
        platform_detail: String(r[20] || "").trim(),
        territory_code: String(r[15] || "").trim(),
        revenue_stream: String(r[18] || "").trim(),
        units: Math.round(Number(r[22]) || Number(r[21]) || 0),
        percentage: canonicalDecimal(r[23], 6),
        report_year: Number(r[16]) || 0,
        report_month: Number(r[17]) || 0,
        net_earnings: canonicalDecimal(r[24], 8) ?? "0.00000000",
      });
    }

    // Aggregate by (isrc, type_code, report_year, report_month)
    const aggMap = new Map<string, AggregatedRecord>();
    for (const row of stemRows) {
      const period = `${row.report_year}-${String(row.report_month).padStart(2, "0")}`;
      const key = `${row.isrc}|${row.type_code}|${period}`;

      if (aggMap.has(key)) {
        const existing = aggMap.get(key)!;
        existing.gross_revenue += Number(row.net_earnings);
        existing.net_revenue += Number(row.net_earnings);
        // Append platform if not already in summary
        if (!existing.platform_summary.includes(row.platform)) {
          existing.platform_summary += `, ${row.platform}`;
        }
      } else {
        aggMap.set(key, {
          isrc: row.isrc,
          title: row.title,
          primary_artists: row.primary_artists,
          type_code: row.type_code,
          statement_period: period,
          gross_revenue: Number(row.net_earnings),
          net_revenue: Number(row.net_earnings),
          platform_summary: row.platform,
          revenue_stream: row.type_code === "EPAY" ? "streaming" : "mechanical",
        });
      }
    }

    // Resolve each unique ISRC once and reuse the result for normalized rows and compatibility rows.
    const matchMap = new Map<string, { workId: string | null; trackId: string | null }>();
    for (const isrc of new Set(stemRows.map((row) => row.isrc))) {
      const [workId, trackId] = await Promise.all([matchIsrcToWork(orgId, isrc), matchIsrcToTrack(orgId, isrc)]);
      matchMap.set(isrc.replace(/[-\s]/g, "").toUpperCase(), { workId, trackId });
    }

    // Prepare compatibility rows with deterministic IDs; the normalized rows below are canonical.
    let matchedCount = 0;
    const values: (typeof royalties_revenue.$inferInsert)[] = [];

    for (const [, agg] of aggMap) {
      const match = matchMap.get(agg.isrc.replace(/[-\s]/g, "").toUpperCase());
      const workId = match?.workId ?? null;
      const trackId = match?.trackId ?? null;

      if (workId) matchedCount++;

      values.push({
        id: `${importId}_legacy_${agg.isrc.replace(/[^A-Za-z0-9]/g, "")}_${agg.statement_period}_${agg.type_code}`.slice(0, 255),
        org_id: orgId,
        record_name: `${agg.title} (${agg.type_code})`,
        statement_period: agg.statement_period,
        source: "STEM",
        artist_id: null, // auto-resolved via work later
        release_id: null,
        gross_revenue: agg.gross_revenue,
        costs: 0,
        net_revenue: agg.net_revenue,
        paid_out: "unpaid",
        payment_date: null,
        notes: `ISRC: ${agg.isrc} | Primary: ${agg.primary_artists} | Platforms: ${agg.platform_summary}`,
        revenue_type: agg.revenue_stream,
        revenue_month: agg.statement_period,
        source_contact_id: null,
        payment_method: null,
        work_id: workId,
        track_id: trackId,
        statement_id: importId,
      });
    }

    const normalizedRows = stemRows.map((row) => {
      const period = reportPeriod(row.report_year, row.report_month);
      const match = matchMap.get(row.isrc.replace(/[-\s]/g, "").toUpperCase());
      return {
        id: `${importId}_earning_${row.rowIndex}`,
        org_id: orgId,
        import_id: importId,
        source_row_id: buildSourceRowId(checksum, row.rowIndex),
        source: STEM_IMPORT_SOURCE,
        report_period: period,
        platform: row.platform || null,
        platform_detail: row.platform_detail || null,
        territory_code: row.territory_code || null,
        revenue_stream: row.revenue_stream || (row.type_code === "EPAY" ? "streaming" : "mechanical"),
        usage_type: row.type_code || null,
        units: row.units,
        percentage: row.percentage,
        net_amount: row.net_earnings,
        currency: "USD",
        isrc: row.isrc || null,
        upc: row.upc || null,
        track_title: row.title || null,
        artist_name: row.primary_artists || null,
        work_id: match?.workId ?? null,
        track_id: match?.trackId ?? null,
        release_id: null,
        artist_id: null,
        match_status: match?.trackId ? "matched_track" : match?.workId ? "matched_work" : "unmatched",
        raw_data: row.rawData,
      } satisfies typeof royalty_earnings.$inferInsert;
    });

    const periods = normalizedRows.map((row) => row.report_period).filter((period): period is string => Boolean(period)).sort();
    const periodStart = periods[0] ? `${periods[0]}-01` : null;
    const periodEnd = periods.at(-1) ? endOfMonth(periods.at(-1)!) : null;
    const netTotalExact = normalizedRows
      .reduce((sum, row) => sum.plus(row.net_amount), new Decimal(0))
      .toFixed(8);

    const duplicate = await db.transaction(async (tx) => {
      await tx.insert(royalty_imports).values({
        id: importId,
        org_id: orgId,
        source: STEM_IMPORT_SOURCE,
        file_name: file.name,
        sha256: checksum,
        period_start: periodStart,
        period_end: periodEnd,
        currency: "USD",
        status: "received",
        row_count: normalizedRows.length,
        matched_count: normalizedRows.filter((row) => row.match_status !== "unmatched").length,
        unmatched_count: normalizedRows.filter((row) => row.match_status === "unmatched").length,
        metadata: {
          parser: "stem-csv-v1",
          compatibility_table: "royalties_revenue",
          currency_source: "STEM export has no currency column; configured USD default",
        },
      }).onConflictDoNothing();

      const [current] = await tx.select({ status: royalty_imports.status, rowCount: royalty_imports.row_count })
        .from(royalty_imports)
        .where(and(eq(royalty_imports.id, importId), eq(royalty_imports.org_id, orgId)))
        .for("update");
      if (current.status === "parsed") {
        return { ok: true, duplicate: true, import_id: importId, rows_imported: current.rowCount };
      }

      await tx.update(royalty_imports).set({ status: "parsing" }).where(eq(royalty_imports.id, importId));
      await tx.delete(royalty_earnings).where(eq(royalty_earnings.import_id, importId));
      for (let index = 0; index < normalizedRows.length; index += 500) {
        const batch = normalizedRows.slice(index, index + 500);
        if (batch.length) await tx.insert(royalty_earnings).values(batch).onConflictDoNothing();
      }
      if (values.length) await tx.insert(royalties_revenue).values(values).onConflictDoNothing();
      await tx.insert(royalty_import_currency_totals).values({
        id: `${importId}_USD`,
        org_id: orgId,
        import_id: importId,
        currency: "USD",
        row_count: normalizedRows.length,
        gross_total: netTotalExact,
        fees_total: "0.00000000",
        net_total: netTotalExact,
      }).onConflictDoNothing();
      await tx.update(royalty_imports).set({ status: "parsed", completed_at: new Date() }).where(eq(royalty_imports.id, importId));
    });

    if (duplicate) return json(duplicate);

    return json({
      ok: true,
      import_id: importId,
      source: STEM_IMPORT_SOURCE,
      sha256: checksum,
      rows_parsed: stemRows.length,
      rows_imported: values.length,
      isrcs_matched: matchedCount,
      isrcs_total: aggMap.size,
      total_net: values.reduce((sum, v) => sum + ((v.net_revenue as number) || 0), 0),
      statement_id: importId,
    }, 201);
  } catch (err) {
    console.error("STEM import error:", err);
    return handleApiError(err);
  }
};

function detectDelimiter(text: string): "," | "\t" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  return tabCount > commaCount ? "\t" : ",";
}

const canonicalDecimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

function canonicalDecimal(value: unknown, scale: number): string | null {
  if (value == null || String(value).trim() === "") return null;
  const input = String(value).trim();
  if (!canonicalDecimalPattern.test(input)) throw new TypeError("STEM amount contains a non-canonical decimal");
  const fraction = input.split(".")[1] ?? "";
  if (fraction.length > scale) throw new RangeError(`STEM amount exceeds scale ${scale}`);
  const [whole] = input.split(".");
  const sign = input.startsWith("-") && Number(input) !== 0 ? "-" : "";
  return `${sign}${whole.replace(/^-/, "")}.${fraction.padEnd(scale, "0")}`;
}

function parseDelimitedRows(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === delimiter) {
      row.push(cell.trim());
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}
