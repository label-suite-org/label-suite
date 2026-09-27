import type { APIRoute } from "astro";
import { eq } from "drizzle-orm";
import { sessions } from "../../../db/auth-schema";
import { db } from "../../../lib/db";
import { bearerToken, getNativeSession } from "../../../lib/native-session";

export const prerender = false;

/** Revoke only the native bearer session presented by this device. */
export const POST: APIRoute = async ({ request }) => {
  const token = bearerToken(request);
  const session = token ? await getNativeSession(token) : null;
  if (!session) return new Response(JSON.stringify({ error: "Authentication required", code: "native_session_unauthorized" }), { status: 401, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
  await db.delete(sessions).where(eq(sessions.id, session.session.id));
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
};
