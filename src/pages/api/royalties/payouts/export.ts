import type { APIRoute } from "astro";
import { handleApiError } from "../../../../server/api";
import { getMasterPayoutPreviewCsv } from "../../../../server/royalties-dashboard";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "royalties.mutate");
    const csv = await getMasterPayoutPreviewCsv(orgId);
    const filename = `stem-master-payout-preview-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
};
