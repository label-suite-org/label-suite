import type { APIRoute } from "astro";
import { ZodError } from "zod";
import { bearerToken, getNativeSession } from "../../../../lib/native-session";
import { handleApiError, json, parseJson } from "../../../../server/api";
import { HttpError } from "../../../../server/errors";
import { notificationDeviceInput, notificationDeviceRemoval, registerNotificationDevice, removeNotificationDevice } from "../../../../server/native-notification-devices";

export const prerender = false;
async function respond(request: Request, remove: boolean): Promise<Response> {
  try {
    const token = bearerToken(request), actor = token ? await getNativeSession(token) : null;
    if (!actor) throw new HttpError("Authentication required", 401, "authentication_required");
    if (remove) return json(await removeNotificationDevice(actor.user.id, actor.session.id, await parseJson(request, notificationDeviceRemoval)));
    const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
    if (!workspaceId) throw new HttpError("Workspace is required", 400);
    return json(await registerNotificationDevice(workspaceId, actor.user.id, actor.session.id, await parseJson(request, notificationDeviceInput)));
  } catch (error) {
    // Database errors may contain bound APNs tokens. Never pass them into generic logging.
    return handleApiError(error instanceof HttpError || error instanceof ZodError ? error : new Error("Notification device operation failed"));
  }
}
export const POST: APIRoute = ({ request }) => respond(request, false);
export const DELETE: APIRoute = ({ request }) => respond(request, true);
