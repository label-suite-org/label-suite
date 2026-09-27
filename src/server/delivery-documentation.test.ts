import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(new URL("../..", import.meta.url).pathname);

async function readRepositoryFile(path: string) {
  return readFile(resolve(root, path), "utf8");
}

describe("production delivery documentation", () => {
  it("documents GitHub verification and Dokploy's deployment boundary", async () => {
    const [deploy, sourceOfTruth, rollback, releaseGate, environment, backgroundJobs, readme, ingress] = await Promise.all([
      readRepositoryFile("docs/runbooks/label-suite-deploy.md"),
      readRepositoryFile("docs/runbooks/repository-source-of-truth.md"),
      readRepositoryFile("docs/runbooks/deployment-and-rollback.md"),
      readRepositoryFile("docs/runbooks/release-gate.md"),
      readRepositoryFile("docs/runbooks/dokploy-production.env.example"),
      readRepositoryFile("docs/runbooks/background-jobs.md"),
      readRepositoryFile("README.md"),
      readRepositoryFile("docs/runbooks/dokploy-webhook-ingress.md"),
    ]);

    expect(deploy).toContain("GitHub Actions performs verification only");
    expect(deploy).toContain("Dokploy GitHub\nApp observes merge push and auto-deploys");
    expect(deploy).toContain("auto deploy: **on**");
    expect(deploy).toContain("42\n`${{project.NAME}}` references");
    expect(deploy).toContain("must not configure `APP_COMMIT_SHA` in Dokploy");
    expect(deploy).toContain("Only after these gates pass, merge dependent work such as issue #114.");
    expect(sourceOfTruth).toContain("Dokploy's installed GitHub App observes the merge push to `main`");
    expect(rollback).toContain("Prefer a reviewed revert or forward-fix pull request to `main`");
    expect(releaseGate).toContain("GitHub Actions is verification-only");
    expect(releaseGate).toContain("clean-build `.release-revision` artifact");
    expect(environment).toContain("APP_COMMIT_SHA intentionally does not belong here");
    expect(environment).toContain("R2_ANALYTICS_PRIVATE_BUCKET=label-suite-private-analytics");
    expect(environment).toContain("42\n# ${{project.NAME}} references");
    expect(deploy).toContain("Public Development URL shows Disabled");
    expect(deploy).toMatch(/Custom Domains\s+has no entries/);
    expect(deploy).toContain("Object Read & Write");
    expect(deploy).toMatch(/only\s+`R2_BUCKET` and `R2_ANALYTICS_PRIVATE_BUCKET`/);
    expect(backgroundJobs).toContain("Dokploy owns all production worker, scheduler, and Sisense operations");
    expect(readme).toContain("Current execution status belongs to GitHub issues and pull requests");
    expect(readme).toContain("Run the same checks used by GitHub Actions");
    expect(ingress).toContain("GitHub Actions is verification-only");
    expect(ingress).toContain("Dokploy's installed GitHub App connection");
    expect(ingress).toContain("tracks `label-suite-org/label-suite_neon_r2`");
    expect(ingress).not.toContain("Forgejo");
    expect(readme).toContain("Dokploy-managed Compose service");
    expect(readme).toContain("Dokploy `label-suite-sisense-sync` one-shot/profile path");
    expect(readme).toContain("`npm run sisense:sync -- --apply --initial`");
    expect(readme).toContain("`npm run sisense:sync -- --apply --recent`");
    expect(readme).not.toContain("The approved first backfill task uses `npm run sisense:sync --");
    expect(backgroundJobs).not.toMatch(/```sh\s*docker compose/i);
    expect(readme).not.toMatch(/```sh\s*docker compose/i);
    expect(readme).toContain("Do not configure Coolify, a host cron, or a second worker/scheduler");
    expect(readme).not.toMatch(/For Coolify|```cron|scheduled task such as/i);
  });

  it("does not preserve retired delivery policy outside its explicit historical note", async () => {
    const activeDocuments = await Promise.all([
      "AGENTS.md",
      "README.md",
      "INFRASTRUCTURE.md",
      "GAP_ANALYSIS.md",
      "label-suite-technical-spec.md",
      "dossier.md",
      "docs/architecture-decisions/0001-use-npm.md",
      "docs/runbooks/repository-source-of-truth.md",
      "docs/runbooks/release-gate.md",
      "docs/runbooks/deployment-and-rollback.md",
      "docs/runbooks/dokploy-production.env.example",
      "docs/runbooks/background-jobs.md",
    ].map(readRepositoryFile));

    for (const document of activeDocuments) {
      expect(document).not.toMatch(/woodpecker|\.woodpecker|github_deploy_token|deploy\/<SHA>/i);
    }

    const deploy = await readRepositoryFile("docs/runbooks/label-suite-deploy.md");
    expect(deploy).toContain("Woodpecker was retired from the active Label Suite delivery path.");
    expect(deploy).not.toContain("Woodpecker is the CI/deployment gate");
  });
});
