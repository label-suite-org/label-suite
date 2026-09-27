import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../../../server/api";
import { extractGrantDocument } from "../../../../../../server/grant-document-extractions";
import { listGrantSupportingDocuments } from "../../../../../../server/grant-supporting-documents";
import { requireCapability, requireOrgId } from "../../../../../../server/tenant";
import { requireSameOrigin } from "../../../../../../server/request-security";

export const prerender = false;

export const POST: APIRoute = async ({ params, request, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireOrgId(locals);
    requireCapability(locals, "grant_documents.mutate");
    const applicationId = params.id;
    const linkId = params.linkId;
    if (!applicationId || !linkId) throw new Error("Application and document link are required");
    const linked = await listGrantSupportingDocuments(orgId, applicationId);
    const document = linked.find((item) => item.id === linkId);
    if (!document) return json({ error: "Supporting document link not found" }, 404);
    return json({ extraction: await extractGrantDocument(orgId, document.document_id) });
  } catch (error) {
    return handleApiError(error);
  }
};
