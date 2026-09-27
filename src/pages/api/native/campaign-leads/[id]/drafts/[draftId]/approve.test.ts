import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const tenant = vi.hoisted(() => ({ hasCapability: vi.fn() }));
const service = vi.hoisted(() => ({ approveDraft: vi.fn() }));

vi.mock("../../../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../../../server/tenant", () => tenant);
vi.mock("../../../../../../../server/campaign-communicator", () => service);

import { POST } from "./approve";

describe("native draft approval mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "operator" }, userId: "user-a" });
    tenant.hasCapability.mockReturnValue(true);
    service.approveDraft.mockResolvedValue({ id: "draft-a", pipeline_stage: "ready" });
  });

  it("passes the path lead and both loaded revisions through", async () => {
    const body = {
      expected_draft_updated_at: "2026-08-16T10:00:00.000Z",
      expected_lead_updated_at: "2026-08-16T09:00:00.000Z",
    };
    const response = await POST({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a/approve?workspaceId=org-a", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(200);
    expect(service.approveDraft).toHaveBeenCalledWith("org-a", "draft-a", "user-a", undefined, {
      expectedDraftUpdatedAt: body.expected_draft_updated_at,
      expectedLeadUpdatedAt: body.expected_lead_updated_at,
      expectedLeadId: "lead-a",
    });
  });

  it("denies read-only members before invoking approval", async () => {
    tenant.hasCapability.mockReturnValue(false);
    const response = await POST({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a/approve?workspaceId=org-a", { method: "POST", body: "{}" }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(403);
    expect(service.approveDraft).not.toHaveBeenCalled();
  });

  it("requires both loaded revisions", async () => {
    const response = await POST({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a/approve?workspaceId=org-a", { method: "POST", body: JSON.stringify({}) }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(400);
    expect(service.approveDraft).not.toHaveBeenCalled();
  });
});
