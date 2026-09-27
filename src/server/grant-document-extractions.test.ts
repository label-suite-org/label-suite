import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({ db: {} }));

import {
  EXTRACTION_TEXT_LIMIT,
  extractGrantDocument,
  extractPdfTextFromBytes,
  type GrantDocumentExtractionRecord,
} from "./grant-document-extractions";
import { db } from "../lib/db";

describe("grant document extraction", () => {
  it("extracts bounded text from a PDF and preserves page metadata", async () => {
    const result = await extractPdfTextFromBytes(new TextEncoder().encode("%PDF-1.7 fake"), {
      parse: vi.fn().mockResolvedValue({ text: "A grant application narrative", numpages: 2, info: { Title: "Narrative" } }),
    });

    expect(result).toEqual({
      text: "A grant application narrative",
      metadata: { numpages: 2, info: { Title: "Narrative" } },
    });
  });

  it("caps extracted text at the configured limit", async () => {
    const result = await extractPdfTextFromBytes(new TextEncoder().encode("%PDF-1.7 fake"), {
      parse: vi.fn().mockResolvedValue({ text: "x".repeat(EXTRACTION_TEXT_LIMIT + 20), numpages: 1 }),
    });

    expect(result.text).toHaveLength(EXTRACTION_TEXT_LIMIT);
  });

  it("rejects non-PDF bytes before invoking the parser", async () => {
    const parse = vi.fn();
    await expect(extractPdfTextFromBytes(new TextEncoder().encode("plain text"), { parse }))
      .rejects.toThrow("Only PDF documents can be extracted");
    expect(parse).not.toHaveBeenCalled();
  });

  it("represents a failed extraction as retryable without changing readiness", () => {
    const failed: GrantDocumentExtractionRecord = {
      id: "extraction-1", orgId: "org-1", documentId: "document-1", sourceStorageKey: "org-1/grant-applications/app-1/attachments/a.pdf",
      sourceHash: "hash-1", status: "failed", extractedText: null, metadata: null, error: "parser failed", createdAt: "2026-07-15T00:00:00.000Z", updatedAt: "2026-07-15T00:00:00.000Z",
    };
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("parser failed");
  });

  it("recovers the existing row when a concurrent retry wins the unique-key insert", async () => {
    const document = { id: "document-1", fileLink: "org-1/grant-applications/app-1/attachments/a.pdf" };
    const pending = { id: "extraction-1", org_id: "org-1", document_id: "document-1", source_storage_key: document.fileLink, source_hash: "", status: "pending", extracted_text: null, metadata: null, error: null, created_at: new Date("2026-07-15T00:00:00Z"), updated_at: new Date("2026-07-15T00:00:00Z") };
    const ready = { ...pending, status: "ready", extracted_text: "Recovered text", metadata: {}, updated_at: new Date("2026-07-15T00:01:00Z") };
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ innerJoin: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [document] }) }) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [pending] }) }) });
    const conflictTarget = vi.fn();
    const insert = vi.fn().mockReturnValue({
      values: () => ({ onConflictDoNothing: (options: unknown) => { conflictTarget(options); return { returning: async () => [] }; } }),
    });
    const update = vi.fn()
      .mockReturnValueOnce({ set: () => ({ where: () => ({ returning: async () => [pending] }) }) })
      .mockReturnValueOnce({ set: () => ({ where: () => ({ returning: async () => [ready] }) }) });
    (db as any).select = select;
    (db as any).insert = insert;
    (db as any).update = update;

    const result = await extractGrantDocument("org-1", "document-1", {
      readObject: async () => new TextEncoder().encode("%PDF-1.7 fake"),
      parse: async () => ({ text: "Recovered text", numpages: 1 }),
    });

    expect(result.status).toBe("ready");
    expect(result.extractedText).toBe("Recovered text");
    expect(conflictTarget).toHaveBeenCalledWith(expect.objectContaining({ target: expect.any(Array) }));
  });
});
