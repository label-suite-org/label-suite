import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ConflictError, HttpError } from "./errors";

const memberService = vi.hoisted(() => ({
  acceptInvitation: vi.fn(),
  changeMemberRole: vi.fn(),
  createInvitation: vi.fn(),
  getInvitationContext: vi.fn(),
  listWorkspaceInvitations: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  removeMember: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
const authPolicy = vi.hoisted(() => ({
  getSession: vi.fn(),
  resolveActiveOrgForUser: vi.fn(),
}));

vi.mock("./member-invitations", () => memberService);
vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../lib/auth", () => ({ auth: { api: { getSession: authPolicy.getSession } } }));
vi.mock("./tenant", async (importOriginal) => ({
  ...await importOriginal<typeof import("./tenant")>(),
  resolveActiveOrgForUser: authPolicy.resolveActiveOrgForUser,
}));

describe("member and invitation route policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PUBLIC_SITE_URL = "https://labels.example/app-path-is-ignored";
  });

  it("lists workspace members for an authenticated organization member", { timeout: 15_000 }, async () => {
    memberService.listWorkspaceMembers.mockResolvedValue([
      { userId: "member-1", email: "member@example.com", role: "member" },
    ]);
    const { GET } = await import("../pages/api/members/index");

    const response = await GET({ locals: { orgId: "org-1", membershipRole: "member" } } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      { userId: "member-1", email: "member@example.com", role: "member" },
    ]);
    expect(memberService.listWorkspaceMembers).toHaveBeenCalledWith("org-1");
  });

  it("lists invitations for owners without token material", async () => {
    memberService.listWorkspaceInvitations.mockResolvedValue([
      { id: "invite-1", email: "invitee@example.com", tokenDigest: "secret-digest", token_digest: "secret-digest" },
    ]);
    const { GET } = await import("../pages/api/invitations/index");

    const response = await GET({ locals: { orgId: "org-1", membershipRole: "owner" } } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([{ id: "invite-1", email: "invitee@example.com" }]);
  });

  it.each(["operator", "fundraiser", "member", "payee"])("denies invitation history to %s", async (role) => {
    const { GET } = await import("../pages/api/invitations/index");
    const response = await GET({ locals: { orgId: "org-1", membershipRole: role } } as never);
    expect(response.status).toBe(403);
    expect(memberService.listWorkspaceInvitations).not.toHaveBeenCalled();
  });

  it("exchanges a fragment token into an HttpOnly continuation cookie without returning it", async () => {
    const { POST } = await import("../pages/invite/exchange");
    const token = "raw-fragment-token-0123456789abcdef";
    const request = new Request("https://labels.example/invite/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ token }),
    });
    const set = vi.fn();
    const response = await POST({ request, url: new URL(request.url), locals: {}, cookies: { set } } as never);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.url).not.toContain(token);
    expect(await response.text()).not.toContain(token);
    expect(set).toHaveBeenCalledWith("label_suite_invitation", token, expect.objectContaining({ httpOnly: true, path: "/" }));
  });

  it("rejects cross-origin fragment exchange without storing the token", async () => {
    const { POST } = await import("../pages/invite/exchange");
    const set = vi.fn();
    const request = new Request("https://labels.example/invite/exchange", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ token: "secret" }),
    });
    const response = await POST({ request, url: new URL(request.url), locals: {}, cookies: { set } } as never);
    expect(response.status).toBe(403);
    expect(set).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("returns invitation email context only to a valid continuation cookie holder", async () => {
    memberService.getInvitationContext.mockResolvedValue({ email: "invitee@example.com" });
    const { GET } = await import("../pages/invite/context");
    const valid = await GET({ cookies: { get: vi.fn(() => ({ value: "continuation-token" })) } } as never);
    expect(valid.status).toBe(200);
    await expect(valid.json()).resolves.toEqual({ email: "invitee@example.com" });
    expect(valid.headers.get("cache-control")).toContain("no-store");

    const missing = await GET({ cookies: { get: vi.fn(() => undefined) } } as never);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "Invitation is invalid or expired",
      code: "INVITATION_INVALID",
    });
  });

  it("allows only owners to create invitations", async () => {
    const { POST } = await import("../pages/api/invitations/index");
    const request = new Request("https://labels.example/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ email: "invitee@example.com", role: "fundraiser" }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "member", user: { id: "member-1", name: "Member" } },
    } as never);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Insufficient permissions" });
    expect(memberService.createInvitation).not.toHaveBeenCalled();
  });

  it("passes the owner actor to member role changes", async () => {
    memberService.changeMemberRole.mockResolvedValue({ ok: true, role: "fundraiser" });
    const { PATCH } = await import("../pages/api/members/[userId]");
    const request = new Request("https://labels.example/api/members/user-2", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-request-id": "caller-controlled", origin: "https://labels.example" },
      body: JSON.stringify({ role: "fundraiser" }),
    });

    const response = await PATCH({
      request,
      params: { userId: "user-2" },
      locals: { requestId: "request-1", orgId: "org-1", membershipRole: "owner", user: { id: "owner-1" } },
    } as never);

    expect(response.status).toBe(200);
    expect(memberService.changeMemberRole).toHaveBeenCalledWith({
      orgId: "org-1",
      userId: "user-2",
      role: "fundraiser",
      actorUserId: "owner-1",
      requestId: "request-1",
    });
  });

  it("returns the last-owner removal conflict without deleting the owner", async () => {
    memberService.removeMember.mockRejectedValue(new ConflictError("The last workspace owner cannot be removed"));
    const { DELETE } = await import("../pages/api/members/[userId]");
    const request = new Request("https://labels.example/api/members/owner-1", {
      method: "DELETE",
      headers: { origin: "https://labels.example" },
    });

    const response = await DELETE({
      request,
      params: { userId: "owner-1" },
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "owner-1" } },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "The last workspace owner cannot be removed" });
    expect(memberService.removeMember).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      userId: "owner-1",
      actorUserId: "owner-1",
    }));
  });

  it("allows only owners to resend invitations and records the owner actor", async () => {
    memberService.resendInvitation.mockResolvedValue({
      invitation: { id: "invite-1", tokenDigest: "secret-digest" },
      delivery: { status: "sent" },
    });
    const { POST } = await import("../pages/api/invitations/[id]/resend");
    const request = new Request("https://labels.example/api/invitations/invite-1/resend", {
      method: "POST",
      headers: { origin: "https://labels.example" },
    });

    const denied = await POST({
      request,
      url: new URL(request.url),
      params: { id: "invite-1" },
      locals: { orgId: "org-1", membershipRole: "member", user: { id: "member-1" } },
    } as never);
    expect(denied.status).toBe(403);

    const allowed = await POST({
      request,
      url: new URL(request.url),
      params: { id: "invite-1" },
      locals: {
        orgId: "org-1",
        membershipRole: "owner",
        user: { id: "owner-1", name: "Owner" },
        org: { id: "org-1", name: "True Nature", slug: "true-nature", plan: null },
      },
    } as never);
    expect(allowed.status).toBe(200);
    await expect(allowed.json()).resolves.toEqual({
      invitation: { id: "invite-1" },
      delivery: { status: "sent" },
    });
    expect(memberService.resendInvitation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      invitationId: "invite-1",
      actorUserId: "owner-1",
      acceptBaseUrl: "https://labels.example/invite",
    }));
  });

  it("allows only owners to revoke invitations and records the owner actor", async () => {
    memberService.revokeInvitation.mockResolvedValue({ ok: true });
    const { POST } = await import("../pages/api/invitations/[id]/revoke");
    const request = new Request("https://labels.example/api/invitations/invite-1/revoke", {
      method: "POST",
      headers: { origin: "https://labels.example" },
    });

    const denied = await POST({
      request,
      params: { id: "invite-1" },
      locals: { orgId: "org-1", membershipRole: "operator", user: { id: "operator-1" } },
    } as never);
    expect(denied.status).toBe(403);

    const allowed = await POST({
      request,
      params: { id: "invite-1" },
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "owner-1" } },
    } as never);
    expect(allowed.status).toBe(200);
    expect(memberService.revokeInvitation).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      invitationId: "invite-1",
      actorUserId: "owner-1",
    }));
  });

  it("returns 401 when an anonymous caller tries to accept an invitation", async () => {
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({}),
    });

    const response = await POST({ request, locals: {}, cookies: { set: vi.fn() } } as never);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
    expect(memberService.acceptInvitation).not.toHaveBeenCalled();
  });

  it("returns the neutral invalid-invitation response when the signed-in email does not match", async () => {
    memberService.acceptInvitation.mockRejectedValue(new HttpError("Invitation is invalid or expired", 400, "INVITATION_INVALID"));
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({}),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { user: { id: "wrong-user", email: "wrong@example.com" } },
      cookies: { get: vi.fn(() => ({ value: "invite-token" })), set: vi.fn(), delete: vi.fn() },
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Invitation is invalid or expired",
      code: "INVITATION_INVALID",
    });
  });

  it("accepts without an active organization, selects the invited organization, and redirects", async () => {
    memberService.acceptInvitation.mockResolvedValue({ orgId: "invited-org", role: "fundraiser", alreadyAccepted: false });
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({}),
    });
    const setCookie = vi.fn();
    const deleteCookie = vi.fn();

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { user: { id: "invitee", email: "invitee@example.com" } },
      cookies: { get: vi.fn(() => ({ value: "invite-token" })), set: setCookie, delete: deleteCookie },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ redirectTo: "/grants" });
    expect(memberService.acceptInvitation).toHaveBeenCalledWith(expect.objectContaining({ token: "invite-token" }));
    expect(setCookie).toHaveBeenCalledWith("label_suite_org_id", "invited-org", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
    expect(deleteCookie).toHaveBeenCalledWith("label_suite_invitation", { path: "/" });
  });

  it("clears continuation state when acceptance finds an invalid or expired invitation", async () => {
    memberService.acceptInvitation.mockRejectedValue(new HttpError("Safe neutral state", 400, "INVITATION_INVALID"));
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({}),
    });
    const deleteCookie = vi.fn();

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { user: { id: "invitee", email: "invitee@example.com" } },
      cookies: { get: vi.fn(() => ({ value: "expired-token" })), set: vi.fn(), delete: deleteCookie },
    } as never);

    expect(response.status).toBe(400);
    expect(deleteCookie).toHaveBeenCalledWith("label_suite_invitation", { path: "/" });
  });

  it("rejects a missing continuation cookie and ignores injected body tokens", async () => {
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ token: "injected-token" }),
    });
    const response = await POST({
      request, url: new URL(request.url), locals: { user: { id: "invitee", email: "invitee@example.com" } },
      cookies: { get: vi.fn(() => undefined), set: vi.fn(), delete: vi.fn() },
    } as never);
    expect(response.status).toBe(400);
    expect(memberService.acceptInvitation).not.toHaveBeenCalled();
  });

  it("uses JSON acceptance in the authenticated invitation gate", () => {
    const source = readFileSync(new URL("../components/auth/InvitationGate.tsx", import.meta.url), "utf8");
    expect(source).toContain('fetch("/api/invitations/accept"');
    expect(source).toContain('method: "POST"');
    expect(source).toContain('credentials: "same-origin"');
    expect(source).toContain('body: JSON.stringify({})');
    expect(source).toContain('window.location.replace("/grants")');
    expect(source).not.toContain('action="/invite/continue"');
  });

  it("uses PUBLIC_SITE_URL instead of the request host in invitation email links", async () => {
    memberService.createInvitation.mockResolvedValue({
      invitation: { id: "invite-1" },
      delivery: { status: "sent" },
    });
    const { POST } = await import("../pages/api/invitations/index");
    const request = new Request("https://attacker.example/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ email: "invitee@example.com", role: "fundraiser" }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: {
        orgId: "org-1",
        membershipRole: "owner",
        user: { id: "owner-1", name: "Owner" },
        org: { id: "org-1", name: "True Nature", slug: "true-nature", plan: null },
      },
    } as never);

    expect(response.status).toBe(201);
    expect(memberService.createInvitation).toHaveBeenCalledWith(expect.objectContaining({
      acceptBaseUrl: "https://labels.example/invite",
    }));
  });

  it("rejects cross-origin invitation creation before calling the service", async () => {
    const { POST } = await import("../pages/api/invitations/index");
    const request = new Request("https://labels.example/api/invitations", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example" },
      body: JSON.stringify({ email: "invitee@example.com", role: "fundraiser" }),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "owner-1" } },
    } as never);

    expect(response.status).toBe(403);
    expect(memberService.createInvitation).not.toHaveBeenCalled();
  });

  it.each([
    ["member role change", () => import("../pages/api/members/[userId]").then((route) => route.PATCH),
      new Request("https://labels.example/api/members/user-2", {
        method: "PATCH", headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({ role: "member" }),
      }), { params: { userId: "user-2" } }],
    ["member removal", () => import("../pages/api/members/[userId]").then((route) => route.DELETE),
      new Request("https://labels.example/api/members/user-2", {
        method: "DELETE", headers: { origin: "https://attacker.example" },
      }), { params: { userId: "user-2" } }],
    ["invitation resend", () => import("../pages/api/invitations/[id]/resend").then((route) => route.POST),
      new Request("https://labels.example/api/invitations/invite-1/resend", {
        method: "POST", headers: { origin: "https://attacker.example" },
      }), { params: { id: "invite-1" } }],
    ["invitation revoke", () => import("../pages/api/invitations/[id]/revoke").then((route) => route.POST),
      new Request("https://labels.example/api/invitations/invite-1/revoke", {
        method: "POST", headers: { origin: "https://attacker.example" },
      }), { params: { id: "invite-1" } }],
    ["invitation acceptance", () => import("../pages/api/invitations/accept").then((route) => route.POST),
      new Request("https://labels.example/api/invitations/accept", {
        method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" },
        body: JSON.stringify({}),
      }), { cookies: { get: vi.fn(() => ({ value: "invite-token" })), set: vi.fn(), delete: vi.fn() } }],
  ])("rejects cross-origin %s", async (_label, loadHandler, request, extra) => {
    const handler = await loadHandler();
    const response = await handler({
      request,
      url: new URL(request.url),
      locals: { orgId: "org-1", membershipRole: "owner", user: { id: "owner-1", email: "owner@example.com" } },
      ...extra,
    } as never);
    expect(response.status).toBe(403);
  });

  it("rejects an unsafe mutation when Origin is missing", async () => {
    const { POST } = await import("../pages/api/invitations/accept");
    const request = new Request("https://labels.example/api/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST({
      request,
      url: new URL(request.url),
      locals: { user: { id: "invitee", email: "invitee@example.com" } },
      cookies: { get: vi.fn(() => ({ value: "invite-token" })), set: vi.fn(), delete: vi.fn() },
    } as never);

    expect(response.status).toBe(403);
  });
});

describe("invitation middleware policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads the session for an invitation without resolving an active organization", async () => {
    authPolicy.getSession.mockResolvedValue({
      user: { id: "invitee", email: "invitee@example.com" },
      session: { id: "session-1" },
    });
    const { onRequest } = await import("../middleware");
    const next = vi.fn().mockResolvedValue(new Response("invite"));
    const locals: Record<string, unknown> = {};

    const response = await onRequest({
      url: new URL("https://labels.example/invite/token"),
      request: new Request("https://labels.example/invite/token"),
      cookies: { get: vi.fn(), set: vi.fn() },
      locals,
    } as never, next);

    expect(response).toBeInstanceOf(Response);
    expect(await (response as Response).text()).toBe("invite");
    expect(locals.user).toEqual({ id: "invitee", email: "invitee@example.com" });
    expect(authPolicy.resolveActiveOrgForUser).not.toHaveBeenCalled();
  });

  it.each(["/invite", "/invite/exchange", "/invite/context"])("keeps %s organization-independent", async (path) => {
    authPolicy.getSession.mockResolvedValue(null);
    const { onRequest } = await import("../middleware");
    const next = vi.fn().mockResolvedValue(new Response("invite"));
    await onRequest({
      url: new URL(`https://labels.example${path}`),
      request: new Request(`https://labels.example${path}`),
      cookies: { get: vi.fn(), set: vi.fn() },
      locals: {},
    } as never, next);
    expect(next).toHaveBeenCalled();
    expect(authPolicy.resolveActiveOrgForUser).not.toHaveBeenCalled();
  });
});

describe("public press middleware policy", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes a signed-out press slug through to the Astro renderer with public caching", async () => {
    authPolicy.getSession.mockResolvedValue(null);
    const { onRequest } = await import("../middleware");
    const next = vi.fn().mockResolvedValue(new Response("press page", { status: 200 }));
    const response = await onRequest({
      url: new URL("https://labels.example/press/example"),
      request: new Request("https://labels.example/press/example"),
      cookies: { get: vi.fn(), set: vi.fn() },
      locals: {},
    } as never, next) as Response;

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300, stale-while-revalidate=60");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(authPolicy.getSession).not.toHaveBeenCalled();
  });

  it("keeps the reset-password renderer response private", async () => {
    authPolicy.getSession.mockResolvedValue(null);
    const { onRequest } = await import("../middleware");
    const next = vi.fn().mockResolvedValue(new Response("reset form", { status: 200 }));
    const response = await onRequest({
      url: new URL("https://labels.example/reset-password"),
      request: new Request("https://labels.example/reset-password"),
      cookies: { get: vi.fn(), set: vi.fn() },
      locals: {},
    } as never, next) as Response;

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");
    expect(authPolicy.getSession).not.toHaveBeenCalled();
  });

  it.each([
    "/press",
    "/press/",
    "/press/Example",
    "/press/example_edition",
    "/press/example.edition",
    "/press/example..edition",
    "/press/example%2Fedition",
    "/press/example%5Cedition",
    "/press/example%00edition",
    "/press/example/extra",
  ])("does not make non-canonical %s public by prefix", async (path) => {
    authPolicy.getSession.mockResolvedValue(null);
    const { onRequest } = await import("../middleware");
    const next = vi.fn().mockResolvedValue(new Response("should not render"));
    const response = await onRequest({
      url: new URL(`https://labels.example${path}`),
      request: new Request(`https://labels.example${path}`),
      cookies: { get: vi.fn(), set: vi.fn() },
      locals: {},
      redirect: vi.fn(() => new Response(null, { status: 302, headers: { Location: "https://labels.example/login" } })),
    } as never, next) as Response;

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://labels.example/login");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
