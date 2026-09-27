import { beforeEach, describe, expect, it, vi } from "vitest";

const authPolicy = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgForUser: vi.fn(),
}));

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession: authPolicy.getSession } } }));
vi.mock("./tenant", () => ({
  ACTIVE_ORG_COOKIE: "label_suite_active_org",
  resolveActiveOrgForUser: authPolicy.resolveActiveOrgForUser,
}));

function middlewareContext(path: string, init?: RequestInit) {
  const url = new URL(path, "https://labels.example");
  return {
    url,
    request: new Request(url, init),
    cookies: {
      get: vi.fn(() => ({ value: "browser-session-cookie" })),
      set: vi.fn(),
    },
    locals: {} as Record<string, unknown>,
    redirect: vi.fn(() => new Response(null, {
      status: 302,
      headers: { Location: "https://labels.example/login" },
    })),
  };
}

describe("local-tool middleware bearer lane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_SITE_URL = "https://labels.example";
  });

  it("passes a signed-out GET to route bearer auth with private request metadata", async () => {
    authPolicy.getSession.mockResolvedValue({
      user: { id: "browser-user" },
      session: { id: "browser-session" },
    });
    const { onRequest } = await import("../middleware");
    const context = middlewareContext("/api/local-tools/v1/campaign-enrichment/queue");
    const next = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "authentication_failed" },
    }), { status: 401 }));

    const response = await onRequest(context as never, next) as Response;

    expect(next).toHaveBeenCalledOnce();
    expect(authPolicy.getSession).not.toHaveBeenCalled();
    expect(authPolicy.resolveActiveOrgForUser).not.toHaveBeenCalled();
    expect(context.locals).not.toHaveProperty("user");
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("passes an unsafe bearer request without Origin to route authentication", async () => {
    const { onRequest } = await import("../middleware");
    const context = middlewareContext(
      "/api/local-tools/v1/campaign-enrichment/items/lead-1/claim",
      { method: "POST", headers: { authorization: "Bearer malformed" } },
    );
    const next = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "authentication_failed" },
    }), { status: 401 }));

    const response = await onRequest(context as never, next) as Response;

    expect(next).toHaveBeenCalledOnce();
    expect(authPolicy.getSession).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("does not weaken same-origin protection for another unsafe API route", async () => {
    const { onRequest } = await import("../middleware");
    const context = middlewareContext("/api/campaigns", { method: "POST" });
    const next = vi.fn().mockResolvedValue(new Response("must not run"));

    const response = await onRequest(context as never, next) as Response;

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Cross-origin request denied" });
  });
});
