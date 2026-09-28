import type { APIRoute } from "astro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "./errors";

const service = vi.hoisted(() => ({ getCampaignOsWorkspace: vi.fn(), finalizeCampaignReport: vi.fn() }));
vi.mock("../lib/db", () => ({ db: {} }));
vi.mock("./campaign-os", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }));

type Route = { GET: APIRoute; POST: APIRoute };
const loadRoute = () => import("../pages/api/campaigns/[id]/os") as Promise<Route>;
const locals = (overrides: Record<string, unknown> = {}) => ({ orgId: "org-1", membershipRole: "operator", user: { id: "actor-1" }, ...overrides });
const request = () => new Request("https://suite.test/api/campaigns/campaign-1/os", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finalize_report", input: { report: "Finished" } }) });

describe("Campaign report route boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.getCampaignOsWorkspace.mockResolvedValue({ report: null });
    service.finalizeCampaignReport.mockResolvedValue({ ok: true });
  });

  it("scopes reads to the active organisation and path campaign", async () => {
    const { GET } = await loadRoute();
    const denied = await GET({ locals: locals({ orgId: undefined }), params: { id: "campaign-1" } } as never);
    expect(denied.status).toBe(401);
    expect(service.getCampaignOsWorkspace).not.toHaveBeenCalled();
    const allowed = await GET({ locals: locals(), params: { id: "campaign-1" } } as never);
    expect(allowed.status).toBe(200);
    expect(service.getCampaignOsWorkspace).toHaveBeenCalledWith("org-1", "campaign-1");
  });

  it("requires mutation permission and an authenticated actor before finalisation", async () => {
    const { POST } = await loadRoute();
    const readOnly = await POST({ request: request(), locals: locals({ membershipRole: "member" }), params: { id: "campaign-1" } } as never);
    const missingActor = await POST({ request: request(), locals: locals({ user: undefined }), params: { id: "campaign-1" } } as never);
    expect(readOnly.status).toBe(403);
    expect(missingActor.status).toBe(401);
    expect(service.finalizeCampaignReport).not.toHaveBeenCalled();
    const allowed = await POST({ request: request(), locals: locals(), params: { id: "campaign-1" } } as never);
    expect(allowed.status).toBe(200);
    expect(service.finalizeCampaignReport).toHaveBeenCalledWith("org-1", "campaign-1", "Finished", "actor-1");
  });

  it("returns not found when the campaign belongs to another organisation", async () => {
    service.finalizeCampaignReport.mockRejectedValueOnce(new NotFoundError("Campaign not found"));
    const { POST } = await loadRoute();
    const response = await POST({ request: request(), locals: locals(), params: { id: "other-org-campaign" } } as never);
    expect(response.status).toBe(404);
    expect(service.finalizeCampaignReport).toHaveBeenCalledWith("org-1", "other-org-campaign", "Finished", "actor-1");
  });
});
