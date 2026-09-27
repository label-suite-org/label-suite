import type { ClientCapabilityMap } from "../lib/client-capabilities";

export type MembershipRole = "owner" | "operator" | "fundraiser" | "member" | "payee";

export type Capability =
  | "dashboard.manage_personal"
  | "workspace.manage_members"
  | "workspace.manage_settings"
  | "projects.mutate"
  | "budgets.mutate"
  | "fundraising.mutate"
  | "contacts.mutate"
  | "grant_documents.mutate"
  | "integrations.manage"
  | "royalties.mutate"
  | "variance.decide"
  | "operations.mutate";

export const ROLE_CAPABILITIES: Readonly<Record<MembershipRole, readonly Capability[]>> = Object.freeze({
  owner: Object.freeze([
    "dashboard.manage_personal",
    "workspace.manage_members",
    "workspace.manage_settings",
    "projects.mutate",
    "budgets.mutate",
    "fundraising.mutate",
    "contacts.mutate",
    "grant_documents.mutate",
    "integrations.manage",
    "royalties.mutate",
    "variance.decide",
    "operations.mutate",
  ]),
  operator: Object.freeze([
    "dashboard.manage_personal",
    "workspace.manage_settings",
    "projects.mutate",
    "budgets.mutate",
    "fundraising.mutate",
    "contacts.mutate",
    "grant_documents.mutate",
    "integrations.manage",
    "royalties.mutate",
    "operations.mutate",
  ]),
  fundraiser: Object.freeze([
    "dashboard.manage_personal",
    "projects.mutate",
    "budgets.mutate",
    "fundraising.mutate",
    "contacts.mutate",
    "grant_documents.mutate",
  ]),
  member: Object.freeze(["dashboard.manage_personal"]),
  payee: Object.freeze(["dashboard.manage_personal"]),
} satisfies Record<MembershipRole, readonly Capability[]>);

export function hasCapability(role: MembershipRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function serializeClientCapabilities(role: MembershipRole): ClientCapabilityMap {
  return Object.fromEntries(
    ROLE_CAPABILITIES.owner.map((capability) => [capability, hasCapability(role, capability)]),
  ) as ClientCapabilityMap;
}
