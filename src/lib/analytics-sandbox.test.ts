import { describe, expect, it } from "vitest";
import { resolveAnalyticsSandboxRuntimeState, resolveAnalyticsSandboxState } from "./analytics-sandbox";

describe("resolveAnalyticsSandboxState", () => {
  it.each([undefined, ""])("keeps sandbox mode disabled when the marker is absent or empty in development", (enabled) => {
    expect(resolveAnalyticsSandboxState({ enabled, isDev: true })).toEqual({
      enabled: false,
      fixtureVersion: null,
    });
  });

  it("enables the versioned local fixture marker only for the exact development marker", () => {
    expect(resolveAnalyticsSandboxState({ enabled: "1", isDev: true })).toEqual({
      enabled: true,
      fixtureVersion: "analytics-sandbox-v1",
    });
  });

  it("refuses an enabled sandbox marker outside development", () => {
    expect(() => resolveAnalyticsSandboxState({ enabled: "1", isDev: false })).toThrow(
      "Refusing analytics sandbox mode in production.",
    );
  });

  it("rejects nonexact nonempty markers", () => {
    expect(() => resolveAnalyticsSandboxState({ enabled: "true", isDev: true })).toThrow(
      "ANALYTICS_SANDBOX must be exactly 1 when set.",
    );
  });

  it.each([
    [{ ANALYTICS_SANDBOX: "1", ANALYTICS_SANDBOX_DISPOSABLE: "1", ANALYTICS_SANDBOX_ORG_ID: "sandbox-org", ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox" }, "missing DATABASE_URL"],
    [{ ANALYTICS_SANDBOX: "1", ANALYTICS_SANDBOX_DISPOSABLE: "1", ANALYTICS_SANDBOX_ORG_ID: "sandbox-org", ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@example.com/analytics_sandbox", DATABASE_URL: "postgresql://sandbox:sandbox@example.com/analytics_sandbox" }, "remote sandbox URL"],
    [{ ANALYTICS_SANDBOX: "1", ANALYTICS_SANDBOX_DISPOSABLE: "1", ANALYTICS_SANDBOX_ORG_ID: "sandbox-org", ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox", DATABASE_URL: "postgresql://sandbox:sandbox@127.0.0.1/other_database" }, "different DATABASE_URL"],
  ])("refuses an invalid runtime database boundary: %s", (env, _description) => {
    expect(() => resolveAnalyticsSandboxRuntimeState({ env, isDev: true, orgId: "sandbox-org" })).toThrow(
      "Refusing analytics sandbox runtime target:",
    );
  });

  it("refuses a runtime organization mismatch before analytics queries", () => {
    expect(() => resolveAnalyticsSandboxRuntimeState({
      env: {
        ANALYTICS_SANDBOX: "1",
        ANALYTICS_SANDBOX_DISPOSABLE: "1",
        ANALYTICS_SANDBOX_ORG_ID: "sandbox-org",
        ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox",
        DATABASE_URL: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox",
      },
      isDev: true,
      orgId: "other-org",
    })).toThrow("Refusing analytics sandbox runtime target:");
  });

  it("keeps the production refusal ahead of sandbox target validation", () => {
    expect(() => resolveAnalyticsSandboxRuntimeState({
      env: { ANALYTICS_SANDBOX: "1" },
      isDev: false,
      orgId: "sandbox-org",
    })).toThrow("Refusing analytics sandbox mode in production.");
  });
});
