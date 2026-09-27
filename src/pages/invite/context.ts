import type { APIRoute } from "astro";
import { handleApiError, json } from "../../server/api";
import { HttpError } from "../../server/errors";
import { INVITATION_CONTINUATION_COOKIE } from "../../server/invitation-continuation";
import { getInvitationContext } from "../../server/member-invitations";

export const GET: APIRoute = async ({ cookies }) => {
  try {
    const token = cookies.get(INVITATION_CONTINUATION_COOKIE)?.value;
    if (!token) throw new HttpError("Invitation is invalid or expired", 400, "INVITATION_INVALID");
    return withPrivacyHeaders(json(await getInvitationContext(token)));
  } catch (error) {
    return withPrivacyHeaders(handleApiError(error));
  }
};

function withPrivacyHeaders(response: Response) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
