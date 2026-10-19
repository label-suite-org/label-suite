import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), getNativeSession: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeToday: vi.fn() }));
const database = vi.hoisted(() => ({
  context: null as { userId: string; orgId: string } | null,
  runWithDatabaseContext: vi.fn(async (context: { userId: string; orgId: string }, operation: () => Promise<unknown>) => {
    database.context = context;
    try { return await operation(); } finally { database.context = null; }
  }),
}));

vi.mock("../../../lib/native-workspace", () => ({ resolveNativeActor: native.resolveNativeActor }));
vi.mock("../../../lib/native-session", () => ({ getNativeSession: native.getNativeSession }));
vi.mock("../../../server/native-today", () => ({ listNativeToday: service.listNativeToday }));
vi.mock("../../../lib/db", () => database);

import { GET } from "./today";

describe("native Today", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    native.getNativeSession.mockResolvedValue({ user: { id: "user-a", name: "A", email: "a@example.test" } });
    service.listNativeToday.mockImplementation(async () => {
      expect(database.context).toEqual({ userId: "user-a", orgId: "org-a" });
      return { items: [{ id: "task-a", kind: "task" }], scope: "assigned", refreshed_at: "2026-08-16T10:00:00.000Z" };
    });
  });

  it("loads Today in the explicitly selected workspace and actor scope", async () => {
    const response = await GET({ request: new Request("https://suite.test/api/native/today?workspaceId=org-a", { headers: { Authorization: "Bearer token" } }) } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ items: [{ id: "task-a" }] });
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
    expect(service.listNativeToday).toHaveBeenCalledWith("org-a", { userId: "user-a", userName: "A", userEmail: "a@example.test", role: "member" });
  });

  it("reports removed workspace access without expiring a valid session", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    const response = await GET({ request: new Request("https://suite.test/api/native/today?workspaceId=removed", { headers: { Authorization: "Bearer token" } }) } as never);
    expect(response.status).toBe(403);
    expect(service.listNativeToday).not.toHaveBeenCalled();
    expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  });

  it("does not expose data without workspace or session access", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    expect((await GET({ request: new Request("https://suite.test/api/native/today") } as never)).status).toBe(401);
    native.resolveNativeActor.mockResolvedValueOnce({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    native.getNativeSession.mockResolvedValueOnce(null);
    expect((await GET({ request: new Request("https://suite.test/api/native/today", { headers: { Authorization: "Bearer token" } }) } as never)).status).toBe(401);
  });
});
