import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { HttpError } from "../../../server/errors";
import { clearInvitationCookie, INVITATION_CONTINUATION_COOKIE } from "../../../server/invitation-continuation";
import { acceptInvitation } from "../../../server/member-invitations";
import { requireSameOrigin } from "../../../server/request-security";
import { ACTIVE_ORG_COOKIE } from "../../../server/tenant";

const acceptInvitationSchema = z.object({}).strict();

export const POST: APIRoute = async ({ request, url, locals, cookies }) => {
  try {
    requireSameOrigin(request);
    if (!locals.user?.id || !locals.user.email) throw new HttpError("Authentication required", 401);
    await parseJson(request, acceptInvitationSchema);
    const token = cookies.get(INVITATION_CONTINUATION_COOKIE)?.value;
    if (!token) throw new HttpError("Invitation is invalid or expired", 400, "INVITATION_INVALID");
    const accepted = await acceptInvitation({
      token,
      userId: locals.user.id,
      userEmail: locals.user.email,
      requestId: locals.requestId,
    });
    cookies.set(ACTIVE_ORG_COOKIE, accepted.orgId, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
    });
    clearInvitationCookie(cookies);
    return json({ redirectTo: "/grants" });
  } catch (error) {
    if (error instanceof HttpError && error.code === "INVITATION_INVALID") {
      clearInvitationCookie(cookies);
    }
    return handleApiError(error);
  }
};
