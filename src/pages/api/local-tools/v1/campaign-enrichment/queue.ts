import type { APIRoute } from "astro";
import { executeCampaignEnrichmentTool } from "../../../../../server/campaign-enrichment-tool-execution";

export const prerender = false;

export const GET: APIRoute = ({ request, url }) => executeCampaignEnrichmentTool(request, {
  kind: "list_queue",
  searchParams: url.searchParams,
});
