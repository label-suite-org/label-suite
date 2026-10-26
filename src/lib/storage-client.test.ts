import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFileUrl, sanitizeFilename, uploadFileToStorage } from "./storage-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("storage client", () => {
  it("sanitizes filenames used in storage keys", () => {
    expect(sanitizeFilename("  Album Art (final).png  ")).toBe("Album-Art-final.png");
  });

  it("uploads media assets through the bounded server path", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1234);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        key: "true-nature/media-assets/1234-cover.png",
        url: null,
      }))
      .mockResolvedValueOnce(Response.json({ variants: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFileToStorage(
      new File(["image"], "cover.png", { type: "image/png" }),
      "media-assets",
    );

    expect(result).toEqual({
      key: "true-nature/media-assets/1234-cover.png",
      url: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/storage/upload?kind=media-asset");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/storage/optimize-image");
  });

  it("rejects oversized media and document files before sending bytes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["fixture"], "master.wav", { type: "audio/wav" });
    Object.defineProperty(file, "size", { value: 101 * 1024 * 1024, configurable: true });
    await expect(uploadFileToStorage(file, "media-assets")).rejects.toThrow("100 MB");
    Object.defineProperty(file, "size", { value: 26 * 1024 * 1024 });
    await expect(uploadFileToStorage(file, "documents")).rejects.toThrow("25 MB");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the server upload when direct R2 upload is unavailable", async () => {
    vi.spyOn(Date, "now").mockReturnValue(5678);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        key: "true-nature/documents/5678-contract.pdf",
        url: null,
        uploadUrl: "https://signed.example/upload",
      }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockResolvedValueOnce(Response.json({
        key: "true-nature/documents/5678-contract.pdf",
        url: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uploadFileToStorage(
      new File(["document"], "contract.pdf", { type: "application/pdf" }),
      "documents",
    );

    expect(result.key).toBe("true-nature/documents/5678-contract.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/storage/upload");
  });

  it("sends context uploads through the multipart server endpoint without requesting a signed URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        key: "true-nature/budget-lines/line-1/attachments/generated-cover.png",
        url: null,
      }))
      .mockResolvedValueOnce(Response.json({ variants: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const context = { type: "budget_line" as const, id: "line-1" };

    await uploadFileToStorage(new File(["image"], "cover.png", { type: "image/png" }), "unused", context);

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/storage/upload");
    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(JSON.parse(String(body.get("context")))).toEqual(context);
    expect(body.get("file")).toBeInstanceOf(File);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/storage/upload-url", expect.anything());
  });

  it("batches private URL resolution into one API request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({
      expiresAt: Date.now() + 600_000,
      items: [
        { key: "true-nature/a.jpg", imageWidth: 96, url: "https://signed.example/a" },
        { key: "true-nature/b.jpg", imageWidth: 320, url: "https://signed.example/b" },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      resolveFileUrl("true-nature/a.jpg", 96),
      resolveFileUrl("true-nature/b.jpg", 320),
    ]);

    expect([first, second]).toEqual([
      "https://signed.example/a",
      "https://signed.example/b",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/storage/download-urls");
  });
});
