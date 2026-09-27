import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { revokeInvitation } from "../../../../server/member-invitations";
import { requireSameOrigin } from "../../../../server/request-security";
import { requireCapability } from "../../../../server/tenant";

export const POST: APIRoute = async ({ request, params, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "workspace.manage_members");
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    if (!params.id) throw new HttpError("Invitation is required", 400);
    return json(await revokeInvitation({
      orgId,
      invitationId: params.id,
      actorUserId: locals.user.id,
      requestId: locals.requestId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
};
