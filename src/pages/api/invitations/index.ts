import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { createInvitation, listWorkspaceInvitations } from "../../../server/member-invitations";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability } from "../../../server/tenant";

const createInvitationSchema = z.object({
  email: z.email(),
  role: z.enum(["operator", "fundraiser", "member", "payee"]),
}).strict();

export const GET: APIRoute = async ({ locals }) => {
  try {
    const invitations = await listWorkspaceInvitations(requireCapability(locals, "workspace.manage_members"));
    return json(invitations.map(redactTokenMaterial));
  } catch (error) {
    return handleApiError(error);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const canonicalOrigin = requireSameOrigin(request);
    const orgId = requireCapability(locals, "workspace.manage_members");
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    const input = await parseJson(request, createInvitationSchema);
    const result = await createInvitation({
      ...input,
      orgId,
      invitedByUserId: locals.user.id,
      inviterName: locals.user.name?.trim() || "A workspace owner",
      workspaceName: locals.org?.name || "your Label Suite workspace",
      acceptBaseUrl: `${canonicalOrigin}/invite`,
      requestId: locals.requestId,
    });
    return json({ ...result, invitation: redactTokenMaterial(result.invitation as Record<string, unknown>) }, 201);
  } catch (error) {
    return handleApiError(error);
  }
};

function redactTokenMaterial(invitation: Record<string, unknown>) {
  const { tokenDigest: _camelDigest, token_digest: _snakeDigest, token: _rawToken, ...safe } = invitation;
  return safe;
}
