import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import {
  decideCampaignEditorAiRun,
  decideCampaignEditorAiRunSchema,
  getCampaignEditorAiRunDependencies,
} from "../../../server/campaign-editor-ai";
import { HttpError } from "../../../server/errors";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const runId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, decideCampaignEditorAiRunSchema);
    return json(await decideCampaignEditorAiRun(orgId, runId, actorId, input, getCampaignEditorAiRunDependencies()));
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined): string {
  if (id) return id;
  throw new HttpError("Campaign editor AI run id is required", 400);
}

function requireActorId(id: unknown): string {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
