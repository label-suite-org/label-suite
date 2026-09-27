import type { APIRoute } from "astro";
import { executeCampaignEnrichmentTool } from "../../../../../../../server/campaign-enrichment-tool-execution";

export const prerender = false;

export const POST: APIRoute = ({ request, params }) => executeCampaignEnrichmentTool(request, {
  kind: "submit_proposal",
  itemId: params.id,
});
