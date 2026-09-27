import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const validEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  GITHUB_REPOSITORY: "label-suite-org/label-suite_neon_r2",
  SYNC_WRITE_MODE: "dry-run",
  GITHUB_APP_ID: "12345",
  GITHUB_APP_INSTALLATION_ID: "67890",
  GITHUB_APP_PRIVATE_KEY_B64: "base64-private-key",
  GITHUB_WEBHOOK_SECRET: "webhook-secret",
  PLANE_BASE_URL: "https://plane.example.test/api",
  PLANE_API_TOKEN: "plane-api-token",
  PLANE_WORKSPACE: "label-suite",
  PLANE_PROJECT_ID: "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
  ...overrides,
});

describe("loadConfig", () => {
  it("uses bounded defaults while preserving the canonical service configuration", () => {
    const config = loadConfig(validEnv({ HOST: " 127.0.0.1 ", PORT: "8788" }));

    expect({ ...config, planeBaseUrl: config.planeBaseUrl.toString() }).toEqual({
      repository: "label-suite-org/label-suite_neon_r2",
      writeMode: "dry-run",
      host: "127.0.0.1",
      port: 8788,
      bodyLimitBytes: 1_048_576,
      databasePath: "/data/plane-sync.sqlite",
      reconcileIntervalMs: 900_000,
      envelopeRetentionMs: 604_800_000,
      githubAppId: "12345",
      githubInstallationId: "67890",
      githubPrivateKeyBase64: "base64-private-key",
      githubWebhookSecret: "webhook-secret",
      planeBaseUrl: "https://plane.example.test/api",
      planeApiToken: "plane-api-token",
      planeWorkspace: "label-suite",
      planeProjectId: "10b19450-0ec3-43b6-b3ff-0ebcc92a4afe",
      revisionFile: "/app/.release-revision",
    });
  });

  it.each([
    "GITHUB_APP_PRIVATE_KEY_B64",
    "GITHUB_WEBHOOK_SECRET",
    "PLANE_API_TOKEN",
  ])("refuses startup when required secret %s is missing", (name) => {
    expect(() => loadConfig(validEnv({ [name]: " " }))).toThrow(`${name} is required`);
  });

  it("rejects any repository except the canonical repository", () => {
    expect(() => loadConfig(validEnv({ GITHUB_REPOSITORY: "other/repo" }))).toThrow(
      "GITHUB_REPOSITORY must equal label-suite-org/label-suite_neon_r2",
    );
  });

  it("rejects write modes that could bypass the explicit sync safety switch", () => {
    expect(() => loadConfig(validEnv({ SYNC_WRITE_MODE: "enabled" }))).toThrow(
      "SYNC_WRITE_MODE must be dry-run or active",
    );
  });

  it("refuses a Plane endpoint that would send credentials over an unsafe URL", () => {
    expect(() => loadConfig(validEnv({ PLANE_BASE_URL: "http://plane.example.test" }))).toThrow(
      "PLANE_BASE_URL must use https",
    );
  });

  it("rejects an out-of-range port before the listener can start", () => {
    expect(() => loadConfig(validEnv({ PORT: "65536" }))).toThrow(
      "PORT must be an integer from 1 through 65535",
    );
  });
});
