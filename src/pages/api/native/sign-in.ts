import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth";

export const prerender = false;

/** Native clients receive the Better Auth session token without persisting it in a cookie. */
export const POST: APIRoute = async ({ request }) => {
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  headers.delete("authorization");
  const response = await auth.handler(new Request(new URL("/api/auth/sign-in/email", request.url), {
    method: "POST",
    headers,
    body: await request.text(),
  }));
  if (!response.ok) {
    const headers = new Headers(response.headers);
    headers.delete("set-cookie");
    headers.set("Cache-Control", "private, no-store");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  const payload = await response.json() as Record<string, unknown>;
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(?:^|,\s*)better-auth\.session_token=([^;]+)/);
  const token = typeof payload.token === "string" ? payload.token : match?.[1];
  if (!token) return new Response(JSON.stringify({ error: "Native session was not issued" }), {
    status: 502,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
  return new Response(JSON.stringify({ user: payload.user ?? null, token }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" },
  });
};
