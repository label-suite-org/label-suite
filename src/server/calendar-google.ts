import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./errors";
import { openSecret, sealSecret } from "./gmail-enrichment";

const scopes = ["openid", "email", "https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.calendarlist.readonly"];
export const calendarConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && (process.env.GMAIL_TOKEN_SECRET || process.env.BETTER_AUTH_SECRET));
export function calendarOrigin(origin: string) {
  return new URL(process.env.PUBLIC_SITE_URL || origin).origin;
}
export function calendarRedirect(origin: string) {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI || new URL("/api/calendar/callback", calendarOrigin(origin)).toString();
}
export function calendarAuth(orgId: string, userId: string, releaseId: string, origin: string) {
  if (!calendarConfigured()) throw new HttpError("Google Calendar needs configuration by the suite administrator.", 409);
  const nonce = crypto.randomUUID();
  const cookie = sealSecret(JSON.stringify({ orgId, userId, releaseId, nonce, expires: Date.now() + 600_000 }));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: calendarRedirect(origin), response_type: "code", scope: scopes.join(" "), access_type: "offline", prompt: "consent", state: nonce }).toString();
  return { authUrl: url.toString(), cookie };
}
export function calendarState(cookie: string, state: string, orgId: string, userId: string) {
  try {
    if (!cookie.startsWith("enc:v1:")) throw new Error();
    const parsed = z.object({ orgId: z.string(), userId: z.string(), releaseId: z.string(), nonce: z.string(), expires: z.number() }).parse(JSON.parse(openSecret(cookie)));
    const a = Buffer.from(parsed.nonce), b = Buffer.from(state);
    if (a.length !== b.length || !timingSafeEqual(a, b) || parsed.orgId !== orgId || parsed.userId !== userId || parsed.expires < Date.now()) throw new Error();
    return parsed;
  } catch { throw new HttpError("Google connection expired or belongs to another workspace. Start again.", 400); }
}
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), scope: z.string().optional() });
export async function calendarToken(params: Record<string, string>) {
  if (!calendarConfigured()) throw new HttpError("Google Calendar needs configuration by the suite administrator.", 409);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...params, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET! }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new HttpError(response.status === 400 ? "Reconnect Google Calendar to renew access." : "Google authorization is temporarily unavailable. Try again.", 502);
  return tokenSchema.parse(await response.json());
}
export class CalendarApiError extends HttpError {
  constructor(public googleStatus: number) { super(googleStatus === 401 || googleStatus === 403 ? "Google Calendar access was denied. Check permissions or reconnect." : `Google Calendar request failed (${googleStatus}). Try syncing again.`, 502); }
}
export async function calendarRequest<T>(token: string, path: string, method = "GET", body?: unknown, etag?: string): Promise<T> {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new CalendarApiError(response.status);
  return response.json() as Promise<T>;
}
export type WritableCalendar = { id: string; summary: string; accessRole: string };
export async function writableCalendars(token: string) {
  const rows: WritableCalendar[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ minAccessRole: "writer", maxResults: "250", ...(pageToken ? { pageToken } : {}) });
    const page = await calendarRequest<{ items?: WritableCalendar[]; nextPageToken?: string }>(token, `users/me/calendarList?${query}`);
    rows.push(...(page.items ?? []).filter((row) => row.accessRole === "owner" || row.accessRole === "writer"));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return rows;
}
