import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const service = vi.hoisted(() => ({
  listNativeContacts: vi.fn(),
  getNativeContactDetail: vi.fn(),
  createNativeContact: vi.fn(),
  updateNativeContact: vi.fn(),
  decideNativeContactProposal: vi.fn(),
}));
const nativeSession = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
vi.mock("../lib/native-session", () => nativeSession);
const actor = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));

vi.mock("../lib/native-workspace", () => actor);
vi.mock("../lib/db", () => ({ runWithDatabaseContext: (_ctx: unknown, fn: () => unknown) => fn() }));
vi.mock("./native-contacts", () => ({
  ...service,
  parseNativeContactList: (input: unknown) => input,
  nativeContactCreateSchema: z.object({ kind: z.enum(["person", "organization"]), name: z.string().optional() }).passthrough(),
  nativeContactUpdateSchema: z.object({ kind: z.enum(["person", "organization"]), expected_updated_at: z.string(), proposal: z.object({ id: z.string(), action: z.enum(["accept", "ignore"]) }).optional() }).passthrough(),
}));

const request = (url: string, method = "GET", body?: unknown) => new Request(url, {
  method,
  headers: body ? { "content-type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

describe("native contact route authority", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeSession.bearerToken.mockReturnValue("test-token");
    nativeSession.getNativeSession.mockResolvedValue(null);
    actor.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "member" }, userId: "user-a" });
    service.listNativeContacts.mockResolvedValue({ items: [], next_cursor: null });
    service.getNativeContactDetail.mockResolvedValue({ identity: { kind: "person", id: "person-a" } });
    service.createNativeContact.mockResolvedValue({ id: "person-a" });
    service.updateNativeContact.mockResolvedValue({ id: "person-a" });
    service.decideNativeContactProposal.mockResolvedValue({ status: "applied" });
  });

  it("distinguishes lost workspace access from expired authentication for reads and writes", async () => {
    const list = await import("../pages/api/native/contacts");
    const detail = await import("../pages/api/native/contacts/[id]");
    actor.resolveNativeActor.mockResolvedValue(null);
    for (const route of [list.GET, list.POST, detail.GET, detail.PUT]) {
      const context = { request: request("https://suite.test/api/native/contacts/person-a?workspaceId=org-a"), params: { id: "person-a" } } as never;
      nativeSession.getNativeSession.mockResolvedValue({ user: { id: "user-a" } });
      const denied = await route(context);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({ code: "workspace_access_removed" });
      nativeSession.getNativeSession.mockResolvedValue(null);
      expect((await route(context)).status).toBe(401);
    }
    expect(service.getNativeContactDetail).not.toHaveBeenCalled();
    expect(service.updateNativeContact).not.toHaveBeenCalled();
  });

  it("allows members to read only their selected workspace", async () => {
    const { GET } = await import("../pages/api/native/contacts");
    const response = await GET({ request: request("https://suite.test/api/native/contacts?workspaceId=org-a&limit=9") } as never);
    expect(response.status).toBe(200);
    expect(service.listNativeContacts).toHaveBeenCalledWith("org-a", expect.objectContaining({ limit: "9" }));
  });

  it("denies payees from the contact directory and members from mutations", async () => {
    const { GET, POST } = await import("../pages/api/native/contacts");
    actor.resolveNativeActor.mockResolvedValueOnce({ workspace: { org: { id: "org-a" }, role: "payee" }, userId: "payee-a" });
    expect((await GET({ request: request("https://suite.test/api/native/contacts?workspaceId=org-a") } as never)).status).toBe(403);
    expect((await POST({ request: request("https://suite.test/api/native/contacts?workspaceId=org-a", "POST", { kind: "person", name: "New" }) } as never)).status).toBe(403);
  });

  it("requires an operator mutation capability and forwards explicit revision decisions", async () => {
    const { PUT } = await import("../pages/api/native/contacts/[id]");
    actor.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "operator" }, userId: "operator-a" });
    const response = await PUT({
      request: request("https://suite.test/api/native/contacts/person-a?workspaceId=org-a", "PUT", {
        kind: "person", expected_updated_at: "2026-09-17T10:00:00.000Z", proposal: { id: "proposal-a", action: "accept" },
      }),
      params: { id: "person-a" },
    } as never);
    expect(response.status).toBe(200);
    expect(service.updateNativeContact).toHaveBeenCalledWith("org-a", "person-a", expect.objectContaining({ proposal: { id: "proposal-a", action: "accept" } }), "operator-a");
  });

  it("requires a typed identity for detail reads", async () => {
    const { GET } = await import("../pages/api/native/contacts/[id]");
    const response = await GET({ request: request("https://suite.test/api/native/contacts/same-id?workspaceId=org-a&kind=organization"), params: { id: "same-id" } } as never);
    expect(response.status).toBe(200);
    expect(service.getNativeContactDetail).toHaveBeenCalledWith("org-a", "same-id", "organization");
    const missingKind = await GET({ request: request("https://suite.test/api/native/contacts/same-id?workspaceId=org-a"), params: { id: "same-id" } } as never);
    expect(missingKind.status).toBe(400);
  });
});
