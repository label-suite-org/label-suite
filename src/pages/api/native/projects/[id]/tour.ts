import type { APIRoute } from "astro";
import { bearerToken, getNativeSession } from "../../../../../lib/native-session";
import { resolveNativeActor } from "../../../../../lib/native-workspace";
import { runWithDatabaseContext } from "../../../../../lib/db";
import { getNativeTourDashboard } from "../../../../../server/native-tour-dashboard";
import { handleApiError, json } from "../../../../../server/api";
import { hasCapability } from "../../../../../server/native-capabilities";
import { jobStore } from "../../../../../server/jobs";
export const prerender = false;
async function handle(request: Request, id: string | undefined, sync: boolean) {
  try {
    const actor = await resolveNativeActor(request);
    if (!actor) {
      const token = bearerToken(request), session = token ? await getNativeSession(token) : null;
      return session ? json({ error: "Workspace access removed", code: "workspace_access_removed" }, 403) : json({ error: "Authentication required" }, 401);
    }
    if (actor.workspace.role === "payee" || (sync && !hasCapability(actor.workspace.role, "integrations.manage"))) return json({ error: "Insufficient permissions" }, 403);
    if (!id) return json({ error: "Project required" }, 400);
    return await runWithDatabaseContext({ userId: actor.userId, orgId: actor.workspace.org.id }, async () => {
      const dashboard = await getNativeTourDashboard(actor.workspace.org.id, id);
      if (!dashboard) return json({ error: "Tour not found" }, 404);
      if (sync) {
        if (!dashboard.sync.enabled) return json({ error: "Square sync is not enabled" }, 409);
        await jobStore.enqueue({ orgId: actor.workspace.org.id, jobType: "tour_square_sync", trigger: "api", payload: { projectId: id }, idempotencyKey: `${id}:${Math.floor(Date.now() / 300_000)}`, maxAttempts: 3 });
        return json({ queued: true }, 202);
      }
      return json(dashboard);
    });
  } catch (error) { return handleApiError(error); }
}
export const GET: APIRoute = ({ request, params }) => handle(request, params.id, false);
export const POST: APIRoute = ({ request, params }) => handle(request, params.id, true);
