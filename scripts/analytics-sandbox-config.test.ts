import { describe, expect, it } from "vitest";
import {
  SANDBOX_FIXTURE_VERSION,
  resolveAnalyticsSandboxConfig,
} from "./analytics-sandbox-config";

const valid = {
  ANALYTICS_SANDBOX: "1",
  ANALYTICS_SANDBOX_DISPOSABLE: "1",
  ANALYTICS_SANDBOX_ORG_ID: "sandbox-org",
  ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox",
};

function configWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...valid, ...overrides };
}

describe("resolveAnalyticsSandboxConfig", () => {
  it("returns the explicit local sandbox configuration", () => {
    expect(resolveAnalyticsSandboxConfig(valid)).toEqual({
      databaseUrl: valid.ANALYTICS_SANDBOX_DB_URL,
      orgId: "sandbox-org",
      fixtureVersion: "analytics-sandbox-v1",
    });
    expect(SANDBOX_FIXTURE_VERSION).toBe("analytics-sandbox-v1");
  });

  it.each([
    ["the sandbox marker", { ANALYTICS_SANDBOX: undefined }],
    ["the disposable marker", { ANALYTICS_SANDBOX_DISPOSABLE: undefined }],
    ["the organization id", { ANALYTICS_SANDBOX_ORG_ID: undefined }],
    ["the database url", { ANALYTICS_SANDBOX_DB_URL: undefined }],
    ["a remote host", { ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@production.example/analytics_sandbox" }],
    ["the label_suite database", { ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/label_suite" }],
    ["the postgres database", { ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1/postgres" }],
    ["an invalid URL", { ANALYTICS_SANDBOX_DB_URL: "not a url" }],
    ["a non-PostgreSQL protocol", { ANALYTICS_SANDBOX_DB_URL: "https://127.0.0.1/analytics_sandbox" }],
    ["a URL without a database", { ANALYTICS_SANDBOX_DB_URL: "postgresql://sandbox:sandbox@127.0.0.1" }],
    ["an uppercase organization id", { ANALYTICS_SANDBOX_ORG_ID: "Sandbox-org" }],
    ["an organization id with a slash", { ANALYTICS_SANDBOX_ORG_ID: "sandbox/org" }],
    ["an organization id with whitespace", { ANALYTICS_SANDBOX_ORG_ID: "sandbox org" }],
    ["an organization id longer than 64 characters", { ANALYTICS_SANDBOX_ORG_ID: `a${"b".repeat(64)}` }],
  ])("refuses %s", (_reason, overrides) => {
    expect(() => resolveAnalyticsSandboxConfig(configWith(overrides))).toThrow(/^Refusing analytics sandbox target:/);
  });

  it.each([
    "?host=prod.example",
    "?port=5432",
    "?dbname=label_suite",
    "#fragment",
  ])("refuses URL connection overrides and fragments (%s)", (suffix) => {
    expect(() => resolveAnalyticsSandboxConfig(configWith({
      ANALYTICS_SANDBOX_DB_URL: `${valid.ANALYTICS_SANDBOX_DB_URL}${suffix}`,
    }))).toThrow(/^Refusing analytics sandbox target:/);
  });

  it.each(["%ZZ", "%C3%28"])("wraps malformed database path encoding (%s)", (encodedPath) => {
    expect(() => resolveAnalyticsSandboxConfig(configWith({
      ANALYTICS_SANDBOX_DB_URL: `postgresql://sandbox:sandbox@127.0.0.1/${encodedPath}`,
    }))).toThrow(/^Refusing analytics sandbox target:/);
  });
});
