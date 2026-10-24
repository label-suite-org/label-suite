import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { json } from "../../../../server/api";
import { fanId } from "../../../../server/fan-drops-core";
import { authenticateFanWebhook, recordFanWebhook } from "../../../../server/fan-feedback";
import { readFanJson, handleFanError } from "../../../../server/fan-request";
export const prerender = false;
export const POST: APIRoute = async ({ request, params }) => {
  try {
    const orgId = fanId.parse(params.org); authenticateFanWebhook(request, orgId);
    const input = await readFanJson(request);
    return json(await runWithDatabaseContext({ userId: "fan-webhook", orgId }, () => recordFanWebhook(orgId, input)));
  } catch (error) { return handleFanError(error); }
};
