import type { APIRoute } from "astro";
import { z } from "zod";
import { handleApiError, parseJson } from "../../server/api";
import { invitationCookieOptions, INVITATION_CONTINUATION_COOKIE } from "../../server/invitation-continuation";
import { requireSameOrigin } from "../../server/request-security";

const exchangeSchema = z.object({ token: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/) }).strict();

export const POST: APIRoute = async ({ request, url, cookies }) => {
  try {
    requireSameOrigin(request);
    const { token } = await parseJson(request, exchangeSchema);
    cookies.set(INVITATION_CONTINUATION_COOKIE, token, invitationCookieOptions(url));
    return privateResponse(null, 204);
  } catch (error) {
    return addPrivacyHeaders(handleApiError(error));
  }
};

function privateResponse(body: BodyInit | null, status: number) {
  return new Response(body, { status, headers: privacyHeaders() });
}

function addPrivacyHeaders(response: Response) {
  for (const [name, value] of privacyHeaders()) response.headers.set(name, value);
  return response;
}

function privacyHeaders(): Headers {
  return new Headers({ "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" });
}
