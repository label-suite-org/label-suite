import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { handleApiError, json } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { resolveNativeNotification } from "../../../../server/native-notification-resolution";

export const prerender = false;
export const GET: APIRoute = async ({ request, params }) => {
  try {
    const token = bearerToken(request), actor = token ? await getNativeSession(token) : null;
    if (!actor) throw new HttpError("Authentication required", 401, "authentication_required");
    return json(await resolveNativeNotification(actor.user.id, actor.session.id, params.id));
  } catch (error) { return handleApiError(error); }
};
