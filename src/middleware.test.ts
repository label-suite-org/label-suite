import { beforeEach, describe, expect, it, vi } from "vitest";
import astroConfig from "../astro.config.mjs";

const authBoundary = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgForUser: vi.fn(),
}));
const nativeBoundary = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));

const databaseBoundary = vi.hoisted(() => {
  let activeContext: { userId: string; orgId?: string } | undefined;
  const calls: Array<{ userId: string; orgId?: string }> = [];
  const options: unknown[] = [];
  return {
    calls,
    options,
    get activeContext() {
      return activeContext;
    },
    runWithDatabaseContext: vi.fn(async <T>(
      context: { userId: string; orgId?: string },
      operation: () => Promise<T>,
      transactionOptions?: unknown,
    ) => {
      const previous = activeContext;
      activeContext = context;
      calls.push(context);
      options.push(transactionOptions);
      try {
        return await operation();
      } finally {
        activeContext = previous;
      }
    }),
  };
});

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("./lib/auth", () => ({ auth: { api: { getSession: authBoundary.getSession } } }));
vi.mock("./lib/db", () => ({ runWithDatabaseContext: databaseBoundary.runWithDatabaseContext }));
vi.mock("./lib/native-session", () => nativeBoundary);
vi.mock("./server/tenant", () => ({
  ACTIVE_ORG_COOKIE: "label_suite_org_id",
  resolveActiveOrgForUser: authBoundary.resolveActiveOrgForUser,
}));

function contextFor(request: Request) {
  return {
    url: new URL(request.url),
    request,
    cookies: { get: vi.fn(), set: vi.fn() },
    locals: {},
    redirect: vi.fn(),
  };
}

describe("Spotify import middleware boundary", () => {
  it("leaves handoff workspace selection to its explicit confirmation, including signed-out requests", async () => {
    const { onRequest } = await import("./middleware");
    for (const session of [null, { user: { id: "handoff-user" }, session: { id: "fixture" } }]) {
      authBoundary.getSession.mockResolvedValue(session);
      const context = contextFor(new Request("https://labels.example/native-handoff?workspaceId=target&operation=integration-credentials"));
      const next = vi.fn().mockResolvedValue(new Response("handoff"));
      const response = await onRequest(context as never, next) as Response;
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(context.cookies.set).not.toHaveBeenCalled();
      expect(context.redirect).not.toHaveBeenCalled();
      expect(authBoundary.resolveActiveOrgForUser).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
    }
  });
  beforeEach(() => {
    vi.clearAllMocks();
    nativeBoundary.bearerToken.mockReturnValue(null);
    nativeBoundary.getNativeSession.mockResolvedValue(null);
    databaseBoundary.calls.length = 0;
    databaseBoundary.options.length = 0;
    process.env.PUBLIC_SITE_URL = "https://labels.example";
  });

  it.each(["/native-sign-in", "/api/native/browser-sign-in"])("leaves %s authentication to the sign-in boundary", async (path) => {
    const { onRequest } = await import("./middleware");
    const context = contextFor(new Request(`https://labels.example${path}`, {
      method: path.startsWith("/api/") ? "POST" : "GET",
    }));
    const next = vi.fn().mockResolvedValue(new Response("sign-in"));
    expect((await onRequest(context as never, next) as Response).status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(context.redirect).not.toHaveBeenCalled();
    expect(authBoundary.resolveActiveOrgForUser).not.toHaveBeenCalled();
    expect(nativeBoundary.getNativeSession).not.toHaveBeenCalled();
  });

  it.each(["/", "/login"])("redirects authenticated %s before rendering", async (path) => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "existing-user" }, session: { id: "existing-session" } });
    const { onRequest } = await import("./middleware");
    const context = contextFor(new Request(`https://labels.example${path}`));
    context.redirect.mockReturnValue(new Response(null, { status: 302, headers: { Location: "/dashboard" } }));
    const next = vi.fn();
    const response = await onRequest(context as never, next) as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/dashboard");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(next).not.toHaveBeenCalled();
    expect(authBoundary.resolveActiveOrgForUser).not.toHaveBeenCalled();
  });

  it.each(["/", "/login"])("renders %s for missing, invalid or expired sessions without a redirect loop", async (path) => {
    authBoundary.getSession.mockResolvedValue(null);
    const { onRequest } = await import("./middleware");
    for (const cookie of ["", "better-auth.session_token=invalid-or-expired"]) {
      const context = contextFor(new Request(`https://labels.example${path}`, { headers: { cookie } }));
      const next = vi.fn().mockResolvedValue(new Response("login"));
      const response = await onRequest(context as never, next) as Response;
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(context.redirect).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledOnce();
      expect(authBoundary.getSession).toHaveBeenLastCalledWith({ headers: context.request.headers });
    }
  });

  it.each([undefined, "https://attacker.example"])("denies an unsafe import request with Origin %s before the route", async (origin) => {
    const { onRequest } = await import("./middleware");
    const headers = origin ? { origin } : undefined;
    const request = new Request("https://labels.example/api/analytics/spotify-import", { method: "POST", headers });
    const next = vi.fn().mockResolvedValue(new Response("route reached"));

    const context = contextFor(request);
    const response = await onRequest(context as never, next) as Response;

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Cross-origin request denied" });
    expect(next).not.toHaveBeenCalled();
  });

  it("passes a canonical-origin import request through after session resolution", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-a" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockResolvedValue({
      org: { id: "org-a", name: "Org A", slug: "org-a", plan: null },
      role: "operator",
    });
    const { onRequest } = await import("./middleware");
    const request = new Request("https://labels.example/api/analytics/spotify-import", {
      method: "POST",
      headers: { origin: "https://labels.example" },
    });
    const next = vi.fn().mockResolvedValue(new Response("route reached"));

    const context = contextFor(request);
    const response = await onRequest(context as never, next) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("route reached");
    expect(next).toHaveBeenCalledOnce();
  });

  it("accepts a bearer-authenticated native mutation without a browser Origin while retaining server workspace resolution", async () => {
    nativeBoundary.bearerToken.mockReturnValue(crypto.randomUUID());
    nativeBoundary.getNativeSession.mockResolvedValue({ user: { id: "user-a" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockResolvedValue({ org: { id: "org-a", name: "Org A", slug: "org-a", plan: null }, role: "operator" });
    const { onRequest } = await import("./middleware");
    const request = new Request("https://labels.example/api/native/session", { method: "POST", headers: { "x-label-suite-workspace": "org-a" } });
    const next = vi.fn().mockResolvedValue(new Response("native route reached"));
    const context = contextFor(request);
    const response = await onRequest(context as never, next) as Response;
    expect(response.status).toBe(200);
    expect(next).toHaveBeenCalledOnce();
    expect(authBoundary.resolveActiveOrgForUser).not.toHaveBeenCalled();
    expect(context.cookies.set).not.toHaveBeenCalled();
    expect(databaseBoundary.options).toEqual([undefined]);
  });

  it.each([
    ["/api/native/settings", false],
    ["/api/native/analytics", false],
    ["/api/native/royalties", false],
    ["/api/native/budget", true],
    ["/api/native/grants", true],
    ["/api/native/grants?choice_kind=members", true],
    ["/api/native/campaigns/campaign-a/public-page", true],
  ])("establishes the native read transaction before %s resolves its workspace", async (path, readOnly) => {
    nativeBoundary.bearerToken.mockReturnValue(crypto.randomUUID());
    nativeBoundary.getNativeSession.mockResolvedValue({ user: { id: "user-a" }, session: { id: crypto.randomUUID() } });
    const { onRequest } = await import("./middleware");
    const next = vi.fn().mockResolvedValue(new Response("native read reached"));
    const response = await onRequest(contextFor(new Request(`https://labels.example${path}`)) as never, next) as Response;
    expect(response.status).toBe(200);
    expect(databaseBoundary.calls).toEqual([{ userId: "user-a" }]);
    expect(databaseBoundary.options).toEqual([{
      isolationLevel: "repeatable read",
      ...(readOnly ? { accessMode: "read only" } : {}),
    }]);
    expect(authBoundary.resolveActiveOrgForUser).not.toHaveBeenCalled();
  });

  it("returns native unauthorized rather than redirecting an expired bearer session to web login", async () => {
    nativeBoundary.bearerToken.mockReturnValue(crypto.randomUUID());
    nativeBoundary.getNativeSession.mockResolvedValue(null);
    const { onRequest } = await import("./middleware");
    const response = await onRequest(contextFor(new Request("https://labels.example/api/native/session")) as never, vi.fn()) as Response;
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required", code: "native_session_unauthorized" });
  });

  it("never falls back to a browser cookie session for a native route", async () => {
    nativeBoundary.bearerToken.mockReturnValue(null);
    authBoundary.getSession.mockResolvedValue({ user: { id: "cookie-user" }, session: { id: crypto.randomUUID() } });
    const { onRequest } = await import("./middleware");
    const response = await onRequest(contextFor(new Request("https://labels.example/api/native/session", { headers: { cookie: `better-auth.session_token=${crypto.randomUUID()}` } })) as never, vi.fn()) as Response;
    expect(response.status).toBe(401);
    expect(authBoundary.getSession).not.toHaveBeenCalled();
  });

  it("resolves membership with user context and renders the route with user and organization context", async () => {
    // Break caught: the restricted runtime role applies RLS before middleware
    // establishes app.current_user_id/app.current_org_id, so every membership
    // is hidden and the authenticated page fails before rendering.
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-a" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockImplementation(async () => {
      expect(databaseBoundary.activeContext).toEqual({ userId: "user-a" });
      return {
        org: { id: "org-a", name: "Org A", slug: "org-a", plan: null },
        role: "owner",
      };
    });
    const { onRequest } = await import("./middleware");
    const request = new Request("https://labels.example/royalties");
    const next = vi.fn(async () => {
      expect(databaseBoundary.activeContext).toEqual({ userId: "user-a", orgId: "org-a" });
      return new Response("royalties rendered", { headers: { "Content-Type": "text/html; charset=utf-8" } });
    });

    const response = await onRequest(contextFor(request) as never, next) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("royalties rendered");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, no-transform");
    expect(response.headers.get("Vary")).toContain("Cookie");
    expect(databaseBoundary.calls).toEqual([
      { userId: "user-a" },
      { userId: "user-a", orgId: "org-a" },
    ]);
  });

  it("redirects a payee away from operator pages", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "payee-a", email: "payee@example.com" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockResolvedValue({
      org: { id: "org-a", name: "Org A", slug: "org-a", plan: null },
      role: "payee",
    });
    const { onRequest } = await import("./middleware");
    const context = contextFor(new Request("https://labels.example/royalties"));
    context.redirect = vi.fn(() => new Response(null, { status: 302, headers: { location: "/payee" } }));
    const next = vi.fn();
    const response = await onRequest(context as never, next) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/payee");
    expect(next).not.toHaveBeenCalled();
  });

  it("denies payee access to operator APIs", async () => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "payee-a", email: "payee@example.com" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockResolvedValue({
      org: { id: "org-a", name: "Org A", slug: "org-a", plan: null },
      role: "payee",
    });
    const { onRequest } = await import("./middleware");
    const response = await onRequest(contextFor(new Request("https://labels.example/api/royalties")) as never, vi.fn()) as Response;

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Payee portal access required" });
  });

  it.each([
    "/dashboard",
    "/analytics?section=data-health",
    "/analytics/?section=data-health",
    "/api/analytics/data-quality/",
  ])("establishes repeatable-read isolation before rendering authenticated read %s", async (path) => {
    authBoundary.getSession.mockResolvedValue({ user: { id: "user-a" }, session: { id: crypto.randomUUID() } });
    authBoundary.resolveActiveOrgForUser.mockResolvedValue({
      org: { id: "org-a", name: "Org A", slug: "org-a", plan: null },
      role: "owner",
    });
    const { onRequest } = await import("./middleware");

    const response = await onRequest(
      contextFor(new Request(`https://labels.example${path}`)) as never,
      vi.fn(async () => new Response("analytics rendered")),
    ) as Response;

    expect(response.status).toBe(200);
    expect(databaseBoundary.options).toEqual([
      undefined,
      { isolationLevel: "repeatable read" },
    ]);
  });

  it("uses the proxy-safe application origin check instead of Astro's internal host comparison", () => {
    expect(astroConfig.security?.checkOrigin).toBe(false);
  });
});
