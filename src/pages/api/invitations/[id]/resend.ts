import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { resendInvitation } from "../../../../server/member-invitations";
import { requireSameOrigin } from "../../../../server/request-security";
import { requireCapability } from "../../../../server/tenant";

export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    const canonicalOrigin = requireSameOrigin(request);
    const orgId = requireCapability(locals, "workspace.manage_members");
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    if (!params.id) throw new HttpError("Invitation is required", 400);
    const result = await resendInvitation({
      orgId,
      invitationId: params.id,
      actorUserId: locals.user.id,
      inviterName: locals.user.name?.trim() || "A workspace owner",
      workspaceName: locals.org?.name || "your Label Suite workspace",
      acceptBaseUrl: `${canonicalOrigin}/invite`,
      requestId: locals.requestId,
    });
    const { tokenDigest: _digest, token_digest: _snakeDigest, token: _rawToken, ...safeInvitation } = result.invitation as Record<string, unknown>;
    return json({ ...result, invitation: safeInvitation });
  } catch (error) {
    return handleApiError(error);
  }
};
