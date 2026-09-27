import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../lib/native-session";
import { createNativeWorkspaceProjection } from "../../../server/native-workspace-projection";
import { listUserMemberships } from "../../../server/tenant";

export const prerender = false;

const workspaces = createNativeWorkspaceProjection({ listUserMemberships });

export const GET: APIRoute = async ({ request }) => {
  const token = bearerToken(request);
  const resolved = token ? await getNativeSession(token) : null;
  if (!resolved) return new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  const memberships = await workspaces.list(resolved.user.id);
  return new Response(JSON.stringify({
    user: { id: resolved.user.id, name: resolved.user.name, email: resolved.user.email },
    workspaces: memberships.map(({ org, role, capabilities }) => ({ org, role, capabilities })),
  }), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
};

export const POST: APIRoute = async ({ request }) => {
  const token = bearerToken(request);
  const resolved = token ? await getNativeSession(token) : null;
  if (!resolved) return new Response(JSON.stringify({ error: "Authentication required", code: "native_session_unauthorized" }), { status: 401 });
  const body = await request.json().catch(() => null);
  const workspaceId = typeof body === "object" && body && "workspaceId" in body && typeof body.workspaceId === "string" ? body.workspaceId : null;
  if (!workspaceId) return new Response(JSON.stringify({ error: "Workspace is required" }), { status: 400 });
  const active = await workspaces.select(resolved.user.id, workspaceId);
  if (!active) return new Response(JSON.stringify({ error: "Workspace access was removed", code: "workspace_access_removed" }), { status: 403 });
  return new Response(JSON.stringify({ org: active.org, role: active.role, capabilities: active.capabilities }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
};
