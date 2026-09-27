import { afterEach, expect, it, vi } from "vitest";
vi.mock("./gmail-enrichment", () => ({
  sealSecret: (s: string) => `enc:v1:${Buffer.from(s).toString("base64url")}`,
  openSecret: (s: string) => Buffer.from(s.slice(7), "base64url").toString(),
}));
import { calendarAuth, calendarOrigin, calendarState, calendarRequest, writableCalendars } from "./calendar-google";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("binds OAuth to user, workspace, cookie and expiry", () => {
  vi.stubEnv("PUBLIC_SITE_URL", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret"); vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  const result = calendarAuth("org", "user", "release", "https://suite.example");
  const url = new URL(result.authUrl), state = url.searchParams.get("state")!;
  expect(url.searchParams.get("redirect_uri")).toBe("https://suite.example/api/calendar/callback");
  expect(calendarState(result.cookie, state, "org", "user").releaseId).toBe("release");
  expect(() => calendarState(result.cookie, state, "other", "user")).toThrow();
  expect(() => calendarState(result.cookie, state, "org", "other")).toThrow();
  expect(() => calendarState(result.cookie, "wrong", "org", "user")).toThrow();
  expect(() => calendarState("{}", state, "org", "user")).toThrow();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 601_000);
  expect(() => calendarState(result.cookie, state, "org", "user")).toThrow();
  vi.restoreAllMocks();
});
it("paginates writable calendars and sends ETag protection without leaking provider errors", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "one", summary: "True Nature", accessRole: "writer" }], nextPageToken: "next" })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "read", accessRole: "reader" }, { id: "two", summary: "Other", accessRole: "owner" }] })))
    .mockResolvedValueOnce(new Response("private-provider-error", { status: 412 }));
  vi.stubGlobal("fetch", fetch);
  expect((await writableCalendars("token")).map((row) => row.id)).toEqual(["one", "two"]);
  expect(fetch.mock.calls[1][0]).toContain("pageToken=next");
  await expect(calendarRequest("token", "calendars/id/events/event", "PATCH", { summary: "Name" }, "v1")).rejects.toThrow("(412)");
  expect(fetch.mock.calls[2][1].headers["If-Match"]).toBe("v1");
});

it("uses the configured HTTPS site behind an HTTP reverse proxy", () => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "secret"); vi.stubEnv("BETTER_AUTH_SECRET", "test-secret");
  vi.stubEnv("PUBLIC_SITE_URL", "https://suite.example");
  vi.stubEnv("GOOGLE_CALENDAR_REDIRECT_URI", "");
  const { authUrl } = calendarAuth("org", "user", "release", "http://suite.example");
  expect(new URL(authUrl).searchParams.get("redirect_uri")).toBe("https://suite.example/api/calendar/callback");
  expect(calendarOrigin("http://suite.example")).toBe("https://suite.example");
});
