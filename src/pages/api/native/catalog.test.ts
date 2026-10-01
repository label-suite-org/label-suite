import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn(), getNativeSession: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const catalog = vi.hoisted(() => ({ listNativeCatalogEntries: vi.fn() }));

vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/native-session", () => ({ getNativeSession: native.getNativeSession }));
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/catalog", () => catalog);

import { GET as list } from "./catalog";

describe("native catalog route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.getNativeSession.mockResolvedValue(null);
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" } } });
    catalog.listNativeCatalogEntries.mockImplementation(async (_org, options) => ({ rows: [{ id: "catalog-a", catalog_number: "TN-001", entry_type: "release", title: "Catalog A", release_date: "2026-01-01", status: "published", notes: null, release_id: "release-a", release_title: "Release A", release_cover_art_url: "https://media.example.test/sleeve.jpg", release_count: 1 }], total: 1, has_more: false, next_cursor: null, query: options.query }));
  });

  it("reads only the actor workspace and returns a bounded canonical-release projection", async () => {
    const response = await list({ request: new Request("https://suite.test/api/native/catalog?workspaceId=other-org&query=beyond-100&cursor=100&limit=25") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, has_more: false, next_cursor: null, query: "beyond-100", items: [{ id: "catalog-a", catalog_number: "TN-001", release: { id: "release-a", cover_art_url: "https://media.example.test/sleeve.jpg" }, relationship_state: "linked" }] });
    expect(catalog.listNativeCatalogEntries).toHaveBeenCalledWith("org-a", { query: "beyond-100", cursor: "100", limit: "25" });
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
  });

  it("denies payee access without querying operator Catalog records", async () => {
    native.resolveNativeActor.mockResolvedValueOnce({ userId: "payee-a", workspace: { org: { id: "org-a" }, role: "payee" } });
    const response = await list({ request: new Request("https://suite.test/api/native/catalog") } as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "insufficient_permissions" });
    expect(catalog.listNativeCatalogEntries).not.toHaveBeenCalled();
  });

  it("recovers removed workspace access without expiring a valid session", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    native.getNativeSession.mockResolvedValueOnce({ user: { id: "user-a" } });
    const response = await list({ request: new Request("https://suite.test/api/native/catalog?workspaceId=removed", { headers: { authorization: "Bearer valid-session" } }) } as never);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "workspace_access_removed" });
    expect(catalog.listNativeCatalogEntries).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated access without attempting a catalog fallback", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    const response = await list({ request: new Request("https://suite.test/api/native/catalog") } as never);
    expect(response.status).toBe(401);
    expect(catalog.listNativeCatalogEntries).not.toHaveBeenCalled();
  });
});
