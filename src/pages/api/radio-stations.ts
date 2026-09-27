import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createRadioStation,
  createRadioStationSchema,
  deleteRadioStation,
  deleteRadioStationSchema,
  updateRadioStation,
  updateRadioStationSchema,
} from "../../server/radio-stations";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, createRadioStationSchema);
    return json(await createRadioStation(orgId, body), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, updateRadioStationSchema);
    return json(await updateRadioStation(orgId, body));
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, deleteRadioStationSchema);
    return json(await deleteRadioStation(orgId, body));
  } catch (err) {
    return handleApiError(err);
  }
};
