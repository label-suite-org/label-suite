import { describe, expect, it, vi } from "vitest";
import { applyDatabaseRequestContext } from "./database-request-context";

describe("database request context settings", () => {
  it("clears absent values and binds the presented local-tool token ID transaction-locally", async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined);
    const transaction = { execute: vi.fn().mockResolvedValue(undefined) };

    await applyDatabaseRequestContext(
      transaction,
      { userId: "", localToolTokenId: "token-1" },
      setConfig,
    );

    expect(setConfig.mock.calls).toEqual([
      ["app.current_user_id", "", true],
      ["app.current_org_id", "", true],
      ["app.current_local_tool_token_id", "token-1", true],
    ]);
  });

  it("clears the bootstrap token when entering verified user and organization context", async () => {
    const setConfig = vi.fn().mockResolvedValue(undefined);
    const transaction = { execute: vi.fn().mockResolvedValue(undefined) };

    await applyDatabaseRequestContext(
      transaction,
      { userId: "user-1", orgId: "org-1" },
      setConfig,
    );

    expect(setConfig.mock.calls).toEqual([
      ["app.current_user_id", "user-1", true],
      ["app.current_org_id", "org-1", true],
      ["app.current_local_tool_token_id", "", true],
    ]);
  });
});
