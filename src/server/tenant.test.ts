import { describe, expect, test } from "vitest";
import {
  ROLE_CAPABILITIES,
  hasCapability,
  normalizeRole,
  requireCapability,
  type Capability,
  type MembershipRole,
} from "./tenant";

const ALL_CAPABILITIES = [
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
] as const satisfies readonly Capability[];

const EXPECTED_CAPABILITIES = {
  owner: ALL_CAPABILITIES,
  operator: ALL_CAPABILITIES.filter(
    (capability) => capability !== "workspace.manage_members" && capability !== "variance.decide",
  ),
  fundraiser: [
    "dashboard.manage_personal",
    "projects.mutate",
    "budgets.mutate",
    "fundraising.mutate",
    "contacts.mutate",
    "grant_documents.mutate",
  ],
  member: ["dashboard.manage_personal"],
  payee: ["dashboard.manage_personal"],
} as const satisfies Record<MembershipRole, readonly Capability[]>;

describe("tenant capabilities", () => {
  test.each(Object.entries(EXPECTED_CAPABILITIES) as Array<[MembershipRole, readonly Capability[]]>) (
    "%s receives exactly its assigned capabilities",
    (role, expected) => {
      expect(ROLE_CAPABILITIES[role]).toEqual(expected);
      for (const capability of ALL_CAPABILITIES) {
        expect(hasCapability(role, capability)).toBe(expected.includes(capability));
      }
    },
  );

  test("normalizes unknown and absent roles to member", () => {
    expect(normalizeRole("administrator")).toBe("member");
    expect(normalizeRole(null)).toBe("member");
  });

  test("returns the active org when the role has the capability", () => {
    expect(requireCapability(
      { orgId: "org-1", membershipRole: "fundraiser" },
      "fundraising.mutate",
    )).toBe("org-1");
  });

  test.each(["owner", "operator", "fundraiser", "member", "payee"] as const)(
    "%s can manage only their personal dashboard through the named capability",
    (role) => {
      expect(requireCapability(
        { orgId: "org-1", membershipRole: role },
        "dashboard.manage_personal",
      )).toBe("org-1");
    },
  );

  test("throws 403 when the role lacks the capability", () => {
    expect(() => requireCapability(
      { orgId: "org-1", membershipRole: "fundraiser" },
      "variance.decide",
    )).toThrow(expect.objectContaining({ status: 403, message: "Insufficient permissions" }));

    expect(() => requireCapability(
      { orgId: "org-1", membershipRole: "unexpected-role" },
      "projects.mutate",
    )).toThrow(expect.objectContaining({ status: 403 }));
  });
});
