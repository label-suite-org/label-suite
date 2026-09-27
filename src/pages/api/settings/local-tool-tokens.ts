import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import {
  boundedLocalToolDurationMs,
  localToolResultCategoryForError,
  recordLocalToolOperation,
} from "../../../server/local-tool-audit";
import {
  createLocalToolToken,
  createLocalToolTokenSchema,
  listLocalToolTokens,
} from "../../../server/local-tool-tokens";
import { requireCapability } from "../../../server/tenant";
import { getOrCreateRequestId } from "../../../server/request-context";

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    return json(await listLocalToolTokens(orgId));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const requestId = getOrCreateRequestId();
  const startedAt = Date.now();
  let orgId: string | undefined;
  let userId: string | undefined;
  try {
    orgId = requireCapability(locals, "operations.mutate");
    userId = typeof locals.user?.id === "string" && locals.user.id
      ? locals.user.id
      : undefined;
    if (!userId) throw new HttpError("Signed-in user is required", 401);

    const input = await parseJson(request, createLocalToolTokenSchema);
    const result = await createLocalToolToken(orgId, userId, input);
    await recordLocalToolOperation({
      requestId,
      tokenId: result.record.id,
      orgId,
      userId,
      tool: "create_local_tool_token",
      operation: "token_create",
      resultCategory: "created",
      durationMs: boundedLocalToolDurationMs(startedAt),
      proposalCount: 0,
    });
    return json(result, 201, requestId);
  } catch (error) {
    if (orgId) {
      await recordLocalToolOperation({
        requestId,
        orgId,
        ...(userId ? { userId } : {}),
        tool: "create_local_tool_token",
        operation: "token_create",
        resultCategory: localToolResultCategoryForError(error),
        durationMs: boundedLocalToolDurationMs(startedAt),
        proposalCount: 0,
      });
    }
    return handleApiError(error);
  }
};
