import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { classifyBranch, collectInventory } from "./repository-inventory.mjs";

function run(cwd, args) { return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
function commit(repo, message) { run(repo, ["add", "."]); run(repo, ["commit", "-m", message]); }

const checkPure = () => {
  assert.equal(classifyBranch({ isMerged: true }), "merged");
  assert.equal(classifyBranch({ isPatchEquivalent: true }), "patch_equivalent");
  assert.equal(classifyBranch({ hasUniqueCommits: true }), "unique");
  assert.equal(classifyBranch({ reviewRequired: true }), "review_required");
};

async function checkFixtures() {
  const repo = mkdtempSync(join(tmpdir(), "label-suite-inventory-"));
  try {
    run(repo, ["init", "-b", "main"]); run(repo, ["config", "user.email", "inventory@example.test"]); run(repo, ["config", "user.name", "Inventory Test"]);
    writeFileSync(join(repo, "README.md"), "base\n"); commit(repo, "base"); run(repo, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    run(repo, ["switch", "-c", "unique"]); writeFileSync(join(repo, "unique.txt"), "unique\n"); commit(repo, "unique");
    const uniqueCommit = run(repo, ["rev-parse", "HEAD"]);
    run(repo, ["switch", "main"]); run(repo, ["cherry-pick", uniqueCommit]); run(repo, ["update-ref", "refs/remotes/origin/main", "main"]);
    run(repo, ["switch", "-c", "patch-equivalent", "HEAD~1"]); run(repo, ["cherry-pick", uniqueCommit]); run(repo, ["commit", "--amend", "--no-edit", "--date", "2020-01-01T00:00:00Z"]);
    run(repo, ["switch", "-c", "unique-only", "main~1"]); writeFileSync(join(repo, "unique-only.txt"), "unique-only\n"); commit(repo, "unique-only");
    const linked = mkdtempSync(join(tmpdir(), "label-suite-linked-")); run(repo, ["worktree", "add", "-b", "linked", linked, "main"]);
    const detached = mkdtempSync(join(tmpdir(), "label-suite-detached-")); run(repo, ["worktree", "add", "--detach", detached, "main"]);
    writeFileSync(join(repo, "README.md"), "dirty\n"); writeFileSync(join(repo, "untracked.txt"), "untracked\n"); mkdirSync(join(repo, "drizzle")); writeFileSync(join(repo, "drizzle/0099_historical_only.sql"), "-- historical\n");
    const inventory = collectInventory({ repository: repo, authority: "origin/main" });
    assert.equal(inventory.branches.find((b) => b.name === "main")?.disposition, "merged");
    assert.equal(inventory.branches.find((b) => b.name === "unique-only")?.disposition, "unique");
    assert.equal(inventory.branches.find((b) => b.name === "patch-equivalent")?.disposition, "patch_equivalent");
    assert.ok(inventory.worktrees.some((w) => w.branch === "linked")); assert.ok(inventory.worktrees.some((w) => w.detached));
    assert.ok(inventory.dirtyTracked.length > 0); assert.ok(inventory.untracked.includes("untracked.txt")); assert.ok(inventory.migrationDiff.includes("drizzle/0099_historical_only.sql"));
    assert.deepEqual(inventory.branches.map((b) => b.name), [...inventory.branches.map((b) => b.name)].sort());
    assert.deepEqual(inventory.worktrees.map((w) => w.path), [...inventory.worktrees.map((w) => w.path)].sort());
    assert.deepEqual(inventory.dirtyTracked, [...inventory.dirtyTracked].sort()); assert.deepEqual(inventory.untracked, [...inventory.untracked].sort());
    rmSync(linked, { recursive: true, force: true }); rmSync(detached, { recursive: true, force: true });
  } finally { rmSync(repo, { recursive: true, force: true }); }
}

if (process.env.VITEST) { const { test } = await import("vitest"); test("classifies branch dispositions", checkPure); } else { const { test } = await import("node:test"); test("classifies branch dispositions", checkPure); }
if (!process.env.VITEST) { const { test } = await import("node:test"); test("inspects disposable repository fixtures", checkFixtures); }
