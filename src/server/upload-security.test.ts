import { describe, expect, it } from "vitest";
import { assertGrantDocumentSignature, boundedMultipartRequest } from "./upload-security";

describe("upload security", () => {
  it("cancels a chunked body as soon as the streaming ceiling is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(6)); controller.enqueue(new Uint8Array(6)); },
      cancel() { cancelled = true; },
    });
    const request = new Request("https://labels.example/upload", { method: "POST", body, duplex: "half" } as RequestInit);
    await expect(boundedMultipartRequest(request, 8)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
  });

  it("checks PDF, image, and Office ZIP signatures", () => {
    expect(() => assertGrantDocumentSignature(new File(["x"], "x.pdf", { type: "application/pdf" }), new TextEncoder().encode("%PDF-1.7"))).not.toThrow();
    expect(() => assertGrantDocumentSignature(new File(["x"], "x.png", { type: "image/png" }), Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).not.toThrow();
    expect(() => assertGrantDocumentSignature(new File(["x"], "x.docx"), new TextEncoder().encode("PK\u0003\u0004[Content_Types].xml word/document.xml"))).not.toThrow();
    expect(() => assertGrantDocumentSignature(new File(["x"], "x.xlsx"), new TextEncoder().encode("PK\u0003\u0004[Content_Types].xml xl/workbook.xml"))).not.toThrow();
  });
});
