import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeWorkspace: vi.fn() }));
const service = vi.hoisted(() => ({ listNativeLeadActivity: vi.fn() }));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../server/native-lead-workbench", () => service);

import { GET } from "./activity";

describe("native lead activity paging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeWorkspace.mockResolvedValue({ org: { id: "org-a" }, role: "member" });
    service.listNativeLeadActivity.mockResolvedValue({ items: [], partial: true, next_cursor: "next" });
  });

  it("loads activity incrementally with explicit tenant and lead identity", async () => {
    const response = await GET({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/activity?workspaceId=org-a&campaignId=campaign-a&cursor=next&limit=3"),
      params: { id: "lead-a" },
    } as never);
    expect(response.status).toBe(200);
    expect(service.listNativeLeadActivity).toHaveBeenCalledWith("org-a", "campaign-a", "lead-a", { cursor: "next", limit: "3" });
  });
});
