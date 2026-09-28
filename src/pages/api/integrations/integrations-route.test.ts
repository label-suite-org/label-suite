import { beforeEach, describe, expect, it, vi } from "vitest";

const integrations = vi.hoisted(() => ({
  listIntegrationProviders: vi.fn(),
  listIntegrationConnections: vi.fn(),
  listSyncJobs: vi.fn(),
  listIntegrationErrors: vi.fn(),
  createSyncJob: vi.fn(),
  updateIntegrationConnection: vi.fn(),
  recordAuditEvent: vi.fn(),
}));
const tenant = vi.hoisted(() => ({ requireCapability: vi.fn(() => "org-1") }));

vi.mock("../../../server/integrations", () => integrations);
vi.mock("../../../server/tenant", () => tenant);

import { GET } from "./index";
import { POST as POST_SYNC } from "./sync";
import { PATCH as PATCH_CONNECTION } from "./connections/[id]";

const locals = { membershipRole: "operator", orgId: "org-1", user: { id: "user-1" } } as never;

beforeEach(() => {
  vi.clearAllMocks();
  integrations.listIntegrationProviders.mockResolvedValue([{ id: "provider-1", key: "samply", name: "Samply" }]);
  integrations.listIntegrationConnections.mockResolvedValue([
    {
      id: "connection-1",
      provider_key: "samply",
      provider_name: "Samply",
      label: "Samply account",
      status: "connected",
      auth_ref: "secret-ref",
    },
  ]);
  integrations.listSyncJobs.mockResolvedValue([]);
  integrations.listIntegrationErrors.mockResolvedValue([]);
  integrations.createSyncJob.mockResolvedValue({ id: "job-1", status: "queued" });
  integrations.updateIntegrationConnection.mockResolvedValue({ id: "connection-1", status: "paused" });
  integrations.recordAuditEvent.mockResolvedValue({ id: "audit-1" });
});

describe("integration routes", () => {
  it("lists tenant-scoped console data without returning auth references", async () => {
    const response = await GET({ locals } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      providers: [{ id: "provider-1", key: "samply", name: "Samply" }],
      connections: [{
        id: "connection-1",
        provider_key: "samply",
        provider_name: "Samply",
        label: "Samply account",
        status: "connected",
      }],
      syncJobs: [],
      errors: [],
    });
    expect(tenant.requireCapability).toHaveBeenCalledWith(locals, "integrations.manage");
  });

  it("queues a sync only for a connection in the active workspace", async () => {
    const response = await POST_SYNC({
      locals,
      request: new Request("https://suite.test/api/integrations/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: "connection-1", idempotency_key: "manual-1" }),
      }),
    } as never);

    expect(response.status).toBe(202);
    expect(integrations.createSyncJob).toHaveBeenCalledWith("org-1", expect.objectContaining({
      connection_id: "connection-1",
      provider_key: "samply",
      job_type: "pull",
      triggered_by: "user-1",
      idempotency_key: "manual-1",
    }));
  });

  it("pauses a tenant-scoped connection and records the transition", async () => {
    const response = await PATCH_CONNECTION({
      locals,
      params: { id: "connection-1" },
      request: new Request("https://suite.test/api/integrations/connections/connection-1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(integrations.updateIntegrationConnection).toHaveBeenCalledWith("org-1", { id: "connection-1", status: "paused" });
    expect(integrations.recordAuditEvent).toHaveBeenCalledWith("org-1", expect.objectContaining({
      event_type: "integration.connection_paused",
      object_type: "integration_connection",
      object_id: "connection-1",
    }));
  });

  it.each(["paused", "revoked"])("does not queue sync for a %s connection", async (status) => {
    integrations.listIntegrationConnections.mockResolvedValue([{ id: "connection-1", status }]);
    const response = await POST_SYNC({
      locals,
      request: new Request("https://suite.test/api/integrations/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connection_id: "connection-1" }),
      }),
    } as never);
    expect(response.status).toBe(409);
    expect(integrations.createSyncJob).not.toHaveBeenCalled();
  });
});
