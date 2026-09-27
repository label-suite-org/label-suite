import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import {
  boundedLocalToolDurationMs,
  localToolResultCategoryForError,
  recordLocalToolOperation,
} from "../../../../server/local-tool-audit";
import { revokeLocalToolToken } from "../../../../server/local-tool-tokens";
import { requireCapability } from "../../../../server/tenant";
import { getOrCreateRequestId } from "../../../../server/request-context";

export const prerender = false;

export const DELETE: APIRoute = async ({ locals, params }) => {
  const requestId = getOrCreateRequestId();
  const startedAt = Date.now();
  let orgId: string | undefined;
  let tokenId: string | undefined;
  const userId = typeof locals.user?.id === "string" && locals.user.id ? locals.user.id : undefined;
  try {
    orgId = requireCapability(locals, "operations.mutate");
    tokenId = params.id?.trim();
    if (!tokenId) throw new HttpError("Local tool token ID is required", 400);
    const result = await revokeLocalToolToken(orgId, tokenId);
    await recordLocalToolOperation({
      requestId,
      tokenId,
      orgId,
      ...(userId ? { userId } : {}),
      tool: "revoke_local_tool_token",
      operation: "token_revoke",
      resultCategory: "revoked",
      durationMs: boundedLocalToolDurationMs(startedAt),
      proposalCount: 0,
    });
    return json(result, 200, requestId);
  } catch (error) {
    if (orgId) {
      await recordLocalToolOperation({
        requestId,
        ...(tokenId ? { tokenId } : {}),
        orgId,
        ...(userId ? { userId } : {}),
        tool: "revoke_local_tool_token",
        operation: "token_revoke",
        resultCategory: localToolResultCategoryForError(error),
        durationMs: boundedLocalToolDurationMs(startedAt),
        proposalCount: 0,
      });
    }
    return handleApiError(error);
  }
};
