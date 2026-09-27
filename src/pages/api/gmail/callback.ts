import type { APIRoute } from "astro";
import { handleGmailOAuthCallback } from "../../../server/gmail-enrichment";
import { getOrCreateRequestId } from "../../../server/request-context";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const GET: APIRoute = async ({ locals, url, redirect }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const user = locals.user;
    if (!user?.id) return redirect("/login");

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) return redirect(`/contacts?gmail=error&reason=${encodeURIComponent(error)}`);
    if (!code || !state) return redirect("/contacts?gmail=missing-code");

    await handleGmailOAuthCallback({
      code,
      state,
      currentOrgId: orgId,
      currentUserId: user.id,
      origin: url.origin,
    });

    return redirect("/contacts?gmail=connected");
  } catch (err) {
    const requestId = getOrCreateRequestId();
    console.error(`[gmail] OAuth callback failed for request ${requestId}`, err);
    return redirect(`/contacts?gmail=error&reason=gmail-error&request_id=${encodeURIComponent(requestId)}`);
  }
};
