import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  createCampaignEditorAiRun,
  getCampaignEditorAiRunDependencies,
} from "../../../../server/campaign-editor-ai";
import { createCampaignEditorAiRunSchema } from "../../../../server/campaign-editor-ai-core";
import { getCampaignEditorAiProvider } from "../../../../server/openrouter-campaign-editor-ai";
import { disabledCampaignEditorAiProvider } from "../../../../server/campaign-editor-ai-provider";
import { HttpError } from "../../../../server/errors";
import { requireCapability } from "../../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const campaignId = requirePathId(params.id, "Campaign");
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, createCampaignEditorAiRunSchema);
    const result = await createCampaignEditorAiRun(
      orgId,
      campaignId,
      actorId,
      input,
      configuredProvider(),
      getCampaignEditorAiRunDependencies(),
    );
    return json(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined, resource: string): string {
  if (id) return id;
  throw new HttpError(`${resource} id is required`, 400);
}

function configuredProvider() {
  try {
    return getCampaignEditorAiProvider();
  } catch {
    // The service records this as a failed disabled run without retaining config details.
    return disabledCampaignEditorAiProvider;
  }
}

function requireActorId(id: unknown): string {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
