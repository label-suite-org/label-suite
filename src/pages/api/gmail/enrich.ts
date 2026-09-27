import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { gmailEnrichmentScanSchema, scanGmailForContactEnrichment } from "../../../server/gmail-enrichment";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const user = locals.user;
    if (!user?.id) return json({ error: "Signed-in user is required" }, 401);

    const input = await parseJson(request, gmailEnrichmentScanSchema);
    return json(await scanGmailForContactEnrichment(orgId, user.id, input));
  } catch (err) {
    return handleApiError(err);
  }
};
