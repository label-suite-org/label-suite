import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  linkGrantSupportingDocument, linkGrantSupportingDocumentSchema, listGrantSupportingDocuments,
  listGrantDocumentLibrary,
  replaceGrantSupportingDocuments, replaceGrantSupportingDocumentsSchema,
  unlinkGrantSupportingDocument, unlinkGrantSupportingDocumentSchema,
} from "../../../../server/grant-supporting-documents";
import { requireCapability, requireOrgId } from "../../../../server/tenant";
import { requireSameOrigin } from "../../../../server/request-security";

const applicationId = (id: string | undefined) => id ?? "";
export const GET: APIRoute = async ({ params, locals, url }) => {
  try {
    const orgId = requireOrgId(locals);
    const documents = await listGrantSupportingDocuments(orgId, applicationId(params.id));
    const library = url?.searchParams.get("library") === "1" ? await listGrantDocumentLibrary(orgId, applicationId(params.id)) : undefined;
    return json({ documents, ...(library ? { library } : {}) });
  }
  catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ params, request, locals }) => {
  try { requireSameOrigin(request); return json(await linkGrantSupportingDocument(requireCapability(locals, "grant_documents.mutate"), applicationId(params.id), await parseJson(request, linkGrantSupportingDocumentSchema)), 201); }
  catch (error) { return handleApiError(error); }
};
export const PUT: APIRoute = async ({ params, request, locals }) => {
  try { requireSameOrigin(request); return json(await replaceGrantSupportingDocuments(requireCapability(locals, "grant_documents.mutate"), applicationId(params.id), await parseJson(request, replaceGrantSupportingDocumentsSchema))); }
  catch (error) { return handleApiError(error); }
};
export const DELETE: APIRoute = async ({ params, request, locals }) => {
  try { requireSameOrigin(request); const input = await parseJson(request, unlinkGrantSupportingDocumentSchema); return json(await unlinkGrantSupportingDocument(requireCapability(locals, "grant_documents.mutate"), applicationId(params.id), input.link_id)); }
  catch (error) { return handleApiError(error); }
};
