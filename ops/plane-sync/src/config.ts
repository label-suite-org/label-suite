import type { SyncConfig } from "./types.js";

export function requireString(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function requireHttpsUrl(env: NodeJS.ProcessEnv, name: string): URL {
  const value = new URL(requireString(env, name));
  if (value.protocol !== "https:") throw new Error(`${name} must use https`);
  return value;
}

function requireUuid(env: NodeJS.ProcessEnv, name: string): string {
  const value = requireString(env, name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${name} must be a UUID`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): SyncConfig {
  const repository = requireString(env, "GITHUB_REPOSITORY");
  if (repository !== "label-suite-org/label-suite_neon_r2") {
    throw new Error("GITHUB_REPOSITORY must equal label-suite-org/label-suite_neon_r2");
  }

  const writeMode = requireString(env, "SYNC_WRITE_MODE");
  if (writeMode !== "dry-run" && writeMode !== "active") {
    throw new Error("SYNC_WRITE_MODE must be dry-run or active");
  }

  return {
    repository,
    writeMode,
    host: env.HOST?.trim() || "0.0.0.0",
    port: parseBoundedInt(env.PORT, 8787, 1, 65535, "PORT"),
    bodyLimitBytes: parseBoundedInt(env.HTTP_BODY_LIMIT_BYTES, 1_048_576, 1, 1_048_576, "HTTP_BODY_LIMIT_BYTES"),
    databasePath: env.PLANE_SYNC_DB_PATH?.trim() || "/data/plane-sync.sqlite",
    reconcileIntervalMs: parseBoundedInt(env.RECONCILE_INTERVAL_MS, 900_000, 60_000, 86_400_000, "RECONCILE_INTERVAL_MS"),
    envelopeRetentionMs: parseBoundedInt(env.ENVELOPE_RETENTION_MS, 604_800_000, 86_400_000, 2_592_000_000, "ENVELOPE_RETENTION_MS"),
    githubAppId: requireString(env, "GITHUB_APP_ID"),
    githubInstallationId: requireString(env, "GITHUB_APP_INSTALLATION_ID"),
    githubPrivateKeyBase64: requireString(env, "GITHUB_APP_PRIVATE_KEY_B64"),
    githubWebhookSecret: requireString(env, "GITHUB_WEBHOOK_SECRET"),
    planeBaseUrl: requireHttpsUrl(env, "PLANE_BASE_URL"),
    planeApiToken: requireString(env, "PLANE_API_TOKEN"),
    planeWorkspace: requireString(env, "PLANE_WORKSPACE"),
    planeProjectId: requireUuid(env, "PLANE_PROJECT_ID"),
    revisionFile: env.SERVICE_REVISION_FILE?.trim() || "/app/.release-revision",
  };
}
