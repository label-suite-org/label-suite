#!/usr/bin/env node
import { assertDisposableReleaseGateTarget } from "./release-gate-fixture-safety";

import { configuredReleaseGateFixtureWorld, verifyReleaseGateFixtureManifest } from "./release-gate-fixture-world";

const requiredEnv: string[] = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "PUBLIC_SITE_URL",
  "RELEASE_GATE_FIXTURE_DISPOSABLE",
];

const baseUrl = process.env.E2E_BASE_URL ?? process.env.PUBLIC_SITE_URL;

function fail(message: string): never {
  console.error(`[release-gate] ERROR: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function missingRequiredRuntimeVariables(): string[] {
  return requiredEnv.filter((name) => !(process.env[name] ?? "").trim());
}

async function ensureHealth(url: string) {
  const endpoint = `${url}/api/health`;
  const response = await fetch(endpoint, {
    headers: {
      "User-Agent": "label-suite-release-gate-preflight/1",
    },
  });

  const bodyText = await response.text();
  let payload: Record<string, unknown> | undefined;

  try {
    payload = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    fail(`Health check failed at ${endpoint} (${response.status} ${response.statusText}); ${bodyText || "empty body"}`);
  }

  if (payload?.web !== "ok" || payload?.database !== "ok") {
    fail(`Runtime health not clean at ${endpoint}: ${JSON.stringify(payload ?? bodyText)}`);
  }

  if (
    !payload ||
    !["ok", "degraded", "unhealthy"].includes(String(payload?.status)) ||
    !["ok", "unavailable", "unknown"].includes(String(payload?.worker)) ||
    !(typeof payload?.revision === "string" || payload?.revision === null)
  ) {
    fail(`Runtime health response shape invalid at ${endpoint}: ${JSON.stringify(payload ?? bodyText)}`);
  }

  if (payload.status === "unhealthy") {
    fail(`Runtime health is unhealthy at ${endpoint}: ${JSON.stringify(payload)}`);
  }

  const expectedRevision = process.env.RELEASE_GATE_EXPECTED_REVISION?.trim();
  if (expectedRevision && payload.revision !== expectedRevision) {
    fail(`Runtime revision mismatch at ${endpoint}: expected ${expectedRevision}, got ${String(payload.revision)}`);
  }

  const requireWorker = process.env.RELEASE_GATE_REQUIRE_WORKER_HEALTH === "true";
  if (requireWorker && payload?.worker !== "ok") {
    fail(`Worker not healthy at ${endpoint}: ${JSON.stringify(payload)}`);
  }

  console.log(`[release-gate] health ok: ${JSON.stringify(payload)}`);
}

async function ensureAuthEntryPoint(url: string) {
  const response = await fetch(`${url}/login`, {
    redirect: "manual",
  });

  if (!response.ok) {
    fail(`Login entrypoint unavailable: ${response.status} ${response.statusText}`);
  }
}

async function main() {
  verifyReleaseGateFixtureManifest(configuredReleaseGateFixtureWorld());
  if (!baseUrl) {
    fail("E2E_BASE_URL and PUBLIC_SITE_URL are not configured");
  }

  const missing = missingRequiredRuntimeVariables();
  if (missing.length) {
    fail(`Missing required runtime credentials: ${missing.join(", ")}`);
  }

  const fixtureTarget = assertDisposableReleaseGateTarget({
    databaseUrl: process.env.DATABASE_URL,
    fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
    userEmail: process.env.E2E_USER_EMAIL,
    userPassword: process.env.E2E_USER_PASSWORD,
    ci: process.env.CI,
    analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB,
    analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE,
  });
  console.log(`[release-gate] disposable fixture target ok: ${fixtureTarget.mode} ${fixtureTarget.host}/${fixtureTarget.database}`);

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  await ensureAuthEntryPoint(normalizedBase);
  await ensureHealth(normalizedBase);
  console.log("[release-gate] preflight complete");
}

await main();
