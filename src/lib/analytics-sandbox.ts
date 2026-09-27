import { resolveAnalyticsSandboxConfig } from "../../scripts/analytics-sandbox-config";

export interface AnalyticsSandboxState {
  enabled: boolean;
  fixtureVersion: "analytics-sandbox-v1" | null;
}

export function resolveAnalyticsSandboxState(input: {
  enabled: string | undefined;
  isDev: boolean;
}): AnalyticsSandboxState {
  if (!input.enabled) {
    return { enabled: false, fixtureVersion: null };
  }

  if (input.enabled !== "1") {
    throw new Error("ANALYTICS_SANDBOX must be exactly 1 when set.");
  }

  if (!input.isDev) {
    throw new Error("Refusing analytics sandbox mode in production.");
  }

  return { enabled: true, fixtureVersion: "analytics-sandbox-v1" };
}

export function resolveAnalyticsSandboxRuntimeState(input: {
  env: NodeJS.ProcessEnv;
  isDev: boolean;
  orgId: string | undefined;
}): AnalyticsSandboxState {
  const state = resolveAnalyticsSandboxState({ enabled: input.env.ANALYTICS_SANDBOX, isDev: input.isDev });
  if (!state.enabled) return state;

  let config;
  try {
    config = resolveAnalyticsSandboxConfig(input.env);
  } catch (error) {
    throw new Error(`Refusing analytics sandbox runtime target: ${error instanceof Error ? error.message : "invalid sandbox configuration"}`);
  }
  if (input.env.DATABASE_URL !== config.databaseUrl) {
    throw new Error("Refusing analytics sandbox runtime target: DATABASE_URL must exactly equal ANALYTICS_SANDBOX_DB_URL.");
  }
  if (input.orgId !== config.orgId) {
    throw new Error("Refusing analytics sandbox runtime target: signed-in organization must equal ANALYTICS_SANDBOX_ORG_ID.");
  }

  return state;
}
