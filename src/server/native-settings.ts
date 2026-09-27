import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { users } from "../db/auth-schema";
import { artists, releases, calendar_connections, integration_connections, integration_errors, integration_providers, org_memberships, orgs, sync_jobs } from "../db/schema";
import { db, runWithDatabaseContext } from "../lib/db";
import { HttpError } from "./errors";
import { hasCapability, type MembershipRole } from "./native-capabilities";

export const nativeSettingsScope = z.object({
  membersOffset: z.coerce.number().int().min(0).max(10000).default(0),
  integrationsOffset: z.coerce.number().int().min(0).max(10000).default(0),
}).strict();

// Product-owned exceptions from the native parity contract. A null destination is deliberate.
export function nativeWebExceptions(role: MembershipRole) {
  const entries = [];
  if (hasCapability(role, "integrations.manage")) {
    entries.push({ id: "analytics-import", title: "Analytics imports and reconciliation", destination: "/analytics?section=data-health", reason: "Source inspection and reconciliation require the full web workspace.", risk: "An import can change reporting data. Review its source and validation results before applying it.", reconsiderWhen: "A native workflow proves source inspection, validation, reconciliation and failure recovery together." });
    entries.push({ id: "integration-credentials", title: "Integration configuration", destination: "/integrations", reason: "Credential administration uses the reviewed web controls.", risk: "Changing credentials can interrupt synchronization or grant provider access.", reconsiderWhen: "A dedicated secure native credential flow is independently specified and reviewed." });
  }
  if (hasCapability(role, "royalties.mutate")) {
    entries.push({ id: "royalty-import", title: "Royalty source imports", destination: "/royalties", reason: "Statement inspection and reconciliation require the full web workspace.", risk: "Source imports affect royalty evidence. Opening the workspace does not import a statement or execute payment.", reconsiderWhen: "A native workflow proves source validation, reconciliation and failure recovery together." });
  }
  if (hasCapability(role, "operations.mutate")) {
    entries.push({ id: "local-tool-tokens", title: "Local-tool tokens", destination: "/settings?section=codex-tools", reason: "Token administration uses the reviewed web controls.", risk: "Tokens grant access to workspace data. Do not share or capture their secret values.", reconsiderWhen: "A dedicated secure native token flow is independently specified and reviewed." });
    entries.push({ id: "destructive-bulk", title: "Destructive bulk operations", destination: null, reason: "Bulk selection and consequence review require an approved operation-specific web workflow.", risk: "Bulk changes can affect many records. No operation or destination has been selected here.", reconsiderWhen: "Native selection, consequence review, recovery and audit behavior are proven." });
  }
  if (role !== "payee") entries.push({ id: "payment-execution", title: "Payment execution", destination: null, reason: "No native payment-execution authority is approved.", risk: "Opening evidence or a payout preview never transfers money.", reconsiderWhen: "Separate financial authority and provider approval explicitly authorize execution." });
  return entries;
}

const handoffScope = z.object({
  workspaceId: z.string().min(1).max(200),
  operation: z.string().min(1).max(100),
  artist: z.string().min(1).max(200).optional(),
  release: z.string().min(1).max(200).optional(),
}).strict();

export async function getNativeHandoff(userId: string, raw: unknown) {
  const scope = handoffScope.parse(raw);
  return runWithDatabaseContext({ orgId: scope.workspaceId, userId }, async () => {
    const [membership] = await db.select({ role: org_memberships.role, name: orgs.name })
      .from(org_memberships).innerJoin(orgs, eq(orgs.id, org_memberships.org_id))
      .where(and(eq(org_memberships.org_id, scope.workspaceId), eq(org_memberships.user_id, userId))).for("share");
    if (!membership) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    const operation = nativeWebExceptions(membership.role as MembershipRole).find(item => item.id === scope.operation);
    if (!operation?.destination) throw new HttpError("This web operation is unavailable for your workspace role", 403);
    if (scope.operation !== "analytics-import" && (scope.artist || scope.release)) throw new HttpError("Unsupported destination scope", 400);
    const destination = new URL(operation.destination, "https://suite.invalid");
    if (scope.artist) {
      const [artist] = await db.select({ id: artists.id }).from(artists).where(and(eq(artists.org_id, scope.workspaceId), eq(artists.id, scope.artist)));
      if (!artist) throw new HttpError("Artist unavailable in this workspace", 404);
      destination.searchParams.set("artist", artist.id);
    }
    if (scope.release) {
      const [release] = await db.select({ id: releases.id, artist: releases.artist_id }).from(releases).where(and(eq(releases.org_id, scope.workspaceId), eq(releases.id, scope.release)));
      if (!release) throw new HttpError("Release unavailable in this workspace", 404);
      if (scope.artist && release.artist !== scope.artist) throw new HttpError("Release does not belong to the selected artist", 400);
      destination.searchParams.set("release", release.id);
    }
    return { ...operation, destination: destination.pathname + destination.search, workspaceId: scope.workspaceId, workspaceName: membership.name };
  }, { isolationLevel: "repeatable read" });
}

export async function getNativeSettings(orgId: string, userId: string, raw: unknown = {}) {
  const scope = nativeSettingsScope.parse(raw);
  return db.transaction(async tx => {
    const [membership] = await tx.select({ role: org_memberships.role }).from(org_memberships)
      .where(and(eq(org_memberships.org_id, orgId), eq(org_memberships.user_id, userId))).for("share");
    if (!membership) throw new HttpError("Workspace access removed", 403, "workspace_access_removed");
    const role = membership.role as MembershipRole;
    const [account] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId));
    const [workspace] = await tx.select({ id: orgs.id, name: orgs.name }).from(orgs).where(eq(orgs.id, orgId));
    const members = role === "payee" ? null : await tx.select({ id: org_memberships.id, name: users.name, role: org_memberships.role })
      .from(org_memberships).innerJoin(users, eq(users.id, org_memberships.user_id))
      .where(eq(org_memberships.org_id, orgId)).orderBy(asc(users.name), asc(org_memberships.id)).limit(51).offset(scope.membersOffset);
    const canViewIntegrations = hasCapability(role, "integrations.manage");
    const connections = !canViewIntegrations ? null : await tx.select({
      id: integration_connections.id, provider: integration_providers.name, status: integration_connections.status,
      lastCheckedAt: integration_connections.last_checked_at, lastSuccessfulSyncAt: integration_connections.last_successful_sync_at,
      hasUnresolvedErrors: sql<boolean>`exists(select 1 from ${integration_errors} where ${integration_errors.org_id} = ${orgId} and ${integration_errors.connection_id} = ${integration_connections.id} and ${integration_errors.resolved_at} is null)`,
      latestSyncStatus: sql<string | null>`(select ${sync_jobs.status} from ${sync_jobs} where ${sync_jobs.org_id} = ${orgId} and ${sync_jobs.connection_id} = ${integration_connections.id} order by ${sync_jobs.created_at} desc, ${sync_jobs.id} desc limit 1)`,
    }).from(integration_connections).innerJoin(integration_providers, and(eq(integration_providers.id, integration_connections.provider_id), eq(integration_providers.org_id, orgId)))
      .where(eq(integration_connections.org_id, orgId)).orderBy(asc(integration_connections.id)).limit(51).offset(scope.integrationsOffset);
    const calendar = !canViewIntegrations ? null : (await tx.select({
      status: sql<string>`case when ${calendar_connections.refresh_token} is null then 'disconnected' when ${calendar_connections.error} is not null then 'needs_attention' when ${calendar_connections.calendar_id} is null then 'needs_selection' else 'connected' end`,
      lastSuccessfulSyncAt: calendar_connections.last_synced_at,
    }).from(calendar_connections).where(eq(calendar_connections.org_id, orgId)).limit(1))[0] ?? { status: "not_connected", lastSuccessfulSyncAt: null };
    return {
      account, workspace: { ...workspace, role }, fetchedAt: new Date().toISOString(),
      members: members && { items: members.slice(0, 50), offset: scope.membersOffset, hasMore: members.length > 50 },
      integrations: connections && { items: connections.slice(0, 50), offset: scope.integrationsOffset, hasMore: connections.length > 50, calendar, basis: "Stored connection and sync evidence; not a live provider check." },
      webExceptions: nativeWebExceptions(role),
    };
  }, { isolationLevel: "repeatable read" });
}
