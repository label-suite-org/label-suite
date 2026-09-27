import { beforeEach, expect, it, vi } from "vitest";
const server = vi.hoisted(() => ({ calendarStatus: vi.fn(), listCalendars: vi.fn(), selectCalendar: vi.fn(), enableCalendarRelease: vi.fn(), disconnectCalendar: vi.fn(), requestCalendarSync: vi.fn(), resolveCalendarConflict: vi.fn() }));
vi.mock("../../../server/calendar-sync", () => server);
vi.mock("../../../server/calendar-google", () => ({ calendarOrigin: vi.fn((origin: string) => origin), calendarAuth: vi.fn(() => ({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth", cookie: "sealed" })) }));
import { calendarOrigin } from "../../../server/calendar-google";
import { GET, POST } from "./index";
function context(body: unknown, role = "operator") {
  const request = new Request("https://suite.example/api/calendar", { method: "POST", body: JSON.stringify(body) });
  return { request, url: new URL(request.url), locals: { orgId: "org", user: { id: "user" }, membershipRole: role }, cookies: { set: vi.fn() } };
}
beforeEach(() => { vi.clearAllMocks(); server.calendarStatus.mockResolvedValue({ connected: false }); });
it("gates all calendar writes and calendar discovery to workspace operators", async () => {
  expect((await POST(context({ action: "sync" }, "member") as never)).status).toBe(403);
  expect(server.requestCalendarSync).not.toHaveBeenCalled();
  const ctx = context({}, "member"); ctx.url.searchParams.set("calendars", "true");
  expect((await GET(ctx as never)).status).toBe(403);
  expect(server.listCalendars).not.toHaveBeenCalled();
});
it("uses active workspace identity and validates the release before connecting", async () => {
  const ctx = context({ action: "connect", releaseId: "release", orgId: "forged" });
  expect((await POST(ctx as never)).status).toBe(200);
  expect(server.calendarStatus).toHaveBeenCalledWith("org", "release");
  expect(ctx.cookies.set).toHaveBeenCalledWith("calendar_oauth", "sealed", expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax", maxAge: 600 }));
  expect((await POST(context({ action: "enable", releaseId: "release", enabled: true }) as never)).status).toBe(200);
  expect(server.enableCalendarRelease).toHaveBeenCalledWith("org", "release", true);
});
it("rejects malformed conflict resolutions before mutation", async () => {
  expect((await POST(context({ action: "resolve", releaseId: "r", id: "i", choice: "google", localDate: "not-a-date", etag: "v1" }) as never)).status).toBe(400);
  expect(server.resolveCalendarConflict).not.toHaveBeenCalled();
});

it("keeps the OAuth cookie secure when the proxy uses HTTP internally", async () => {
  vi.mocked(calendarOrigin).mockReturnValue("https://suite.example");
  const ctx = context({ action: "connect", releaseId: "release" });
  ctx.url = new URL("http://suite.example/api/calendar");
  expect((await POST(ctx as never)).status).toBe(200);
  expect(ctx.cookies.set).toHaveBeenCalledWith("calendar_oauth", "sealed", expect.objectContaining({ secure: true }));
});
