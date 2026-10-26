import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import {
  getSyncDeal,
  listSyncDeals,
  recordSyncReceipt,
  saveSyncDeal,
  syncMutationSchema,
  syncOptions,
} from "../../../server/sync";
export const prerender = false;
export const GET: APIRoute = async ({ locals, url }) => {
  try {
    const org = requireCapability(locals, "operations.mutate");
    const id = url.searchParams.get("id");
    return json({
      ...(id
        ? { record: await getSyncDeal(org, id) }
        : { items: await listSyncDeals(org) }),
      options: await syncOptions(org),
    });
  } catch (e) {
    return handleApiError(e);
  }
};
export const POST: APIRoute = async ({ locals, request }) => {
  try {
    const org = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, syncMutationSchema);
    return json(
      body.action === "save"
        ? await saveSyncDeal(org, locals.user!.id, body.input)
        : await recordSyncReceipt(org, locals.user!.id, body.input),
    );
  } catch (e) {
    return handleApiError(e);
  }
};
