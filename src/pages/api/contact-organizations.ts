import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createContactOrganization,
  createContactOrganizationSchema,
  deleteContactOrganization,
  deleteContactOrganizationSchema,
  updateContactOrganization,
  updateContactOrganizationSchema,
} from "../../server/contacts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, createContactOrganizationSchema);
    return json(await createContactOrganization(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, updateContactOrganizationSchema);
    return json(await updateContactOrganization(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, deleteContactOrganizationSchema);
    return json(await deleteContactOrganization(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
