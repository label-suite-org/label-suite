import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: unknown, operation: () => Promise<unknown>) => operation()) }));
const records = vi.hoisted(() => ({ searchRecords: vi.fn() }));
vi.mock("../../../lib/native-workspace", () => native);
vi.mock("../../../lib/db", () => database);
vi.mock("../../../server/record-search", () => records);

import { GET } from "./search";

describe("native search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    records.searchRecords.mockResolvedValue([{ id: "artist-a", kind: "artist", title: "Same Name", href: "/artists/artist-a" }]);
  });

  it("queries only the resolved bearer workspace and returns a grouped native projection", async () => {
    const response = await GET({ request: new Request("https://suite.test/api/native/search?workspaceId=org-a&q=Same"), url: new URL("https://suite.test/api/native/search?workspaceId=org-a&q=Same") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 1, groups: [{ kind: "artist", items: [{ id: "artist-a", destination: "native", native_route: "/artists/artist-a" }] }] });
    expect(records.searchRecords).toHaveBeenCalledWith("org-a", "Same");
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
  });

  it("never substitutes a caller-supplied tenant for the resolved membership", async () => {
    const url = new URL("https://suite.test/api/native/search?workspaceId=forged&q=Same");
    await GET({ request: new Request(url), url } as never);
    expect(records.searchRecords).toHaveBeenCalledWith("org-a", "Same");
  });

  it("returns a safe failure when search is unavailable", async () => {
    records.searchRecords.mockRejectedValueOnce(new Error("private database details"));
    const url = new URL("https://suite.test/api/native/search?workspaceId=org-a&q=Same");
    const response = await GET({ request: new Request(url), url } as never);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private database details");
  });

  it("does not query records after workspace access is lost", async () => {
    native.resolveNativeActor.mockResolvedValueOnce(null);
    const response = await GET({ request: new Request("https://suite.test/api/native/search?workspaceId=other&q=Same"), url: new URL("https://suite.test/api/native/search?workspaceId=other&q=Same") } as never);
    expect(response.status).toBe(401);
    expect(records.searchRecords).not.toHaveBeenCalled();
  });
});
