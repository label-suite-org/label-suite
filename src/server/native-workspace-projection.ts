import { serializeClientCapabilities } from "./native-capabilities";
import type { ActiveOrg } from "./tenant";

export interface NativeWorkspaceMembershipSource {
  listUserMemberships(userId: string): Promise<ActiveOrg[]>;
}

export interface NativeWorkspaceProjection {
  list(userId: string): Promise<Array<ActiveOrg & { capabilities: ReturnType<typeof serializeClientCapabilities> & { "budgets.read": boolean; "royalties.read": boolean; "analytics.read": boolean; "resources.read": boolean; "radio.read": boolean; "publicPages.read": boolean; "publicPages.publish": boolean } }>>;
  select(userId: string, workspaceId: string): Promise<(ActiveOrg & { capabilities: ReturnType<typeof serializeClientCapabilities> & { "budgets.read": boolean; "royalties.read": boolean; "analytics.read": boolean; "resources.read": boolean; "radio.read": boolean; "publicPages.read": boolean; "publicPages.publish": boolean } }) | null>;
}

export function createNativeWorkspaceProjection(source: NativeWorkspaceMembershipSource): NativeWorkspaceProjection {
  const project = (membership: ActiveOrg) => ({
    ...membership,
    capabilities: { ...serializeClientCapabilities(membership.role), "budgets.read": membership.role !== "payee", "royalties.read": membership.role !== "payee", "analytics.read": membership.role !== "payee", "resources.read": membership.role !== "payee", "radio.read": membership.role !== "payee", "publicPages.read": membership.role !== "payee", "publicPages.publish": membership.role === "owner" },
  });

  return {
    async list(userId) {
      return (await source.listUserMemberships(userId)).map(project);
    },
    async select(userId, workspaceId) {
      const membership = (await source.listUserMemberships(userId)).find(({ org }) => org.id === workspaceId);
      return membership ? project(membership) : null;
    },
  };
}
