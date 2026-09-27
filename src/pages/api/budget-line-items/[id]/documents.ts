import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { requireCapability, requireOrgId } from "../../../../server/tenant";
import {
  linkDocumentToLine,
  linkDocumentSchema,
  listDocumentsForLine,
} from "../../../../server/budget-line-documents";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    const orgId = requireCapability(locals, "grant_documents.mutate");
    const budgetLineItemId = params.id;
    if (!budgetLineItemId) {
      return json({ error: "id required" }, 400);
    }
    const body = await parseJson(request, linkDocumentSchema);
    return json(await linkDocumentToLine(orgId, budgetLineItemId, body), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const GET: APIRoute = async ({ params, locals }) => {
  try {
    const orgId = requireOrgId(locals);
    const budgetLineItemId = params.id;
    if (!budgetLineItemId) {
      return json({ error: "id required" }, 400);
    }
    const documents = await listDocumentsForLine(orgId, budgetLineItemId);
    return json({ documents });
  } catch (err) {
    return handleApiError(err);
  }
};
