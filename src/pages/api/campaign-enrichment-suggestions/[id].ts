import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { decideSuggestion } from "../../../server/campaign-communicator";
import { decideSuggestionSchema } from "../../../server/campaign-communicator-core";
import { HttpError } from "../../../server/errors";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const suggestionId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, decideSuggestionSchema);
    return json(await decideSuggestion(orgId, suggestionId, input, actorId));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (id) return id;
  throw new HttpError("Enrichment suggestion id is required", 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
