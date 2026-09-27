import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { changeMemberRole, removeMember } from "../../../server/member-invitations";
import { requireSameOrigin } from "../../../server/request-security";
import { requireCapability } from "../../../server/tenant";

const changeRoleSchema = z.object({
  role: z.enum(["operator", "fundraiser", "member", "payee"]),
}).strict();

export const PATCH: APIRoute = async ({ request, params, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "workspace.manage_members");
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    if (!params.userId) throw new HttpError("Workspace member is required", 400);
    const { role } = await parseJson(request, changeRoleSchema);
    return json(await changeMemberRole({
      orgId,
      userId: params.userId,
      role,
      actorUserId: locals.user.id,
      requestId: locals.requestId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
};

export const DELETE: APIRoute = async ({ request, params, locals }) => {
  try {
    requireSameOrigin(request);
    const orgId = requireCapability(locals, "workspace.manage_members");
    if (!locals.user?.id) throw new HttpError("Authentication required", 401);
    if (!params.userId) throw new HttpError("Workspace member is required", 400);
    return json(await removeMember({
      orgId,
      userId: params.userId,
      actorUserId: locals.user.id,
      requestId: locals.requestId,
    }));
  } catch (error) {
    return handleApiError(error);
  }
};
