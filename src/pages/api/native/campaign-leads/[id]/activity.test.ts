import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({ runWithDatabaseContext: vi.fn(async (_context: { userId: string; orgId: string }, operation: () => Promise<unknown>) => operation()) }));
vi.mock("../../../../../lib/db", () => database);

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeLeadActivity: vi.fn() }));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../server/native-lead-workbench", () => service);

import { GET } from "./activity";

describe("native lead activity paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "member" } });
    service.listNativeLeadActivity.mockResolvedValue({ items: [], partial: true, next_cursor: "next" });
  });

  it("loads activity incrementally with explicit tenant and lead identity", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/activity?workspaceId=org-a&campaignId=campaign-a&cursor=next&limit=3"),
      params: { id: "lead-a" },
    } as never);
    expect(response.status).toBe(200);
    expect(database.runWithDatabaseContext).toHaveBeenCalledWith({ userId: "user-a", orgId: "org-a" }, expect.any(Function));
    expect(service.listNativeLeadActivity).toHaveBeenCalledWith("org-a", "campaign-a", "lead-a", { cursor: "next", limit: "3" });
  });
});


it("keeps payees outside the campaign activity operations boundary", async () => {
  vi.clearAllMocks();
  native.resolveNativeActor.mockResolvedValue({ userId: "user-a", workspace: { org: { id: "org-a" }, role: "payee" } });
  const response = await GET({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/activity?workspaceId=org-a&campaignId=campaign-a"), params: { id: "lead-a" } } as never);
  expect(response.status).toBe(403);
  expect(service.listNativeLeadActivity).not.toHaveBeenCalled();
  expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
});
