import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createDocument,
  createDocumentSchema,
  deleteDocument,
  deleteDocumentSchema,
  updateDocument,
  updateDocumentSchema,
} from "../../server/documents";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createDocumentSchema);
    return json(await createDocument(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateDocumentSchema);
    return json(await updateDocument(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, deleteDocumentSchema);
    return json(await deleteDocument(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
