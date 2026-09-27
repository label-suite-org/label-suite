import { bearerToken, getNativeSession } from "./native-session";
import { resolveExistingMembership, type ActiveOrg } from "../server/tenant";
import { HttpError } from "../server/errors";

export async function resolveNativeActor(request: Request): Promise<{ workspace: ActiveOrg; userId: string } | null> {
  const token = bearerToken(request);
  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim();
  if (!token || !workspaceId) return null;
  const session = await getNativeSession(token);
  if (!session) return null;
  const workspace = await resolveExistingMembership(session.user.id, workspaceId);
  return workspace ? { workspace, userId: session.user.id } : null;
}

/** Resolve the explicitly selected workspace for a native bearer session. */
export async function resolveNativeWorkspace(request: Request): Promise<ActiveOrg | null> {
  return (await resolveNativeActor(request))?.workspace ?? null;
}

/** Matches the web middleware: payees are limited to payee portal routes. */
export function assertNativeCampaignReadAccess(actor: { workspace: ActiveOrg }): void {
  if (actor.workspace.role === "payee") {
    throw new HttpError("Insufficient permissions", 403, "insufficient_permissions");
  }
}
