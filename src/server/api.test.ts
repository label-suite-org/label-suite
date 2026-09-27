import { afterEach, describe, expect, it, vi } from "vitest";
import { handleApiError, json } from "./api";
import { HttpError } from "./errors";
import { runWithRequestContext } from "./request-context";

describe("API response contracts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("propagates the active request ID to JSON responses", () => {
    const response = runWithRequestContext(
      { requestId: "request-test-123" },
      () => json({ ok: true }),
    );

    expect(response.headers.get("X-Request-ID")).toBe("request-test-123");
  });

  it("preserves expected HTTP errors without logging them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = runWithRequestContext(
      { requestId: "request-expected-123" },
      () => handleApiError(new HttpError("Not found", 404)),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("masks unexpected errors and returns a diagnostic request ID", async () => {
    const error = new Error("DATABASE_URL=secret-value");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = runWithRequestContext(
      { requestId: "request-failure-123" },
      () => handleApiError(error),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-ID")).toBe("request-failure-123");
    await expect(response.json()).resolves.toEqual({
      error: "Internal server error",
      request_id: "request-failure-123",
    });
    expect(errorSpy).toHaveBeenCalledWith(
      "[api] Unhandled error for request request-failure-123",
      error,
    );
  });

  it("keeps the generated error ID and header aligned outside middleware", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleApiError(new Error("failure"));
    const body = await response.json() as { request_id: string };

    expect(body.request_id).toBe(response.headers.get("X-Request-ID"));
  });
});
