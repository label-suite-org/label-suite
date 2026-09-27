import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");

const compose = readFileSync(path.join(projectRoot, "compose.prod.yml"), "utf8");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const dockerfile = readFileSync(path.join(projectRoot, "Dockerfile.full"), "utf8");
const runtimeDockerfile = readFileSync(path.join(projectRoot, "Dockerfile"), "utf8");
const sisenseDockerfile = readFileSync(path.join(projectRoot, "Dockerfile.sisense-worker"), "utf8");
const dockerignore = readFileSync(path.join(projectRoot, ".dockerignore"), "utf8");
const deployRunbook = readFileSync(
  path.join(projectRoot, "docs/runbooks/label-suite-deploy.md"),
  "utf8",
);
const envExample = readFileSync(path.join(projectRoot, ".env.example"), "utf8");
const normalizedDeployRunbook = deployRunbook.replace(/\s+/g, " ");

function composeServiceBlock(service: string): string {
  const marker = `\n  ${service}:\n`;
  const start = compose.indexOf(marker);
  if (start < 0) return "";
  const remainder = compose.slice(start + marker.length);
  const nextService = remainder.search(/^  [a-z][a-z0-9-]*:\n/m);
  return nextService < 0 ? remainder : remainder.slice(0, nextService);
}

describe("deployment configuration contracts", () => {
  it("builds separate web and worker image targets without a mutable revision input", () => {
    expect(compose).toContain("target: web");
    expect(compose).toContain("target: worker");
    expect(compose).toContain("image: ${APP_NAME:-label-suite}-web:local");
    expect(compose).toContain("image: ${APP_NAME:-label-suite}-worker:local");
    expect(compose).not.toContain("APP_COMMIT_SHA");
    expect(compose).not.toContain("args:");
    expect(compose).not.toContain("container_name:");
    expect(compose).toMatch(/networks:\s*\n\s*dokploy-network:\s*\n\s*external:\s*true/);
  });

  it("runs workers and schedulers without shell wrappers and with deterministic worker health checks", () => {
    expect(compose).toContain('command: ["npm", "run", "db:migrate:runtime-safe"]');
    expect(packageJson.scripts["db:migrate:runtime-safe"]).toBe(
      "tsx scripts/run-royalty-runtime-safe-migration.ts",
    );
    expect(packageJson.scripts["royalty:runtime-db-preflight"]).toContain("--preflight");
    expect(packageJson.scripts["royalty:runtime-db-postflight"]).toContain("--postflight");
    expect(compose).toContain("command: [\"./node_modules/.bin/tsx\", \"scripts/run-job-worker.ts\"]");
    expect(compose).toContain("command: [\"./node_modules/.bin/tsx\", \"scripts/enqueue-scheduled-jobs.ts\"]");
    expect(compose).toContain("scripts/worker-healthcheck.ts");
    expect(compose).toContain("healthcheck:");
    expect(compose).toContain("condition: service_completed_successfully");
  });

  it("keeps the elevated migration credential out of every runtime service", () => {
    // Break caught: loading MIGRATION_DATABASE_URL through the shared env file
    // gives web or worker code the database-owner credential.
    const migrateBlock = composeServiceBlock("label-suite-migrate");
    expect(migrateBlock).toContain("DATABASE_URL: ${DATABASE_URL:?required}");
    expect(migrateBlock).toContain("MIGRATION_DATABASE_URL: ${MIGRATION_DATABASE_URL:?required}");

    for (const service of ["label-suite", "label-suite-worker", "label-suite-scheduler", "label-suite-sisense-sync"]) {
      const block = composeServiceBlock(service);
      expect(block, service).toContain('MIGRATION_DATABASE_URL: ""');
    }

    expect(envExample).toContain("DATABASE_URL=postgres://runtime-user:");
    expect(envExample).toContain("MIGRATION_DATABASE_URL=postgres://migration-owner:");
  });

  it("keeps scheduler behind explicit profile and uses worker image", () => {
    expect(compose).toContain("profiles:\n      - scheduler");
    expect(compose).toContain("image: ${APP_NAME:-label-suite}-worker:local");
  });

  it("keeps web runner lean and dedicated worker target explicit", () => {
    expect(dockerfile).toContain("FROM node:22-alpine AS web");
    expect(dockerfile).toContain("FROM node:22-alpine AS worker");
    expect(dockerfile).toContain("FROM web AS runner");
    expect(dockerfile).toContain('CMD ["node", "server/entry.mjs"]');
    expect(dockerfile).not.toContain("COPY --from=builder /app/node_modules ./node_modules\nCOPY --from=builder /app/scripts ./scripts\nCOPY --from=builder /app/src ./src");
    expect(dockerfile).toContain("COPY --from=builder /app/scripts ./scripts");
    expect(dockerfile).toContain("COPY --from=builder /app/src ./src");
    const runnerIndex = dockerfile.lastIndexOf("FROM web AS runner");
    const workerIndex = dockerfile.lastIndexOf("FROM node:22-alpine AS worker");
    expect(runnerIndex).toBeGreaterThan(workerIndex);
  });

  it("derives and embeds one fail-closed checkout revision artifact in every production image", () => {
    for (const imageDockerfile of [runtimeDockerfile, dockerfile, sisenseDockerfile]) {
      expect(imageDockerfile).not.toContain("APP_COMMIT_SHA");
      expect(imageDockerfile).toContain("APP_REVISION_FILE=/app/.release-revision");
      expect(imageDockerfile).toContain("write-build-revision.sh");
    }
    expect(dockerfile).toContain("COPY --from=builder /app/.release-revision ./.release-revision");
    expect(runtimeDockerfile).toContain("COPY .git ./.git");
    expect(sisenseDockerfile).toContain("COPY . .");
    expect(dockerignore).not.toMatch(/^\.git$/m);
  });

  it("keeps Dokploy as the single scheduler and deployment owner", () => {
    expect(normalizedDeployRunbook).toContain("GitHub Actions performs verification only");
    expect(normalizedDeployRunbook).toContain("Dokploy is the only production runtime owner");
    expect(deployRunbook).toContain("auto deploy: **on**");
    expect(normalizedDeployRunbook).toContain("Dokploy scheduled task only after its enqueue");
    expect(deployRunbook).not.toContain("systemctl enable");
  });

  it("keeps the Sisense runner inert, supervised, and available to Dokploy schedules", () => {
    const sisenseBlock = compose.split("  label-suite-sisense-sync:")[1] ?? "";
    expect(sisenseBlock).not.toContain("profiles:");
    expect(sisenseBlock).toContain("image: ${APP_NAME:-label-suite}-sisense-worker:local");
    expect(sisenseBlock).toContain('command: ["sh", "-c", "while :; do sleep 3600; done"]');
    expect(sisenseBlock).toContain("restart: unless-stopped");
    expect(sisenseBlock).toContain("healthcheck:");
    expect(sisenseBlock).toContain("readFileSync('/app/.release-revision'");
    expect(sisenseBlock).toContain("/^[0-9a-f]{40}$/");
    expect(sisenseBlock).not.toMatch(/sisense:(?:sync|scrape)|--apply/);
    expect(sisenseBlock).not.toContain("container_name:");
    expect(sisenseBlock).not.toContain("music-stack_music-net");
    expect(sisenseDockerfile).toContain('CMD ["sh", "-c", "while :; do sleep 3600; done"]');
    expect(sisenseDockerfile).not.toMatch(/sisense:(?:sync|scrape)|--apply/);
  });
});
