import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createOrganization,
  createOrganizationSchema,
  deleteOrganization,
  deleteOrganizationSchema,
  updateOrganization,
  updateOrganizationSchema,
} from "../../server/contacts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, createOrganizationSchema);
    return json(await createOrganization(orgId, input, locals.user?.id ?? null), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, updateOrganizationSchema);
    return json(await updateOrganization(orgId, input, locals.user?.id ?? null));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, deleteOrganizationSchema);
    return json(await deleteOrganization(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
