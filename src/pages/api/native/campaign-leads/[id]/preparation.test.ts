import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ resolveNativeActor: vi.fn() }));
const service = vi.hoisted(() => ({ updateLeadPreparation: vi.fn() }));

vi.mock("../../../../../lib/native-workspace", () => native);
vi.mock("../../../../../server/campaign-communicator", async () => {
  const { z } = await import("zod");
  return {
    updateLeadPreparation: service.updateLeadPreparation,
    updateLeadPreparationSchema: z.object({ campaign_id: z.string(), expected_updated_at: z.string().datetime(), contact_route: z.string().nullable().optional() }).strict(),
  };
});
vi.mock("../../../../../server/tenant", () => ({ hasCapability: vi.fn((role: string) => role === "operator") }));

import { PATCH } from "./preparation";

describe("native lead preparation mutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "operator" }, userId: "user-a" });
    service.updateLeadPreparation.mockResolvedValue({ id: "lead-a", ready_blockers: [] });
  });

  const body = { campaign_id: "campaign-a", expected_updated_at: "2026-08-15T10:00:00.000Z", contact_route: "editor@example.test" };

  it("passes the explicit revision and actor through for an operator", async () => {
    const response = await PATCH({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/preparation?workspaceId=org-a", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), params: { id: "lead-a" } } as never);
    expect(response.status).toBe(200);
    expect(service.updateLeadPreparation).toHaveBeenCalledWith("org-a", "lead-a", body, "user-a");
  });

  it("rejects read-only members before invoking the mutation service", async () => {
    native.resolveNativeActor.mockResolvedValue({ workspace: { org: { id: "org-a" }, role: "member" }, userId: "user-a" });
    const response = await PATCH({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/preparation?workspaceId=org-a", { method: "PATCH", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), params: { id: "lead-a" } } as never);
    expect(response.status).toBe(403);
    expect(service.updateLeadPreparation).not.toHaveBeenCalled();
  });

  it("requires a loaded revision instead of accepting an unguarded save", async () => {
    const response = await PATCH({ request: new Request("https://suite.test/api/native/campaign-leads/lead-a/preparation?workspaceId=org-a", { method: "PATCH", body: JSON.stringify({ campaign_id: "campaign-a", contact_route: "editor@example.test" }), headers: { "content-type": "application/json" } }), params: { id: "lead-a" } } as never);
    expect(response.status).toBe(400);
    expect(service.updateLeadPreparation).not.toHaveBeenCalled();
  });
});
