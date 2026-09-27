import type { APIRoute } from "astro";
import { handleApiError, json } from "../../../server/api";
import { buildGmailAuthUrl } from "../../../server/gmail-enrichment";
import { requireCapability } from "../../../server/tenant";

export const prerender = false;

export const POST: APIRoute = async ({ locals, url }) => {
  try {
    const orgId = requireCapability(locals, "integrations.manage");
    const user = locals.user;
    if (!user?.id) return json({ error: "Signed-in user is required" }, 401);

    return json({
      authUrl: buildGmailAuthUrl({
        orgId,
        userId: user.id,
        origin: url.origin,
      }),
    });
  } catch (err) {
    return handleApiError(err);
  }
};
