import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  getCommunicatorContext,
  saveCommunicatorPrompt,
} from "../../../../server/campaign-communicator";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

const savePromptSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
}).strict();

export const prerender = false;

export const GET: APIRoute = async ({ locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await getCommunicatorContext(orgId, requirePathId(params.id, "Campaign")));
  } catch (error) {
    return handleApiError(error);
  }
};

export const PUT: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id, "Campaign");
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, savePromptSchema);
    return json(await saveCommunicatorPrompt(orgId, campaignId, input.prompt, actorId));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined, resource: string) {
  if (id) return id;
  throw new HttpError(`${resource} id is required`, 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
