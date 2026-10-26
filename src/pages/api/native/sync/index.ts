import type { APIRoute } from "astro";
import { runWithDatabaseContext } from "../../../../lib/db";
import { resolveNativeActor } from "../../../../lib/native-workspace";
import { hasCapability } from "../../../../server/native-capabilities";
import { handleApiError, json, parseJson } from "../../../../server/api";
import {
  getSyncDeal,
  listSyncDeals,
  recordSyncReceipt,
  saveSyncDeal,
  syncMutationSchema,
  syncOptions,
} from "../../../../server/sync";
export const prerender = false;
const handle: APIRoute = async ({ request, url }) => {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) return json({ error: "Authentication required" }, 401);
    if (!hasCapability(actor.workspace.role, "operations.mutate"))
      return json({ error: "Insufficient permissions" }, 403);
    return await runWithDatabaseContext(
      { userId: actor.userId, orgId: actor.workspace.org.id },
      async () => {
        const org = actor.workspace.org.id;
        if (request.method === "GET") {
          const id = url.searchParams.get("id");
          return json({
            ...(id
              ? { record: await getSyncDeal(org, id) }
              : { items: await listSyncDeals(org) }),
            options: await syncOptions(org),
          });
        }
        const body = await parseJson(request, syncMutationSchema);
        return json(
          body.action === "save"
            ? await saveSyncDeal(org, actor.userId, body.input)
            : await recordSyncReceipt(org, actor.userId, body.input),
        );
      },
    );
  } catch (e) {
    return handleApiError(e);
  }
};
export const GET = handle;
export const POST = handle;
