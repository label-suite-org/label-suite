import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { nativeNotificationPreferences, notificationPreferenceInput } from "../../../../server/native-notification-preferences";

export const prerender = false;

async function respond(request: Request, write: boolean): Promise<Response> {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request), session = token ? await getNativeSession(token) : null;
      throw new HttpError(session ? "Workspace access removed" : "Authentication required", session ? 403 : 401, session ? "workspace_access_removed" : "authentication_required");
    }
    const input = write ? await parseJson(request, notificationPreferenceInput) : undefined;
    return json(await nativeNotificationPreferences(actor.workspace.org.id, actor.userId, input));
  } catch (error) { return handleApiError(error); }
}
export const GET: APIRoute = ({ request }) => respond(request, false);
export const POST: APIRoute = ({ request }) => respond(request, true);
