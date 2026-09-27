import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {}, pool: {} }));

const workspace = vi.hoisted(() => ({
  listProjectFundingProfiles: vi.fn(), createProjectFundingProfile: vi.fn(),
  listGrantDeadlines: vi.fn(), createGrantDeadline: vi.fn(),
  replaceApplicationFundingNeeds: vi.fn(), replaceGrantApplicationRequirements: vi.fn(),
  createProjectFundingProfileSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  createGrantDeadlineSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  replaceApplicationFundingNeedsSchema: { omit: () => ({ safeParse: (data: unknown) => ({ success: true, data }) }) },
  replaceGrantApplicationRequirementsSchema: { omit: () => ({ safeParse: (data: unknown) => ({ success: true, data }) }) },
}));
const supporting = vi.hoisted(() => ({
  listGrantSupportingDocuments: vi.fn(), linkGrantSupportingDocument: vi.fn(),
  listGrantDocumentLibrary: vi.fn(), replaceGrantSupportingDocuments: vi.fn(), unlinkGrantSupportingDocument: vi.fn(),
  linkGrantSupportingDocumentSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  replaceGrantSupportingDocumentsSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
  unlinkGrantSupportingDocumentSchema: { safeParse: (data: unknown) => ({ success: true, data }) },
}));
vi.mock("./grants-workspace", () => workspace);
vi.mock("./grant-supporting-documents", () => supporting);

function request(path: string, method: string, body?: unknown) {
  return new Request(`https://labels.example${path}`, {
    method, headers: { origin: "https://labels.example", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("fundraiser workflow routes", () => {
  beforeEach(() => { process.env.PUBLIC_SITE_URL = "https://labels.example"; vi.clearAllMocks(); workspace.listProjectFundingProfiles.mockResolvedValue([]); workspace.listGrantDeadlines.mockResolvedValue([]); });

  it.each([
    ["../pages/api/funding-profiles", "POST", { project_id: "project-1" }, "createProjectFundingProfile"],
    ["../pages/api/grant-deadlines", "POST", { grant_id: "grant-1", deadline_date: "2026-10-01" }, "createGrantDeadline"],
  ])("protects %s with fundraising capability", { timeout: 15_000 }, async (modulePath, method, body, serviceName) => {
    const route = await import(modulePath);
    const denied = await route[method]({ request: request("/api/test", method, body), locals: { orgId: "org-1", membershipRole: "member" } } as never);
    expect(denied.status).toBe(403);
    const allowed = await route[method]({ request: request("/api/test", method, body), locals: { orgId: "org-1", membershipRole: "fundraiser" } } as never);
    expect(allowed.status).toBe(method === "POST" ? 201 : 200);
    expect(workspace[serviceName as keyof typeof workspace]).toHaveBeenCalledWith("org-1", expect.objectContaining(body));
  });

  it("supports list, upload-link, replace, and unlink for grant application documents", async () => {
    supporting.listGrantSupportingDocuments.mockResolvedValue([]);
    supporting.linkGrantSupportingDocument.mockResolvedValue({ id: "link-1", documentId: "doc-1" });
    supporting.replaceGrantSupportingDocuments.mockResolvedValue({ ok: true, count: 1 });
    supporting.unlinkGrantSupportingDocument.mockResolvedValue({ ok: true });
    const route = await import("../pages/api/grant-applications/[id]/documents");
    const locals = { orgId: "org-1", membershipRole: "fundraiser" };

    expect((await route.GET({ params: { id: "app-1" }, locals } as never)).status).toBe(200);
    const upload = { storage_key: "org-1/grant-applications/app-1/attachments/file.pdf", name: "Budget", asset_role: "other" };
    expect((await route.POST({ params: { id: "app-1" }, locals, request: request("/api/docs", "POST", upload) } as never)).status).toBe(201);
    expect(supporting.linkGrantSupportingDocument).toHaveBeenCalledWith("org-1", "app-1", upload);
    expect((await route.PUT({ params: { id: "app-1" }, locals, request: request("/api/docs", "PUT", { documents: [{ document_id: "doc-1" }] }) } as never)).status).toBe(200);
    expect((await route.DELETE({ params: { id: "app-1" }, locals, request: request("/api/docs", "DELETE", { link_id: "link-1" }) } as never)).status).toBe(200);
  });

  it("allows members to read supporting documents without mutation capability", async () => {
    const route = await import("../pages/api/grant-applications/[id]/documents");
    const response = await route.GET({ params: { id: "app-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);
    expect(response.status).toBe(200);
    expect(supporting.listGrantSupportingDocuments).toHaveBeenCalledWith("org-1", "app-1");
  });

  it.each([
    ["../pages/api/funding-profiles", "GET"],
    ["../pages/api/grant-deadlines", "GET"],
    ["../pages/api/grant-applications/[id]/documents", "GET"],
  ])("allows member read access through %s", async (modulePath, method) => {
    const route = await import(modulePath);
    const response = await route[method]({ params: { id: "app-1" }, locals: { orgId: "org-1", membershipRole: "member" } } as never);
    expect(response.status).toBe(200);
  });

  it.each([
    ["../pages/api/funding-profiles", "POST", { project_id: "project-1" }],
    ["../pages/api/grant-deadlines", "POST", { grant_id: "grant-1", deadline_date: "2026-10-01" }],
    ["../pages/api/grant-applications", "POST", { grant_id: "grant-1", title: "Nordic Grant" }],
    ["../pages/api/grant-applications", "PUT", { id: "application-1", title: "Nordic Grant" }],
    ["../pages/api/grant-applications", "DELETE", { id: "application-1" }],
    ["../pages/api/grant-applications/[id]/funding-needs", "PUT", { funding_needs: [] }],
    ["../pages/api/grant-applications/[id]/requirements", "PUT", { requirements: [] }],
    ["../pages/api/grant-applications/[id]/documents", "DELETE", { link_id: "link-1" }],
  ])("rejects cross-origin unsafe %s", async (modulePath, method, body) => {
    const route = await import(modulePath);
    const req = request("/api/test", method, body);
    req.headers.set("origin", "https://attacker.example");
    const response = await route[method]({ params: { id: "app-1" }, request: req, locals: { orgId: "org-1", membershipRole: "owner" } } as never);
    expect(response.status).toBe(403);
  });

  it("accepts only context-generated storage keys for the active application and organization", async () => {
    const { validateGrantSupportingStorageKey } = await import("./grant-supporting-storage");
    expect(validateGrantSupportingStorageKey("org-1", "app-1", "org-1/grant-applications/app-1/attachments/file.pdf"))
      .toBe("org-1/grant-applications/app-1/attachments/file.pdf");
    expect(() => validateGrantSupportingStorageKey("org-1", "app-1", "org-2/grant-applications/app-1/attachments/file.pdf"))
      .toThrow("Storage key does not match this grant application");
    expect(() => validateGrantSupportingStorageKey("org-1", "app-1", "org-1/grant-applications/app-2/attachments/file.pdf"))
      .toThrow("Storage key does not match this grant application");
  });
});
