import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LOCAL_TOOL_API_VERSION } from "../lib/campaign-enrichment-local-tool-contract";
import {
  MAX_LOCAL_TOOL_JSON_BYTES,
  LocalToolError,
  handleLocalToolError,
  localToolJson,
  readLocalToolJson,
} from "./local-tools-api";

describe("local tool API envelopes", () => {
  it("returns the versioned success envelope with a stable request ID", async () => {
    const response = localToolJson({ items: [] }, 201, "request-1");

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBe("request-1");
    await expect(response.json()).resolves.toEqual({
      version: LOCAL_TOOL_API_VERSION,
      request_id: "request-1",
      data: { items: [] },
    });
  });

  it.each([
    ["authentication_failed", 401, "Authentication failed", false],
    ["scope_forbidden", 403, "Required scope is not granted", false],
    ["service_unavailable", 503, "Service temporarily unavailable", true],
  ] as const)("returns a fixed %s error without caller detail", async (code, status, message, retryable) => {
    const response = handleLocalToolError(new LocalToolError(code), "request-2");

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({
      version: LOCAL_TOOL_API_VERSION,
      request_id: "request-2",
      error: { code, message, retryable },
    });
  });

  it("maps validation failures to the fixed invalid request response", async () => {
    const validation = z.object({ value: z.string() }).safeParse({ value: 7 });
    if (validation.success) throw new Error("Fixture must fail validation");

    const response = handleLocalToolError(validation.error, "request-3");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", message: "Invalid request", retryable: false },
    });
  });

  it("returns only the safe expiry detail for a claim conflict", async () => {
    const response = handleLocalToolError(new LocalToolError("claim_conflict", {
      expires_at: "2026-08-10T12:20:00.000Z",
    }), "request-conflict");

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      version: LOCAL_TOOL_API_VERSION,
      request_id: "request-conflict",
      error: {
        code: "claim_conflict",
        message: "Resource is already claimed",
        retryable: true,
        details: { expires_at: "2026-08-10T12:20:00.000Z" },
      },
    });
  });

  it("rejects arbitrary claim-conflict detail at the error boundary", () => {
    expect(() => new LocalToolError("claim_conflict", {
      expires_at: "2026-08-10T12:20:00.000Z",
      token_id: "token-foreign",
    } as never)).toThrow();
  });

  it("never serializes or logs unexpected error detail", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = handleLocalToolError(new Error("lsmcp_secret-token-detail"), "request-4");

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("lsmcp_secret-token-detail");
    expect(JSON.stringify(log.mock.calls)).not.toContain("lsmcp_secret-token-detail");
    log.mockRestore();
  });
});

describe("bounded local-tool JSON requests", () => {
  it("rejects an oversized declared content length without reading the body", async () => {
    const request = new Request("https://labels.example/local-tool", {
      method: "POST",
      headers: {
        "content-length": String(MAX_LOCAL_TOOL_JSON_BYTES + 1),
        "content-type": "application/json",
      },
      body: "{}",
    });

    await expect(readLocalToolJson(request)).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("caps an undeclared streaming body and rejects deeply nested JSON iteratively", async () => {
    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_LOCAL_TOOL_JSON_BYTES));
        controller.enqueue(new Uint8Array([123]));
        controller.close();
      },
    });
    const oversized = new Request("https://labels.example/local-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: oversizedStream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const deepText = `${"[".repeat(5_000)}0${"]".repeat(5_000)}`;
    const deepStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(deepText));
        controller.close();
      },
    });
    const deep = new Request("https://labels.example/local-tool", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: deepStream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readLocalToolJson(oversized)).rejects.toMatchObject({ code: "invalid_request" });
    await expect(readLocalToolJson(deep)).rejects.toMatchObject({ code: "invalid_request" });
  });
});
