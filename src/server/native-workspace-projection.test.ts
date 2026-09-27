import { describe, expect, it } from "vitest";
import { createNativeWorkspaceProjection } from "./native-workspace-projection";
import { serializeClientCapabilities } from "./native-capabilities";
import type { ActiveOrg } from "./tenant";

const workspace = (id: string, name: string, role: ActiveOrg["role"]): ActiveOrg => ({
  org: { id, name, slug: id, plan: null },
  role,
});

describe("native workspace projection boundary", () => {
  const memberships = new Map<string, ActiveOrg[]>([
    ["user-a", [workspace("org-a", "A", "operator")]],
    ["user-b", [workspace("org-b", "B", "member")]],
  ]);
  const projection = createNativeWorkspaceProjection({
    listUserMemberships: async (userId) => memberships.get(userId) ?? [],
  });

  it("lists only the workspaces belonging to the requesting user", async () => {
    await expect(projection.list("user-a")).resolves.toEqual([
      {
        ...workspace("org-a", "A", "operator"),
        capabilities: { ...serializeClientCapabilities("operator"), "budgets.read": true, "royalties.read": true, "analytics.read": true, "resources.read": true, "radio.read": true, "publicPages.read": true, "publicPages.publish": false },
      },
    ]);
    await expect(projection.list("user-a")).resolves.not.toEqual(expect.arrayContaining([
      expect.objectContaining({ org: expect.objectContaining({ id: "org-b" }) }),
    ]));
  });

  it("hides native resources from payees while preserving read access for other roles", async () => {
    for (const role of ["owner", "operator", "fundraiser", "member", "payee"] as const) {
      const scoped = createNativeWorkspaceProjection({ listUserMemberships: async () => [workspace("org", "Workspace", role)] });
      expect((await scoped.select("user", "org"))?.capabilities["resources.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["analytics.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["budgets.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["royalties.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["radio.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["publicPages.read"]).toBe(role !== "payee");
      expect((await scoped.select("user", "org"))?.capabilities["publicPages.publish"]).toBe(role === "owner");
    }
  });

  it("rejects selecting a workspace belonging to another user", async () => {
    await expect(projection.select("user-a", "org-b")).resolves.toBeNull();
  });

  it("serializes operator and read-only member capabilities from their roles", async () => {
    const [operator, member] = await Promise.all([projection.select("user-a", "org-a"), projection.select("user-b", "org-b")]);
    expect(operator?.capabilities).toEqual({ ...serializeClientCapabilities("operator"), "budgets.read": true, "royalties.read": true, "analytics.read": true, "resources.read": true, "radio.read": true, "publicPages.read": true, "publicPages.publish": false });
    expect(operator?.capabilities["operations.mutate"]).toBe(true);
    expect(member?.capabilities).toEqual({ ...serializeClientCapabilities("member"), "budgets.read": true, "royalties.read": true, "analytics.read": true, "resources.read": true, "radio.read": true, "publicPages.read": true, "publicPages.publish": false });
    expect(member?.capabilities["operations.mutate"]).toBe(false);
  });
});
