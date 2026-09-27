import type { APIRoute } from "astro";
import { executeCampaignEnrichmentTool } from "../../../../../../server/campaign-enrichment-tool-execution";

export const prerender = false;

export const GET: APIRoute = ({ request, params }) => executeCampaignEnrichmentTool(request, {
  kind: "get_item",
  itemId: params.id,
});
