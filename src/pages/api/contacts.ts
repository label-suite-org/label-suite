import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createContact,
  createContactSchema,
  deleteContact,
  deleteContactSchema,
  updateContact,
  updateContactSchema,
} from "../../server/contacts";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, createContactSchema);
    return json(await createContact(orgId, input, locals.user?.id ?? null), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, updateContactSchema);
    return json(await updateContact(orgId, input, locals.user?.id ?? null));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "contacts.mutate");
    const input = await parseJson(request, deleteContactSchema);
    return json(await deleteContact(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
