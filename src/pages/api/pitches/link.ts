import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { changePitchLink } from "../../../server/pitches";
export const prerender = false;
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const org = requireCapability(locals, "integrations.manage");
    const input = await parseJson(request, z.object({ id: z.uuid(), action: z.enum(["create", "revoke"]), expected_version: z.number().int().positive() }).strict());
    return json({ pitch: await changePitchLink(org, locals.user!.id, input.id, input.action, input.expected_version) });
  } catch (error) { return handleApiError(error); }
};
