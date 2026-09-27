import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { requireOrgId } from "../../../../server/tenant";
import {
  getBudgetProject,
  getBudgetKpi,
  listBudgetLinesForProject,
  listFundingSources,
} from "../../../../server/budget-dashboard";

export const prerender = false;

// ─── CSV escaping ──────────────────────────────────────
function csvEscape(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  // If it contains commas, quotes, or newlines, wrap in quotes and double any internal quotes
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  return lines.join("\r\n");
}

function xmlEscape(val: unknown): string {
  if (val == null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toExcelXml(headers: string[], rows: Record<string, unknown>[]): string {
  const headerCells = headers.map((header) => `<Cell><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`).join("");
  const bodyRows = rows.map((row) => {
    const cells = headers.map((header) => {
      const value = row[header];
      const isNumber = typeof value === "number" && Number.isFinite(value);
      return `<Cell><Data ss:Type="${isNumber ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
    }).join("");
    return `<Row>${cells}</Row>`;
  }).join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Budget">
    <Table>
      <Row>${headerCells}</Row>
      ${bodyRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

// ─── Export route ──────────────────────────────────────
export const GET: APIRoute = async ({ params, locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    const projectId = params.projectId;
    if (!projectId) {
      return json({ error: "projectId required" }, 400);
    }

    const format = url.searchParams.get("format") ?? "json";
    if (format !== "csv" && format !== "json" && format !== "xls") {
      return json({ error: "format must be csv, json, or xls" }, 400);
    }

    const project = await getBudgetProject(orgId, projectId);
    if (!project) {
      return json({ error: "project not found" }, 404);
    }

    const [lines, funding, kpi] = await Promise.all([
      listBudgetLinesForProject(orgId, projectId),
      listFundingSources(orgId, projectId),
      getBudgetKpi(orgId, projectId),
    ]);

    if (format === "csv" || format === "xls") {
      const exportHeaders = [
        "line_name",
        "category_type",
        "category_name",
        "phase",
        "spend_month",
        "planned",
        "forecast",
        "committed",
        "paid",
        "status",
        "lock_status",
        "eligibility_tag",
        "variance_reason",
        "funding_source",
      ];

      const exportRows = lines.map((l) => ({
        line_name: l.name,
        category_type: l.category_type ?? "",
        category_name: l.category_name ?? "",
        phase: l.phase ?? "",
        spend_month: l.spend_month ?? "",
        planned: l.planned_amount ?? 0,
        forecast: l.forecast_amount ?? 0,
        committed: l.committed_amount ?? 0,
        paid: l.paid_amount ?? 0,
        status: l.status ?? "",
        lock_status: l.lock_status ?? "",
        eligibility_tag: l.eligibility_tag ?? "",
        variance_reason: l.variance_reason ?? "",
        funding_source: l.funding_source_name ?? "",
      }));

      if (format === "xls") {
        const xmlContent = toExcelXml(exportHeaders, exportRows);
        return new Response(xmlContent, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.ms-excel; charset=utf-8",
            "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_budget.xls"`,
          },
        });
      }

      const csvContent = toCsv(exportHeaders, exportRows);

      return new Response(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}_budget.csv"`,
        },
      });
    }

    // JSON export
    const exportData = {
      project,
      kpi,
      lines: lines.map((l) => ({
        id: l.id,
        name: l.name,
        amount: l.amount,
        planned_amount: l.planned_amount,
        forecast_amount: l.forecast_amount,
        committed_amount: l.committed_amount,
        paid_amount: l.paid_amount,
        phase: l.phase,
        spend_month: l.spend_month,
        status: l.status,
        lock_status: l.lock_status,
        eligibility_tag: l.eligibility_tag,
        variance_reason: l.variance_reason,
        category_name: l.category_name,
        category_type: l.category_type,
        funding_source_id: l.funding_source_id,
        funding_source_name: l.funding_source_name,
      })),
      funding: funding.map((f) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        status: f.status,
        amount_planned: f.amount_planned,
        amount_confirmed: f.amount_confirmed,
        restricted_to: f.restricted_to,
        funder: f.funder,
        deadline: f.deadline,
        notes: f.notes,
      })),
    };

    return json(exportData);
  } catch (err) {
    return handleApiError(err);
  }
};
