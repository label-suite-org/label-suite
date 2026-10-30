import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { getPitch, pitchOptions, savePitch, savePitchFollowup } from "../../../server/pitches";
import { pitchDraftSchema, pitchFollowupSchema } from "../../../lib/pitches";
export const prerender = false;
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), input: pitchDraftSchema }),
  z.object({ action: z.literal("followup"), input: pitchFollowupSchema }),
]);
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const org = requireCapability(locals, "operations.mutate");
    const id = url.searchParams.get("id");
    return json(id ? { pitch: await getPitch(org, id) } : { options: await pitchOptions(org, url.searchParams.get("campaign"), url.searchParams.get("sync"), url.searchParams.get("release") ?? undefined) });
  } catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const org = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, command);
    return json({ pitch: body.action === "save" ? await savePitch(org, body.input) : await savePitchFollowup(org, body.input) });
  } catch (error) { return handleApiError(error); }
};
