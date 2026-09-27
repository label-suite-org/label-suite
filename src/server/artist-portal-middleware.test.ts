import { beforeEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getSession: vi.fn(), resolve: vi.fn() }));
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession: auth.getSession } } }));
vi.mock("../lib/db", () => ({ runWithDatabaseContext: vi.fn() }));
vi.mock("./tenant", () => ({ ACTIVE_ORG_COOKIE: "org", resolveActiveOrgForUser: auth.resolve }));
import { onRequest } from "../middleware";
function context(path: string, method = "GET", origin?: string) {
  const url = new URL(path, "https://label.example");
  return { url, request: new Request(url, { method, headers: origin ? { origin } : {} }), locals: {}, cookies: { get: vi.fn(), set: vi.fn() }, redirect: vi.fn(() => new Response(null, { status: 302 })) };
}
describe("artist portal middleware", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.PUBLIC_SITE_URL = "https://label.example"; });
  it("opens only the two exact artist routes without workspace membership and never caches them", async () => {
    for (const path of ["/artist-portal", "/api/artist-portal"]) {
      const next = vi.fn().mockResolvedValue(new Response("private"));
      const response = await onRequest(context(path) as never, next) as Response;
      expect(next).toHaveBeenCalledOnce();
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(auth.resolve).not.toHaveBeenCalled();
    const next = vi.fn();
    await onRequest(context("/api/artists/artist-1/portal") as never, next);
    expect(auth.getSession).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });
  it("rejects cross-origin submissions before invoking the public endpoint", async () => {
    const next = vi.fn();
    const response = await onRequest(context("/api/artist-portal", "POST", "https://evil.example") as never, next) as Response;
    expect(response.status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});
