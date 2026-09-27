import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const [compose, dockerfile, workflow, releaseGate, packageJson, deploymentRunbook, webhookIngress, webhookProbe, webhookRunbook] = await Promise.all([
  readFile(resolve(root, "compose.prod.yml"), "utf8"),
  readFile(resolve(root, "Dockerfile.full"), "utf8"),
  readFile(resolve(root, ".github/workflows/verify.yml"), "utf8"),
  readFile(resolve(root, "scripts/run-ci-release-gate.sh"), "utf8"),
  readFile(resolve(root, "package.json"), "utf8"),
  readFile(resolve(root, "docs/runbooks/label-suite-deploy.md"), "utf8"),
  readFile(resolve(root, "ops/dokploy-webhook-ingress/Caddyfile"), "utf8"),
  readFile(resolve(root, "scripts/probe-dokploy-webhook-ingress.sh"), "utf8"),
  readFile(resolve(root, "docs/runbooks/dokploy-webhook-ingress.md"), "utf8"),
]);

const packageScripts = JSON.parse(packageJson).scripts;

assert.ok(
  deploymentRunbook.includes("docs/runbooks/dokploy-webhook-ingress.md"),
  "the primary deployment runbook must link the webhook ingress authority",
);
assert.equal(
  packageScripts["deploy:ingress-probe"],
  "bash scripts/probe-dokploy-webhook-ingress.sh",
  "the webhook ingress probe must have a stable package command",
);
assert.match(webhookIngress, /^http:\/\/label-suite-deploy\.truenature\.online\s*\{/m, "the versioned ingress must own the production webhook host");
assert.match(webhookIngress, /method\s+POST\b/, "only POST may reach Dokploy's GitHub webhook handler");
assert.match(webhookIngress, /path\s+\/api\/deploy\/github\b/, "only Dokploy's exact GitHub webhook path may be proxied");
assert.match(webhookIngress, /reverse_proxy\s+dokploy:3000\b/, "the accepted webhook must reach the Dokploy service");
assert.match(webhookIngress, /handle\s*\{\s*respond\s+"Not found"\s+404\s*\}/s, "every unmatched method and path must fail closed");
assert.doesNotMatch(webhookIngress, /^\s*path\s+\/github\b/m, "the retired Label Suite webhook path must not return");
assert.doesNotMatch(webhookIngress, /(secret|private[_ -]?key|bearer|token)/i, "the versioned ingress must contain no credentials");
assert.equal(webhookIngress.match(/^\s*method\s+/gm)?.length, 1, "the ingress must define exactly one accepted method matcher");
assert.equal(webhookIngress.match(/^\s*path\s+/gm)?.length, 1, "the ingress must define exactly one accepted path matcher");
assert.equal(webhookIngress.match(/^\s*reverse_proxy\s+/gm)?.length, 1, "the ingress must define exactly one upstream");

for (const expectedProbe of [
  "GET /api/deploy/github 404",
  "POST /api/deploy/github 401",
  "GET /github 404",
  "POST /github 404",
  "GET / 404",
]) {
  assert.match(webhookProbe, new RegExp(expectedProbe.replaceAll("/", "\\/")), `public probe must verify ${expectedProbe}`);
}
assert.match(webhookProbe, /curl\b/, "the ingress probe must use a portable HTTP client");
assert.doesNotMatch(webhookProbe, /(X-Hub-Signature|webhook[_ -]?secret|private[_ -]?key)/i, "the public probe must remain unsigned and secret-free");

for (const requiredRunbookText of [
  "ops/dokploy-webhook-ingress/Caddyfile",
  "/opt/music-stack/caddy/Caddyfile",
  "caddy validate",
  "caddy reload",
  "label-suite-deploy-hook.service",
  "label-suite-deploy.service",
  "label-suite-deploy.timer",
  "657264907",
  "GitHub Actions is verification-only",
]) {
  assert.ok(webhookRunbook.includes(requiredRunbookText), `webhook runbook must retain ${requiredRunbookText}`);
}

function directYamlChildren(source, parent) {
  const lines = source.split("\n");
  const parentIndex = lines.findIndex((line) => line === `${parent}:`);
  assert.notEqual(parentIndex, -1, `workflow must define top-level ${parent}`);
  const children = new Map();
  for (const line of lines.slice(parentIndex + 1)) {
    if (line && !line.startsWith(" ")) break;
    const match = line.match(/^  ([^\s:#][^:]*):\s*(.*)$/);
    if (match) children.set(match[1].trim(), match[2].trim());
  }
  return children;
}

const workflowTopLevel = new Set(
  workflow
    .split("\n")
    .filter((line) => line && !line.startsWith(" "))
    .map((line) => line.replace(/:.*/, "")),
);
assert.ok(workflowTopLevel.has("on"), "GitHub workflow must define events");
assert.ok(workflowTopLevel.has("permissions"), "GitHub workflow must define explicit permissions");
assert.ok(workflowTopLevel.has("jobs"), "GitHub workflow must define verification jobs");
assert.ok(workflowTopLevel.has("concurrency"), "GitHub workflow must cancel superseded verification runs");

const events = directYamlChildren(workflow, "on");
assert.ok(events.has("workflow_dispatch"), "GitHub workflow must support manual verification recovery");
assert.ok(events.has("pull_request"), "GitHub workflow must verify pull requests");
assert.ok(events.has("push"), "GitHub workflow must verify pushes");
assert.deepEqual(
  [...events.keys()],
  ["workflow_dispatch", "pull_request", "push"],
  "workflow must only verify manual dispatches, pull requests, and main pushes",
);
assert.ok(workflow.split("\n").some((line) => line.trim() === "branches: [main]"), "GitHub workflow must limit push verification to main");
const permissions = directYamlChildren(workflow, "permissions");
assert.equal(permissions.get("contents"), "read", "workflow requires only repository read permission");
assert.deepEqual([...permissions.keys()], ["contents"], "workflow must not request additional GitHub permissions");
assert.equal(directYamlChildren(workflow, "concurrency").get("cancel-in-progress"), "true", "workflow must cancel superseded verification runs");
assert.match(workflow, /group:\s*verify-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/, "workflow concurrency must be scoped to a pull request or ref");

assert.match(workflow, /actions\/checkout@v7/, "workflow must check out the verified revision with checkout v7");
assert.match(workflow, /actions\/checkout@v7\s*\n\s*with:\s*\n\s*persist-credentials:\s*false/, "workflow checkout must not retain write-capable credentials");
assert.match(workflow, /actions\/setup-node@v7/, "workflow must set up Node explicitly with setup-node v7");
assert.match(workflow, /node-version:\s*22/, "workflow must use Node 22");
assert.match(workflow, /cache:\s*npm/, "workflow must use npm's lockfile cache");
assert.match(workflow, /timeout-minutes:\s*(?:[1-9]|[1-9][0-9])\b/, "verification job must have a bounded timeout");
assert.match(workflow, /image:\s*postgres:17/, "workflow must provision PostgreSQL 17");
assert.match(workflow, /bash scripts\/run-ci-release-gate\.sh/, "workflow must run the clean release gate");
assert.match(workflow, /SHARP_IGNORE_GLOBAL_LIBVIPS:\s*["']?1/, "workflow must retain Sharp's prebuilt install setting");
assert.match(workflow, /sh scripts\/write-build-revision\.sh/, "workflow must generate the non-container revision artifact");
assert.match(workflow, /APP_REVISION_FILE=\$GITHUB_WORKSPACE\/\.release-revision/, "workflow must export the revision artifact path");

const githubShaReferences = workflow.match(/\$\{\{\s*github\.sha\s*\}\}/g) ?? [];
assert.equal(githubShaReferences.length, 1, "github.sha must only supply the release-gate expectation");
assert.match(workflow, /RELEASE_GATE_EXPECTED_REVISION=\$\{\{ github\.sha \}\}/, "workflow must use github.sha only as the release-gate expectation");
assert.doesNotMatch(workflow, /APP_COMMIT_SHA/, "workflow must not restore mutable runtime revisions");
assert.doesNotMatch(workflow, /DOKPLOY|GITHUB_DEPLOY_TOKEN|DEPLOY_HEALTH_URL/i, "workflow must not receive production deployment credentials");
assert.doesNotMatch(workflow, /trigger-dokploy-deploy|compose\.deploy|curl\b.*dokploy/i, "workflow verifies and does not deploy");

for (const command of [
  "npm run deps:ci",
  "npm run db:manifest-check",
  "npm run db:migrate",
  "npm run test:spotify-analytics-import",
  "npm run db:schema-contract",
  "npm run db:drift-check",
  "npx playwright install --with-deps chromium webkit",
  "npm run ci",
  "npm run release-gate:ci",
]) {
  assert.match(releaseGate, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `release gate must retain ${command}`);
}
assert.doesNotMatch(releaseGate, /APP_COMMIT_SHA/, "release gate must not restore mutable runtime revisions");

assert.doesNotMatch(compose, /APP_COMMIT_SHA/, "Dokploy compose must not depend on a mutable revision");
assert.match(compose, /image: \$\{APP_NAME:-label-suite\}-web:local/, "web image must use Dokploy's stable local name");
assert.match(compose, /image: \$\{APP_NAME:-label-suite\}-worker:local/, "worker and scheduler must share a stable image");
assert.match(compose, /label-suite-migrate:/, "migration service is required");
assert.match(compose, /condition: service_completed_successfully/, "runtime must wait for migrations");
assert.match(compose, /condition: service_healthy/, "web must wait for the worker");
assert.match(compose, /expose:\s*\n\s*- "4321"/, "web must expose Dokploy's internal port");
assert.doesNotMatch(compose, /container_name:/, "Dokploy compose must not fix container names");
assert.match(
  compose,
  /networks:\s*\n\s*dokploy-network:\s*\n\s*external:\s*true/,
  "Dokploy compose must join the external network managed by Dokploy",
);
assert.match(dockerfile, /COPY --from=builder \/app\/.release-revision \.\/\.release-revision/, "web and worker must receive the embedded revision artifact");
assert.match(dockerfile, /APP_REVISION_FILE=\/app\/\.release-revision/, "runtime must read the embedded revision artifact");

for (const retiredPath of [
  ".woodpecker/verify.yml",
  ".woodpecker/deploy.yml",
  "scripts/trigger-dokploy-deploy.mjs",
  ".github/workflows/ci.yml",
  "ops/label-suite-deploy/deploy.sh",
  "ops/label-suite-deploy/webhook_server.py",
  "scripts/verify-label-suite-deploy-webhook.py",
]) {
  await assert.rejects(access(resolve(root, retiredPath)), undefined, `${retiredPath} must remain retired`);
}

console.log("dokploy-deploy-contract: GitHub Actions verifies while Dokploy owns main deployment and self-derived revisions");
