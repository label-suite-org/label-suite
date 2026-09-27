import { describe, expect, it } from "vitest";
import {
  getOrCreateRequestId,
  getRequestId,
  runWithRequestContext,
} from "./request-context";

describe("request context", () => {
  it("keeps a request ID across asynchronous work", async () => {
    const requestId = await runWithRequestContext(
      { requestId: "request-async-123" },
      async () => {
        await Promise.resolve();
        return getRequestId();
      },
    );

    expect(requestId).toBe("request-async-123");
  });

  it("creates a UUID when invoked outside a request", () => {
    expect(getOrCreateRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
