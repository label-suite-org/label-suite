import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability, requireOrgId } from "../../../server/tenant";
import { calendarAuth, calendarOrigin } from "../../../server/calendar-google";
import { calendarStatus, disconnectCalendar, enableCalendarRelease, listCalendars, requestCalendarSync, resolveCalendarConflict, selectCalendar } from "../../../server/calendar-sync";

export const prerender = false;
const id = z.string().min(1).max(512);
export const calendarAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), releaseId: id }),
  z.object({ action: z.literal("select"), calendarId: id }),
  z.object({ action: z.literal("enable"), releaseId: id, enabled: z.boolean() }),
  z.object({ action: z.literal("sync") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("resolve"), releaseId: id, id, choice: z.enum(["suite", "google", "ignore"]), localDate: z.iso.date().nullable(), etag: z.string().max(512).nullable() }),
]);
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    if (url.searchParams.get("calendars") === "true") return json({ calendars: await listCalendars(requireCapability(locals, "integrations.manage")) });
    return json(await calendarStatus(requireOrgId(locals), id.parse(url.searchParams.get("releaseId"))));
  } catch (error) { return handleApiError(error); }
};
export const POST: APIRoute = async ({ locals, url, request, cookies }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const input = await parseJson(request, calendarAction);
    switch (input.action) {
      case "connect": {
        await calendarStatus(orgId, input.releaseId);
        const result = calendarAuth(orgId, locals.user!.id, input.releaseId, url.origin);
        cookies.set("calendar_oauth", result.cookie, { httpOnly: true, secure: calendarOrigin(url.origin).startsWith("https:"), sameSite: "lax", path: "/api/calendar", maxAge: 600 });
        return json({ authUrl: result.authUrl });
      }
      case "select": await selectCalendar(orgId, input.calendarId); break;
      case "enable": await enableCalendarRelease(orgId, input.releaseId, input.enabled); break;
      case "sync": return json(await requestCalendarSync(orgId));
      case "disconnect": await disconnectCalendar(orgId); break;
      case "resolve": await resolveCalendarConflict(orgId, input.releaseId, input.id, input.choice, { localDate: input.localDate, etag: input.etag }); break;
    }
    return json({ ok: true });
  } catch (error) { return handleApiError(error); }
};
