import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_TOOL_SCOPES } from "../lib/campaign-enrichment-local-tool-contract";
import { HttpError } from "./errors";

const service = vi.hoisted(() => ({
  createLocalToolToken: vi.fn(),
  listLocalToolTokens: vi.fn(),
  revokeLocalToolToken: vi.fn(),
}));
const audit = vi.hoisted(() => ({ recordLocalToolOperation: vi.fn().mockResolvedValue(undefined) }));

vi.mock("./local-tool-audit", async () => ({
  ...await vi.importActual<typeof import("./local-tool-audit")>("./local-tool-audit"),
  ...audit,
}));

vi.mock("./tenant", () => ({
  requireCapability(locals: Record<string, unknown>, capability: string) {
    if (capability !== "operations.mutate") throw new Error(`Unexpected capability: ${capability}`);
    if (locals.membershipRole !== "owner" && locals.membershipRole !== "operator") {
      throw new HttpError("Insufficient permissions", 403);
    }
    if (typeof locals.orgId !== "string" || !locals.orgId) {
      throw new HttpError("Active workspace is required", 401);
    }
    return locals.orgId;
  },
}));

vi.mock("./local-tool-tokens", async () => {
  const actual = await vi.importActual<typeof import("./local-tool-tokens")>("./local-tool-tokens");
  return { ...actual, ...service };
});

const safeRecord = {
  id: "token-1",
  org_id: "org-1",
  user_id: "user-1",
  name: "Malthe MacBook",
  token_prefix: "lsmcp_token-1",
  scopes: [...LOCAL_TOOL_SCOPES],
  expires_at: new Date("2026-09-09T12:00:00.000Z"),
  revoked_at: null,
  last_used_at: null,
  created_at: new Date("2026-08-10T12:00:00.000Z"),
  updated_at: new Date("2026-08-10T12:00:00.000Z"),
};

const createBody = {
  name: "Malthe MacBook",
  scopes: [...LOCAL_TOOL_SCOPES],
  expires_in_days: 30,
};

function locals(role = "operator", userId: string | null = "user-1") {
  return {
    orgId: "org-1",
    membershipRole: role,
    user: userId ? { id: userId } : undefined,
  };
}

function postRequest(body: unknown, authorization?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  return new Request("https://labels.example/api/settings/local-tool-tokens", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("local tool token settings routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    service.createLocalToolToken.mockResolvedValue({ token: "lsmcp_token-1_plaintext", record: safeRecord });
    service.listLocalToolTokens.mockResolvedValue([safeRecord]);
    service.revokeLocalToolToken.mockResolvedValue({
      ...safeRecord,
      revoked_at: new Date("2026-08-10T12:30:00.000Z"),
      updated_at: new Date("2026-08-10T12:30:00.000Z"),
    });
  });

  it("requires signed-in operations.mutate authority for list, create, and revoke", async () => {
    const { GET, POST } = await import("../pages/api/settings/local-tool-tokens");
    const { DELETE } = await import("../pages/api/settings/local-tool-tokens/[id]");
    const memberLocals = locals("member");
    const bearer = "Bearer lsmcp_token-1_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";

    const listed = await GET!({ locals: memberLocals } as never);
    const created = await POST!({ request: postRequest(createBody, bearer), locals: memberLocals } as never);
    const revoked = await DELETE!({ params: { id: "token-1" }, locals: memberLocals } as never);

    expect([listed.status, created.status, revoked.status]).toEqual([403, 403, 403]);
    expect(service.listLocalToolTokens).not.toHaveBeenCalled();
    expect(service.createLocalToolToken).not.toHaveBeenCalled();
    expect(service.revokeLocalToolToken).not.toHaveBeenCalled();
  });

  it("lists only safe records and never returns plaintext or secret hashes", async () => {
    const { GET } = await import("../pages/api/settings/local-tool-tokens");

    const response = await GET!({ locals: locals() } as never);
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(service.listLocalToolTokens).toHaveBeenCalledWith("org-1");
    expect(serialized).not.toContain("secret_hash");
    expect(serialized).not.toContain("plaintext");
  });

  it("creates with the exact proposal-only scope set and returns plaintext once", async () => {
    const { POST } = await import("../pages/api/settings/local-tool-tokens");

    const response = await POST!({ request: postRequest(createBody), locals: locals() } as never);

    expect(response.status).toBe(201);
    expect(service.createLocalToolToken).toHaveBeenCalledWith("org-1", "user-1", createBody);
    await expect(response.json()).resolves.toEqual({
      token: "lsmcp_token-1_plaintext",
      record: {
        ...safeRecord,
        expires_at: "2026-09-09T12:00:00.000Z",
        created_at: "2026-08-10T12:00:00.000Z",
        updated_at: "2026-08-10T12:00:00.000Z",
      },
    });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: "token-1",
      orgId: "org-1",
      userId: "user-1",
      tool: "create_local_tool_token",
      operation: "token_create",
      resultCategory: "created",
      proposalCount: 0,
    }));
    expect(JSON.stringify(audit.recordLocalToolOperation.mock.calls)).not.toContain("lsmcp_token-1_plaintext");
  });

  it("creates with a 30-day expiry when the request omits expiry", async () => {
    const { POST } = await import("../pages/api/settings/local-tool-tokens");
    const body = { name: createBody.name, scopes: createBody.scopes };

    const response = await POST!({ request: postRequest(body), locals: locals() } as never);

    expect(response.status).toBe(201);
    expect(service.createLocalToolToken).toHaveBeenCalledWith("org-1", "user-1", {
      ...body,
      expires_in_days: 30,
    });
    await expect(response.json()).resolves.toMatchObject({ token: "lsmcp_token-1_plaintext" });
  });

  it.each([
    ["unknown scope", { ...createBody, scopes: [...LOCAL_TOOL_SCOPES, "campaign.outreach.send"] }],
    ["zero-day expiry", { ...createBody, expires_in_days: 0 }],
    ["31-day expiry", { ...createBody, expires_in_days: 31 }],
    ["fractional expiry", { ...createBody, expires_in_days: 1.5 }],
    ["duplicate scope", { ...createBody, scopes: [LOCAL_TOOL_SCOPES[0], LOCAL_TOOL_SCOPES[0]] }],
    ["extra input", { ...createBody, provider: "remote" }],
  ])("rejects %s before token creation", async (_label, body) => {
    const { POST } = await import("../pages/api/settings/local-tool-tokens");

    const response = await POST!({ request: postRequest(body), locals: locals() } as never);

    expect(response.status).toBe(400);
    expect(service.createLocalToolToken).not.toHaveBeenCalled();
  });

  it("requires the authenticated session user when creating", async () => {
    const { POST } = await import("../pages/api/settings/local-tool-tokens");

    const response = await POST!({ request: postRequest(createBody), locals: locals("operator", null) } as never);

    expect(response.status).toBe(401);
    expect(service.createLocalToolToken).not.toHaveBeenCalled();
  });

  it("revokes by tenant and path ID and remains idempotent through the service", async () => {
    const { DELETE } = await import("../pages/api/settings/local-tool-tokens/[id]");

    const first = await DELETE!({ params: { id: "token-1" }, locals: locals() } as never);
    const second = await DELETE!({ params: { id: "token-1" }, locals: locals() } as never);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(service.revokeLocalToolToken).toHaveBeenNthCalledWith(1, "org-1", "token-1");
    expect(service.revokeLocalToolToken).toHaveBeenNthCalledWith(2, "org-1", "token-1");
    expect(await second.json()).toMatchObject({ id: "token-1", org_id: "org-1", revoked_at: "2026-08-10T12:30:00.000Z" });
    expect(audit.recordLocalToolOperation).toHaveBeenCalledWith(expect.objectContaining({
      tokenId: "token-1",
      orgId: "org-1",
      userId: "user-1",
      tool: "revoke_local_tool_token",
      operation: "token_revoke",
      resultCategory: "revoked",
      proposalCount: 0,
    }));
  });
});
