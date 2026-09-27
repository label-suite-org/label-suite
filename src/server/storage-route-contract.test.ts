import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  assertAttachmentStorageKey: vi.fn((_: string, __: unknown, key: string) => key),
  assertStorageObjectIsNew: vi.fn().mockResolvedValue(undefined),
  authorizeAttachmentContext: vi.fn(async (_: string, context: unknown) => context),
  createDownloadUrl: vi.fn(),
  createUploadUrl: vi.fn(),
  generateAttachmentStorageKey: vi.fn(() => "budget-lines/line-1/attachments/generated-file.pdf"),
  normalizeStorageKey: vi.fn((key: string) => key),
  uploadStorageObject: vi.fn(),
}));
const imageStorage = vi.hoisted(() => ({ optimizeStoredImage: vi.fn().mockResolvedValue({ skipped: true }) }));

vi.mock("./tenant", async () => {
  const { HttpError } = await import("./errors");
  const roleCapabilities: Record<string, string[]> = {
    owner: ["operations.mutate", "grant_documents.mutate"],
    operator: ["operations.mutate", "grant_documents.mutate"],
    fundraiser: ["grant_documents.mutate"],
    member: [],
  };
  const requireOrgId = (locals: Record<string, unknown>) => {
    if (typeof locals.orgId === "string" && locals.orgId) return locals.orgId;
    throw new HttpError("Active workspace is required", 401);
  };
  return {
    requireOrgId,
    requireCapability: (locals: Record<string, unknown>, capability: string) => {
      const role = typeof locals.membershipRole === "string" ? locals.membershipRole : "";
      if (!roleCapabilities[role]?.includes(capability)) throw new HttpError("Insufficient permissions", 403);
      return requireOrgId(locals);
    },
  };
});
vi.mock("./storage", async () => {
  const { z } = await import("zod");
  return {
    ...storage,
    attachmentContextSchema: z.discriminatedUnion("type", [
      z.object({ type: z.literal("budget_line"), id: z.string().min(1) }),
      z.object({ type: z.literal("grant_application"), id: z.string().min(1) }),
    ]),
  };
});
vi.mock("./image-storage", () => imageStorage);

function jsonRequest(body: unknown) {
  return new Request("https://labels.example/api/storage/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://labels.example" },
    body: JSON.stringify(body),
  });
}

function uploadRequest(body: BodyInit, origin = "https://labels.example", headers: HeadersInit = {}) {
  return new Request("https://labels.example/api/storage/upload", { method: "POST", headers: { origin, ...headers }, body });
}

describe("storage route compatibility contract", () => {
  beforeEach(() => {
    process.env.PUBLIC_SITE_URL = "https://labels.example";
    vi.clearAllMocks();
    storage.createUploadUrl.mockResolvedValue({
      key: "org-1/documents/file.pdf",
      url: null,
      uploadUrl: "https://signed.example/upload",
    });
    storage.createDownloadUrl.mockResolvedValue("https://signed.example/download");
    storage.uploadStorageObject.mockResolvedValue({ key: "org-1/documents/file.pdf", url: null });
  });

  it.each(["owner", "operator"])("disables the unbounded legacy signed-upload key contract for %s", { timeout: 15_000 }, async (role) => {
    const { POST } = await import("../pages/api/storage/upload-url");
    const response = await POST({
      request: jsonRequest({ key: "documents/file.pdf", contentType: "application/pdf", size: 4 }),
      locals: { orgId: "org-1", membershipRole: role },
    } as never);
    expect(response.status).toBe(410);
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it.each(["fundraiser", "member"])("denies %s the legacy signed-upload key contract", async (role) => {
    const { POST } = await import("../pages/api/storage/upload-url");
    const response = await POST({
      request: jsonRequest({ key: "documents/file.pdf", contentType: "application/pdf", size: 4 }),
      locals: { orgId: "org-1", membershipRole: role },
    } as never);
    expect(response.status).toBe(403);
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects fundraiser context uploads through the signed-upload endpoint", async () => {
    const { POST } = await import("../pages/api/storage/upload-url");
    const context = { type: "budget_line", id: "line-1" };
    const response = await POST({
      request: jsonRequest({ context, filename: "file.pdf", contentType: "application/pdf", size: 4 }),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(response.status).toBe(403);
    expect(storage.createUploadUrl).not.toHaveBeenCalled();
  });

  it.each([
    ["oversized.pdf", "application/pdf", 25 * 1024 * 1024 + 1, 413],
    ["malware.exe", "application/x-msdownload", 4, 415],
    ["spoofed.pdf", "application/x-msdownload", 4, 415],
  ])("rejects invalid fundraiser context file %s", async (name, type, size, status) => {
    const { POST } = await import("../pages/api/storage/upload");
    const form = new FormData();
    form.set("context", JSON.stringify({ type: "grant_application", id: "app-1" }));
    form.set("file", new File([new Uint8Array(size)], name, { type }));
    const response = await POST({
      request: uploadRequest(form),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(response.status).toBe(status);
    expect(storage.uploadStorageObject).not.toHaveBeenCalled();
  });

  it.each([
    ["application.pdf", "application/pdf"],
    ["budget.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["evidence.png", "image/png"],
  ])("accepts valid fundraiser context file %s", async (name, type) => {
    const { POST } = await import("../pages/api/storage/upload");
    const form = new FormData();
    const context = { type: "grant_application", id: "app-1" };
    form.set("context", JSON.stringify(context));
    const bytes = name.endsWith(".pdf") ? new TextEncoder().encode("%PDF-1.7\nvalid")
      : name.endsWith(".xlsx") ? new TextEncoder().encode("PK\u0003\u0004...[Content_Types].xml...xl/workbook.xml")
      : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    form.set("file", new File([bytes], name, { type }));
    const response = await POST({
      request: uploadRequest(form),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(response.status).toBe(200);
    expect(storage.authorizeAttachmentContext).toHaveBeenCalledWith("org-1", context);
    expect(storage.uploadStorageObject).toHaveBeenCalledWith(expect.objectContaining({ preventOverwrite: true }), "org-1");
  });

  it("rejects a declared PDF whose body is not a PDF", async () => {
    const { POST } = await import("../pages/api/storage/upload");
    const form = new FormData();
    form.set("context", JSON.stringify({ type: "grant_application", id: "app-1" }));
    form.set("file", new File(["not-pdf"], "application.pdf", { type: "application/pdf" }));
    const response = await POST({ request: uploadRequest(form), locals: { orgId: "org-1", membershipRole: "fundraiser" } } as never);
    expect(response.status).toBe(415);
    expect(storage.uploadStorageObject).not.toHaveBeenCalled();
  });

  it("rejects an oversized Content-Length before multipart parsing", async () => {
    const { POST } = await import("../pages/api/storage/upload");
    const request = uploadRequest("small", "https://labels.example", { "content-length": String(27 * 1024 * 1024) });
    const formData = vi.spyOn(request, "formData");
    const response = await POST({ request, locals: { orgId: "org-1", membershipRole: "fundraiser" } } as never);
    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("keeps the legacy server-upload FormData contract operator-only", async () => {
    const { POST } = await import("../pages/api/storage/upload");
    const makeRequest = () => {
      const form = new FormData();
      form.set("key", "documents/file.pdf");
      form.set("file", new File(["test"], "file.pdf", { type: "application/pdf" }));
      return uploadRequest(form);
    };
    const request = makeRequest();
    const allowed = await POST({ request, locals: { orgId: "org-1", membershipRole: "operator" } } as never);
    expect(allowed.status).toBe(200);

    const denied = await POST({ request: makeRequest(), locals: { orgId: "org-1", membershipRole: "fundraiser" } } as never);
    expect(denied.status).toBe(403);
  });

  it.each([
    ["cross-origin", "https://attacker.example", "owner"],
    ["missing capability", "https://labels.example", "member"],
  ])("denies %s before consuming the upload body", async (_label, origin, membershipRole) => {
    const { POST } = await import("../pages/api/storage/upload");
    const request = uploadRequest("untrusted body", origin);
    expect(request.bodyUsed).toBe(false);
    const response = await POST({ request, locals: { orgId: "org-1", membershipRole } } as never);
    expect(response.status).toBe(403);
    expect(request.bodyUsed).toBe(false);
    expect(storage.uploadStorageObject).not.toHaveBeenCalled();
  });

  it("keeps legacy optimization operator-only and allows fundraiser context optimization", async () => {
    const { POST } = await import("../pages/api/storage/optimize-image");
    const legacyOwner = await POST({
      request: jsonRequest({ key: "documents/image.png" }),
      locals: { orgId: "org-1", membershipRole: "owner" },
    } as never);
    expect(legacyOwner.status).toBe(200);

    const legacyFundraiser = await POST({
      request: jsonRequest({ key: "documents/image.png" }),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(legacyFundraiser.status).toBe(403);

    const context = { type: "budget_line", id: "line-1" };
    const contextFundraiser = await POST({
      request: jsonRequest({ context, key: "org-1/budget-lines/line-1/attachments/image.png" }),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(contextFundraiser.status).toBe(200);
    expect(storage.authorizeAttachmentContext).toHaveBeenCalledWith("org-1", context);
  });

  it("issues signed download URLs for valid requests", async () => {
    const { POST } = await import("../pages/api/storage/download-url");
    const response = await POST({
      request: jsonRequest({ key: "documents/file.pdf", expiresIn: 120 }),
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ url: "https://signed.example/download" });
    expect(storage.createDownloadUrl).toHaveBeenCalledWith("documents/file.pdf", "org-1", 120);
  });

  it("rejects signed download requests without active workspace context", async () => {
    const { POST } = await import("../pages/api/storage/download-url");
    const response = await POST({
      request: jsonRequest({ key: "documents/file.pdf" }),
      locals: { membershipRole: "fundraiser" },
    } as never);

    expect(response.status).toBe(401);
  });
});
