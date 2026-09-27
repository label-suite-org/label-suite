import type { APIRoute } from "astro";
import { requireCapability } from "../../../server/tenant";
import { calendarState } from "../../../server/calendar-google";
import { connectCalendar } from "../../../server/calendar-sync";
import { HttpError } from "../../../server/errors";

export const prerender = false;
export const GET: APIRoute = async ({ locals, url, cookies, redirect }) => {
  let destination = "/releases";
  const cookie = cookies.get("calendar_oauth")?.value ?? "";
  cookies.delete("calendar_oauth", { path: "/api/calendar" });
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const state = calendarState(cookie, url.searchParams.get("state") ?? "", orgId, locals.user!.id);
    destination = `/releases/${encodeURIComponent(state.releaseId)}?section=timeline`;
    if (url.searchParams.has("error")) throw new HttpError("Google Calendar connection was cancelled. Try connecting again.", 400);
    const code = url.searchParams.get("code");
    if (!code) throw new HttpError("Google did not return an authorization code. Try connecting again.", 400);
    await connectCalendar(orgId, code, url.origin);
    return redirect(`${destination}&calendar=connected`);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "Google Calendar could not connect. Try again.";
    return redirect(`${destination}${destination.includes("?") ? "&" : "?"}calendarError=${encodeURIComponent(message)}`);
  }
};
