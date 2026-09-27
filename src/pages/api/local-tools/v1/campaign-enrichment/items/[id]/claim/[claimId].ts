import type { APIRoute } from "astro";
import { executeCampaignEnrichmentTool } from "../../../../../../../../server/campaign-enrichment-tool-execution";

export const prerender = false;

export const DELETE: APIRoute = ({ request, params }) => executeCampaignEnrichmentTool(request, {
  kind: "release_item",
  itemId: params.id,
  claimId: params.claimId,
});
