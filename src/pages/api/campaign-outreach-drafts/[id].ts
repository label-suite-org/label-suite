import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { createManualDraftVersion } from "../../../server/campaign-communicator";
import { campaignDraftDocumentSchema } from "../../../server/campaign-communicator-core";
import { HttpError } from "../../../server/errors";
import { requireCapability } from "../../../server/tenant";

const manualDraftSchema = z.object({
  subject: z.string().trim().max(500).nullable(),
  body: z.string().trim().min(1).max(10_000).optional(),
  body_document: campaignDraftDocumentSchema.optional(),
}).strict().refine((value) => (value.body_document !== undefined && value.body_document !== null) || value.body !== undefined, {
  message: "Either body_document or body is required",
  path: ["body_document"],
});

export const prerender = false;

export const PATCH: APIRoute = async ({ request, locals, params }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const draftId = requirePathId(params.id);
    const actorId = requireActorId(locals.user?.id);
    const input = await parseJson(request, manualDraftSchema);
    return json(await createManualDraftVersion(orgId, draftId, input, actorId), 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function requirePathId(id: string | undefined) {
  if (id) return id;
  throw new HttpError("Outreach draft id is required", 400);
}

function requireActorId(id: unknown) {
  if (typeof id === "string" && id) return id;
  throw new HttpError("Authentication required", 401);
}
