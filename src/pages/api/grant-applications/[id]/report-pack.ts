import type { APIRoute } from "astro";
import { getGrantReportPack, reportPackCsv } from "../../../../server/grant-report-pack";
import { handleApiError, json } from "../../../../server/api";
import { requireOrgId } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ params, locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    if (!params.id) return json({ error: "id required" }, 400);
    const pack = await getGrantReportPack(orgId, params.id);
    if (url.searchParams.get("format") === "csv") {
      return new Response(reportPackCsv(pack), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="grant-report-${params.id}.csv"` } });
    }
    return json(pack);
  } catch (error) {
    return handleApiError(error);
  }
};
