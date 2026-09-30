import type { APIRoute } from "astro";
import { auth } from "../../../lib/auth";
import { exchangeBrowserCode, issueBrowserCode, validBrowserNonce } from "../../../server/native-browser-sign-in";
import { requireSameOrigin } from "../../../server/request-security";
import { HttpError } from "../../../server/errors";

export const prerender = false;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json().catch(() => null);
    if (body?.action === "authorize") {
      requireSameOrigin(request);
      if (!validBrowserNonce(body.challenge) || !validBrowserNonce(body.state)) throw new HttpError("Invalid sign-in request", 400);
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) throw new HttpError("Authentication required", 401);
      const code = await issueBrowserCode(session.session.id, body.challenge);
      const callback = new URL("online.truenature.labelsuite://sign-in");
      callback.search = new URLSearchParams({ code, state: body.state }).toString();
      return response({ callback: callback.href });
    }
    if (body?.action !== "exchange" || !validBrowserNonce(body.code) || !validBrowserNonce(body.verifier)) throw new HttpError("Invalid sign-in request", 400);
    return response(await exchangeBrowserCode(body.code, body.verifier));
  } catch (error) {
    if (error instanceof HttpError) return response({ error: error.message }, error.status);
    throw error;
  }
};
