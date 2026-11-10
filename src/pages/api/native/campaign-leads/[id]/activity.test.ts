import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const database = vi.hoisted(() => ({ active: null as unknown, runWithDatabaseContext: vi.fn(async (context: unknown, callback: () => unknown) => {
  database.active = context;
  try { return await callback(); } finally { database.active = null; }
}) }));
vi.mock("../../../../../lib/db", () => database);
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
    expect(service.listNativeLeadActivity).toHaveBeenCalledWith("org-a", "campaign-a", "lead-a", { cursor: "next", limit: "3" });
  });
});

it("executes the read inside the authenticated actor database context", async () => {
  native.resolveNativeActor.mockResolvedValue({ userId: "user-context", workspace: { org: { id: "org-context" }, role: "member" } });
  service.listNativeLeadActivity.mockImplementationOnce(async () => {
    expect(database.active).toEqual({ userId: "user-context", orgId: "org-context" });
    return {};
  });
  const response = await GET({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/activity?workspaceId=org-a&campaignId=campaign-a"), params: { id: "record-a" } } as never);
  expect(response.status).toBe(200);
  expect(database.active).toBeNull();
});

it("denies payee activity reads before entering database context", async () => {
  vi.clearAllMocks();
  native.resolveNativeActor.mockResolvedValue({ userId: "payee-a", workspace: { org: { id: "org-a" }, role: "payee" } });
  const response = await GET({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/activity?workspaceId=org-a&campaignId=campaign-a"), params: { id: "lead-a" } } as never);
  expect(response.status).toBe(403);
  expect(database.runWithDatabaseContext).not.toHaveBeenCalled();
  expect(service.listNativeLeadActivity).not.toHaveBeenCalled();
});
