import { describe, expect, it, vi } from "vitest";
import {
  assertAttachmentStorageKey,
  assertStorageObjectIsNew,
  authorizeAttachmentContext,
  generateAttachmentStorageKey,
  type AttachmentContextLookup,
} from "./storage";

describe("storage attachment authorization", () => {
  it.each([
    { type: "budget_line" as const, id: "line-1", prefix: "budget-lines/line-1/attachments/" },
    { type: "grant_application" as const, id: "application-1", prefix: "grant-applications/application-1/attachments/" },
  ])("validates $type in the active organization and generates an opaque key", async ({ type, id, prefix }) => {
    const lookup: AttachmentContextLookup = vi.fn().mockResolvedValue(true);
    const context = { type, id };

    await expect(authorizeAttachmentContext("org-1", context, lookup)).resolves.toEqual(context);
    expect(lookup).toHaveBeenCalledWith("org-1", type, id);

    const key = generateAttachmentStorageKey(context, "My budget (final).pdf");
    expect(key).toMatch(new RegExp(`^${prefix}[0-9a-f-]+-My-budget-final.pdf$`));
    expect(() => assertAttachmentStorageKey("org-1", context, `org-1/${key}`)).not.toThrow();
  });

  it("rejects a context record outside the active organization", async () => {
    const lookup: AttachmentContextLookup = vi.fn().mockResolvedValue(false);
    await expect(authorizeAttachmentContext("org-1", {
      type: "budget_line",
      id: "foreign-line",
    }, lookup)).rejects.toThrow("Attachment context not found in active workspace");
  });

  it("rejects arbitrary, cross-organization, and mismatched attachment keys", () => {
    const context = { type: "grant_application" as const, id: "application-1" };
    for (const key of [
      "documents/file.pdf",
      "org-2/grant-applications/application-1/attachments/file.pdf",
      "org-1/grant-applications/application-2/attachments/file.pdf",
      "org-1/releases/release-1/audio/file.wav",
    ]) {
      expect(() => assertAttachmentStorageKey("org-1", context, key)).toThrow("Storage key does not match attachment context");
    }
  });

  it("rejects an existing object target before issuing an upload", async () => {
    const exists = vi.fn().mockResolvedValue(true);
    await expect(assertStorageObjectIsNew("budget-lines/line-1/attachments/file.pdf", "org-1", exists))
      .rejects.toThrow("Storage object already exists");
    expect(exists).toHaveBeenCalledWith("org-1/budget-lines/line-1/attachments/file.pdf");
  });

  it("permits a newly generated object target", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    await expect(assertStorageObjectIsNew("budget-lines/line-1/attachments/file.pdf", "org-1", exists))
      .resolves.toBeUndefined();
  });

  it("denies storage mutation to read-only members before parsing input", async () => {
    const { POST } = await import("../pages/api/storage/upload-url");
    const request = new Request("https://labels.example/api/storage/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://labels.example" },
      body: JSON.stringify({ key: "documents/file.pdf", size: 4 }),
    });
    const response = await POST({
      request,
      locals: { orgId: "org-1", membershipRole: "member" },
    } as never);
    expect(response.status).toBe(403);
  });

  it("rejects a client-provided key mixed into signed context mode", async () => {
      const module = await import("../pages/api/storage/upload-url");
      const request = new Request("https://labels.example/api/storage/upload-url", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://labels.example" },
        body: JSON.stringify({
          key: "releases/release-1/audio/overwrite.wav",
          filename: "overwrite.wav",
          contentType: "audio/wav",
          size: 4,
          context: { type: "budget_line", id: "line-1" },
        }),
      });
    const response = await module.POST({
      request,
      locals: { orgId: "org-1", membershipRole: "fundraiser" },
    } as never);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error: expect.stringMatching(/Invalid input|storage keys|Unrecognized key/i),
    }));
  });
});
