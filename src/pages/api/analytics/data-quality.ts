import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { analyticsDuplicateReviewSchema, listAnalyticsDataQuality, saveAnalyticsDuplicateReview } from "../../../server/analytics-data-quality";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

type RouteDependencies = {
  requireCapability: typeof requireCapability;
  listAnalyticsDataQuality: typeof listAnalyticsDataQuality;
  saveAnalyticsDuplicateReview: typeof saveAnalyticsDuplicateReview;
};

export function createAnalyticsDataQualityRoute(dependencies: RouteDependencies = {
  requireCapability,
  listAnalyticsDataQuality,
  saveAnalyticsDuplicateReview,
}) {
  const GET: APIRoute = async ({ locals }) => {
    try {
      const orgId = dependencies.requireCapability(locals, "operations.mutate");
      return json(await dependencies.listAnalyticsDataQuality(orgId));
    } catch (error) { return handleApiError(error); }
  };
  const PATCH: APIRoute = async ({ request, locals }) => {
    try {
      const orgId = dependencies.requireCapability(locals, "operations.mutate");
      const reviewedBy = locals.user?.id;
      if (!reviewedBy) return json({ error: "Authenticated reviewer required" }, 401);
      const input = await parseJson(request, analyticsDuplicateReviewSchema);
      await dependencies.saveAnalyticsDuplicateReview({ ...input, orgId, reviewedBy });
      return json({ ok: true });
    } catch (error) { return handleApiError(error); }
  };
  return { GET, PATCH };
}

export const { GET, PATCH } = createAnalyticsDataQualityRoute();
