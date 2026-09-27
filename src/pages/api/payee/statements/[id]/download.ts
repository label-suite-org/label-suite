import type { APIRoute } from "astro";
import { handleApiError } from "../../../../../server/api";
import { auditPayeeRead } from "../../../../../server/payee-portal-audit";
import { getPayeeStatementDownload } from "../../../../../server/payee-portal";
import { requirePayeePortal } from "../../../../../server/tenant";

export const prerender = false;

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const identity = requirePayeePortal(locals);
    const statementId = params.id;
    if (!statementId) return new Response("Missing statement id", { status: 400 });
    const statement = await getPayeeStatementDownload(identity.orgId, identity.email, statementId);
    if (!statement) return new Response("Statement not found", { status: 404 });

    await auditPayeeRead({
      orgId: identity.orgId,
      userId: identity.userId,
      action: "payee_portal.statement_download",
      entityType: "royalty_statement",
      entityId: statement.id,
      metadata: { lineCount: statement.lines.length, status: statement.status },
    });

    const rows = [
      ["period_start", statement.periodStart],
      ["period_end", statement.periodEnd],
      ["currency", statement.currency],
      ["status", statement.status],
      ["earnings_amount", statement.earningsAmount],
      ["adjustments_amount", statement.adjustmentsAmount],
      ["payout_amount", statement.payoutAmount],
      ["closing_balance", statement.closingBalance],
      [],
      ["description", "share_percent", "amount"],
      ...statement.lines.map((line) => [line.description ?? "Royalty earning", line.sharePercent ?? "", line.amount]),
    ];
    const body = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    return new Response(`${body}\n`, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="statement-${statement.id}.csv"`,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
};
