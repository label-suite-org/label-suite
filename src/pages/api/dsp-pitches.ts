import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import {
  createDspPitch,
  createDspPitchSchema,
  updateDspPitch,
  updateDspPitchSchema,
} from "../../server/dsp-pitches";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createDspPitchSchema);
    return json(await createDspPitch(orgId, input), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateDspPitchSchema);
    return json(await updateDspPitch(orgId, input));
  } catch (err) {
    return handleApiError(err);
  }
};
