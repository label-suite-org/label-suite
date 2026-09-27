import { describe, expect, it, vi } from "vitest";

const { bearerTokenMock, nativeSessionMock } = vi.hoisted(() => ({ bearerTokenMock: vi.fn<() => string | null>(() => crypto.randomUUID()), nativeSessionMock: vi.fn<() => Promise<{ user: { id: string; name: string; email: string }; session: { id: string } } | null>>(async () => ({
    user: { id: "user-a", name: "A", email: "a@example.test" },
    session: { id: crypto.randomUUID() },
  })) }));
vi.mock("../../../lib/native-session", () => ({
  bearerToken: bearerTokenMock,
  getNativeSession: nativeSessionMock,
}));
vi.mock("../../../server/tenant", () => ({
  listUserMemberships: vi.fn(async () => [{ org: { id: "org-a", name: "A", slug: "a", plan: null }, role: "operator" }, { org: { id: "org-read", name: "Read", slug: "read", plan: null }, role: "member" }]),
  serializeClientCapabilities: (role: string) => ({ "operations.mutate": role === "operator" }),
  resolveExistingMembership: vi.fn(async (_user: string, requested: string) => requested === "org-a"
    ? { org: { id: "org-a", name: "A", slug: "a", plan: null }, role: "operator" }
    : null),
}));

import { GET, POST } from "./session";
import { listUserMemberships } from "../../../server/tenant";
import { serializeClientCapabilities } from "../../../server/native-capabilities";

describe("native session projection", () => {
  it("resolves workspaces and capabilities on the server", async () => {
    const bearer = crypto.randomUUID();
    bearerTokenMock.mockReset();
    bearerTokenMock.mockReturnValue(bearer);
    const response = await GET({ request: new Request("https://example.test/api/native/session") } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      user: { id: "user-a", name: "A", email: "a@example.test" },
      workspaces: [{ org: { id: "org-a", name: "A", slug: "a", plan: null }, role: "operator", capabilities: { ...serializeClientCapabilities("operator"), "budgets.read": true, "royalties.read": true, "analytics.read": true, "resources.read": true, "radio.read": true, "publicPages.read": true, "publicPages.publish": false } }, { org: { id: "org-read", name: "Read", slug: "read", plan: null }, role: "member", capabilities: { ...serializeClientCapabilities("member"), "budgets.read": true, "royalties.read": true, "analytics.read": true, "resources.read": true, "radio.read": true, "publicPages.read": true, "publicPages.publish": false } }],
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(listUserMemberships).toHaveBeenCalledWith("user-a");
    expect(JSON.stringify(body)).not.toContain(bearer);
  });

  it("rejects missing and invalid bearer sessions with native 401", async () => {
    bearerTokenMock.mockReturnValueOnce(null).mockReturnValueOnce(crypto.randomUUID());
    nativeSessionMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    expect((await GET({ request: new Request("https://example.test") } as never)).status).toBe(401);
    expect((await GET({ request: new Request("https://example.test") } as never)).status).toBe(401);
  });

  it("rejects a selected workspace that the server no longer resolves for the user", async () => {
    const token = crypto.randomUUID();
    bearerTokenMock.mockReset(); bearerTokenMock.mockReturnValue(token);
    nativeSessionMock.mockReset(); nativeSessionMock.mockResolvedValue({ user: { id: "user-a", name: "A", email: "a@example.test" }, session: { id: crypto.randomUUID() } });
    const response = await POST({ request: new Request("https://example.test/api/native/session", {
      method: "POST", body: JSON.stringify({ workspaceId: "org-b" }), headers: { "Content-Type": "application/json" },
    }) } as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Workspace access was removed", code: "workspace_access_removed" });
  });
});
