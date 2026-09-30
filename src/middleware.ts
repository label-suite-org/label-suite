import { auth } from "./lib/auth";
import { runWithDatabaseContext } from "./lib/db";
import { defineMiddleware } from "astro:middleware";
import { handleApiError, json } from "./server/api";
import { isPostgresSerializationFailure } from "./server/errors";
import {
  ACTIVE_ORG_COOKIE,
  resolveActiveOrgForUser,
} from "./server/tenant";
import { runWithRequestContext } from "./server/request-context";
import { requireSameOrigin } from "./server/request-security";
import { elapsed, errorClass, logEvent, requestPerformanceBudget } from "./server/observability";
import { bearerToken, getNativeSession } from "./lib/native-session";

const publicPaths = ["/", "/login", "/signup", "/reset-password", "/api/health"];

export const onRequest = defineMiddleware((context, next) => {
  const requestId = crypto.randomUUID();
  context.locals.requestId = requestId;

  return runWithRequestContext({ requestId }, async () => {
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await handleRequest(context, next);
    } catch (error) {
      if (!context.url.pathname.startsWith("/api/")) {
        logEvent({
          severity: "error",
          event: "request.completed",
          requestId,
          route: context.url.pathname,
          orgId: context.locals.orgId,
          durationMs: elapsed(startedAt),
          outcome: "failed",
          errorClass: errorClass(error),
        });
        throw error;
      }
      response = isCampaignOsMutation(context.request.method, context.url.pathname)
        && isPostgresSerializationFailure(error)
        ? json({ error: "Concurrent Campaign change; refresh and try again" }, 409)
        : handleApiError(error);
    }
    response.headers.set("X-Request-ID", requestId);
    const durationMs = elapsed(startedAt);
    const budgetMs = requestPerformanceBudget(context.url.pathname, context.request.method);
    logEvent({
      severity: response.status >= 500 || durationMs > budgetMs ? "warn" : "info",
      event: "request.completed",
      requestId,
      route: context.url.pathname,
      orgId: context.locals.orgId,
      durationMs,
      outcome: response.status < 400 ? "succeeded" : "failed",
      status: response.status,
      performanceBudgetMs: budgetMs,
      overBudget: durationMs > budgetMs,
    });
    return response;
  });
});

async function handleRequest(
  context: Parameters<Parameters<typeof defineMiddleware>[0]>[0],
  next: Parameters<Parameters<typeof defineMiddleware>[0]>[1],
): Promise<Response> {
  const path = context.url.pathname;
  const isLocalToolApi = path.startsWith("/api/local-tools/");
  const isNativeApi = path.startsWith("/api/native/");
  if (path.startsWith("/api/") && !isLocalToolApi && !isNativeApi && isUnsafeMethod(context.request.method)) {
    requireSameOrigin(context.request);
  }
  const isPublic = publicPaths.includes(path);
  const isPublicPressRoute = /^\/press\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
  const isAuthApi = path.startsWith("/api/auth");
  const isNativeSignIn = path === "/api/native/sign-in" || path === "/api/native/browser-sign-in" || path === "/native-sign-in";
  const isInvitationPath = path === "/invite" || path.startsWith("/invite/");
  const isInvitationAcceptance = [
    "/api/invitations/accept",
  ].includes(path);

  // Validate the HttpOnly session server-side, before rendering either entry page.
  // Never infer authentication from the mere presence of a cookie.
  if (path === "/" || path === "/login") {
    const session = await auth.api.getSession({ headers: context.request.headers });
    return withPrivateCachePolicy(session ? context.redirect("/dashboard") : await next());
  }

  if (path === "/artist-portal" || path === "/api/artist-portal") {
    const response = withPrivateCachePolicy(await next());
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (isPublic || isPublicPressRoute || isNativeSignIn) {
    const response = await next();
    if (path === "/reset-password") return withPrivateCachePolicy(response);
    return isPublicPressRoute ? withPublicCachePolicy(response) : response;
  }

  if (isAuthApi) {
    return withPrivateCachePolicy(await next());
  }

  if (isLocalToolApi) {
    return withPrivateCachePolicy(await next());
  }

  const native = isNativeApi ? bearerToken(context.request) : null;
  const session = isNativeApi
    ? native && await getNativeSession(native).then((row) => row && ({ user: row.user, session: row.session }))
    : await auth.api.getSession({ headers: context.request.headers });

  if (isInvitationPath || isInvitationAcceptance || path === "/native-handoff") {
    if (session) {
      (context.locals as any).user = session.user;
      (context.locals as any).session = session.session;
    }
    // Handoffs validate their exact workspace independently; never select or
    // provision a browser workspace before the user confirms the destination.
    return withPrivateCachePolicy(await next());
  }

  if (!session) {
    if (isNativeApi) return json({ error: "Authentication required", code: "native_session_unauthorized" }, 401);
    return withPrivateCachePolicy(context.redirect("/login"));
  }

  (context.locals as any).user = session.user;
  (context.locals as any).session = session.session;

  // Native routes use bearer authentication only. They never participate in
  // browser workspace persistence or onboarding; each native route resolves
  // its own exact membership selection where applicable.
  if (isNativeApi) {
    // PostgreSQL transaction options must be established before nested route
    // contexts resolve workspace access. Keep existing read-only snapshots.
    const readOnly = /^\/api\/native\/(?:budget|grants)\/?$/.test(path)
      || /^\/api\/native\/campaigns\/[^/]+\/public-page\/?$/.test(path);
    const transactionOptions = requiresRepeatableRead(context.request.method)
      ? { isolationLevel: "repeatable read" as const, ...(readOnly ? { accessMode: "read only" as const } : {}) }
      : undefined;
    return withPrivateCachePolicy(await runWithDatabaseContext({ userId: session.user.id }, next, transactionOptions));
  }

  const activeOrg = await runWithDatabaseContext(
    { userId: session.user.id },
    () => resolveActiveOrgForUser(
      session.user,
      context.cookies.get(ACTIVE_ORG_COOKIE)?.value,
    ),
  );

  context.locals.orgId = activeOrg.org.id;
  context.locals.org = activeOrg.org;
  context.locals.membershipRole = activeOrg.role;

  if (activeOrg.role === "payee" && !isPayeePortalPath(path)) {
    if (path.startsWith("/api/")) {
      return withPrivateCachePolicy(json({ error: "Payee portal access required" }, 403));
    }
    return withPrivateCachePolicy(context.redirect("/payee"));
  }

  if (context.cookies.get(ACTIVE_ORG_COOKIE)?.value !== activeOrg.org.id) {
    context.cookies.set(ACTIVE_ORG_COOKIE, activeOrg.org.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: context.url.protocol === "https:",
      path: "/",
    });
  }

  const transactionOptions = requiresRepeatableRead(context.request.method)
    || isCampaignOsMutation(context.request.method, path)
    ? { isolationLevel: "repeatable read" as const }
    : undefined;
  return withPrivateCachePolicy(await runWithDatabaseContext(
    { userId: session.user.id, orgId: activeOrg.org.id },
    next,
    transactionOptions,
  ));
}

function requiresRepeatableRead(method: string): boolean {
  return method.toUpperCase() === "GET";
}

function isCampaignOsMutation(method: string, path: string): boolean {
  return method.toUpperCase() === "POST" && /^\/api\/campaigns\/[^/]+\/os\/?$/.test(path);
}

function isPayeePortalPath(path: string): boolean {
  return path === "/payee"
    || path.startsWith("/payee/")
    || path === "/api/payee"
    || path.startsWith("/api/payee/");
}

function isUnsafeMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function withPrivateCachePolicy(response: Response): Response {
  // Preserve React hydration markup: CDN email obfuscation rewrites private HTML.
  const html = response.headers.get("Content-Type")?.includes("text/html");
  response.headers.set("Cache-Control", html ? "private, no-store, no-transform" : "private, no-store");
  response.headers.set("Vary", appendVary(response.headers.get("Vary"), "Cookie"));
  return response;
}

// Press pages are validated public content with no session or organization state.
// Keep their CDN/browser cache short-lived so publication changes converge promptly.
function withPublicCachePolicy(response: Response): Response {
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=60");
  return response;
}

function appendVary(current: string | null, value: string): string {
  const values = new Set(
    (current ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  values.add(value);
  return Array.from(values).join(", ");
}
