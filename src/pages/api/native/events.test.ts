import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const sessions = vi.hoisted(() => ({ bearerToken: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_: unknown, op: () => Promise<unknown>) => op()) }));
const service = vi.hoisted(() => ({ listNativeEvents: vi.fn(), createNativeEvent: vi.fn(), nativeCreateEventSchema: { safeParse: vi.fn((value: unknown) => ({ success: true, data: value })) } }));
vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/native-session", () => sessions);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/native-events-projects", () => service);

import { GET, POST } from "./events";

describe("native Event root", () => {
  beforeEach(() => {
    vi.clearAllMocks(); sessions.bearerToken.mockReturnValue(null); sessions.getNativeSession.mockResolvedValue(null);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "operator" } });
    service.listNativeEvents.mockResolvedValue({ items: [{ record_type: "event", id: "same-id", title: "Event", status: "planned", next_action: null }], next_cursor: null });
    service.createNativeEvent.mockResolvedValue({ id: "event-new" });
  });

  it("uses the bearer-selected workspace, preserves Event identity, and exposes no project records", async () => {
    const response = await GET({ request: new Request("https://suite.test/api/native/events?workspaceId=ignored&limit=3") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ record_type: "event", id: "same-id", title: "Event", status: "planned", next_action: null }], next_cursor: null });
    expect(service.listNativeEvents).toHaveBeenCalledWith("org-a", expect.objectContaining({ limit: "3" }));
  });

  it("denies unauthenticated and read-only create without invoking a writer", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    expect((await POST({ request: new Request("https://suite.test/api/native/events", { method: "POST" }) } as never)).status).toBe(401);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    expect((await POST({ request: new Request("https://suite.test/api/native/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Denied" }) }) } as never)).status).toBe(403);
    expect(service.createNativeEvent).not.toHaveBeenCalled();
  });

  it("allows fundraiser create through the canonical projects capability", async () => {
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "fundraiser" } });
    const response = await POST({ request: new Request("https://suite.test/api/native/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Fundraiser event", event_type: "release_party", start_date: "2026-10-01" }) }) } as never);
    expect(response.status).toBe(201);
    expect(service.createNativeEvent).toHaveBeenCalledWith("org-a", expect.objectContaining({ title: "Fundraiser event" }), "user-a");
  });
  it("distinguishes revoked workspace access from an expired session before reading or writing", async () => {
    native.resolveNativeActor.mockResolvedValue(null);
    sessions.bearerToken.mockReturnValue("fixture-token");
    sessions.getNativeSession.mockResolvedValue({ userId: "user-a" });
    for (const [method, handler] of [["GET", GET], ["POST", POST]] as const) {
      const response = await handler({ params: { id: "record" }, request: new Request("https://suite.test/api/native/events", { method }) } as never);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    }
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
    sessions.getNativeSession.mockResolvedValue(null);
    expect((await GET({ params: { id: "record" }, request: new Request("https://suite.test/api/native/events") } as never)).status).toBe(401);
  });

});
