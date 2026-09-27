import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import {
  listContactEnrichmentSuggestions,
  updateContactEnrichmentSuggestion,
  updateEnrichmentSuggestionSchema,
} from "../../server/gmail-enrichment";
import { requireCapability, requireOrgId } from "../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    const contactId = url.searchParams.get("contact_id") ?? undefined;
    return json({ suggestions: await listContactEnrichmentSuggestions(orgId, contactId) });
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, updateEnrichmentSuggestionSchema);
    return json(await updateContactEnrichmentSuggestion(orgId, input, locals.user?.id ?? null));
  } catch (err) {
    return handleApiError(err);
  }
};
