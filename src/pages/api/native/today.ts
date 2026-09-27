import type { APIRoute } from "astro";
import { resolveNativeActor } from "../../../lib/native-workspace";
import { getNativeSession } from "../../../lib/native-session";
import { listNativeToday } from "../../../server/native-today";
import { json } from "../../../server/api";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const session = token ? await getNativeSession(token) : null;
  if (!session) return json({ error: "Authentication required" }, 401);
  const actor = await resolveNativeActor(request);
  if (!actor) return json({ error: "Workspace access removed" }, 403);
  return json(await listNativeToday(actor.workspace.org.id, {
    userId: actor.userId,
    userName: session.user.name,
    userEmail: session.user.email,
    role: actor.workspace.role,
  }));
};
