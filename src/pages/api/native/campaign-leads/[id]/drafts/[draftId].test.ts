import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const tenant = vi.hoisted(() => ({ hasCapability: vi.fn() }));
const service = vi.hoisted(() => ({ createManualDraftVersion: vi.fn() }));

vi.mock("../../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../../server/tenant", () => tenant);
vi.mock("../../../../../../server/campaign-communicator", () => service);

import { PATCH } from "./[draftId]";

describe("native plain draft mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "operator" }, userId: "user-a" });
    tenant.hasCapability.mockReturnValue(true);
    service.createManualDraftVersion.mockResolvedValue({ id: "draft-next", version: 2, body: "Updated" });
  });

  it("saves through the canonical service with lead and revision identity", async () => {
    const response = await PATCH({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a?workspaceId=org-a", {
        method: "PATCH",
        body: JSON.stringify({ subject: "Subject", body: "Updated", expected_updated_at: "2026-08-15T10:00:00.000Z" }),
        headers: { "content-type": "application/json" },
      }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(201);
    expect(service.createManualDraftVersion).toHaveBeenCalledWith(
      "org-a",
      "draft-a",
      { subject: "Subject", body: "Updated", expected_updated_at: "2026-08-15T10:00:00.000Z" },
      "user-a",
      undefined,
      { expectedUpdatedAt: "2026-08-15T10:00:00.000Z", expectedLeadId: "lead-a", plainOnly: true },
    );
  });

  it("denies members before calling the service", async () => {
    tenant.hasCapability.mockReturnValue(false);
    const response = await PATCH({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a?workspaceId=org-a", { method: "PATCH", body: "{}" }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(403);
    expect(service.createManualDraftVersion).not.toHaveBeenCalled();
  });

  it("requires the loaded draft revision", async () => {
    const response = await PATCH({
      request: new Request("https://suite.test/api/native/campaign-leads/lead-a/drafts/draft-a?workspaceId=org-a", {
        method: "PATCH",
        body: JSON.stringify({ subject: "Subject", body: "Updated" }),
        headers: { "content-type": "application/json" },
      }),
      params: { id: "lead-a", draftId: "draft-a" },
    } as never);

    expect(response.status).toBe(400);
    expect(service.createManualDraftVersion).not.toHaveBeenCalled();
  });
});
