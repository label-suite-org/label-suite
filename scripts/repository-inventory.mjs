#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function classifyBranch({ isMerged = false, isPatchEquivalent = false, hasUniqueCommits = false, reviewRequired = false }) {
  if (reviewRequired) return "review_required";
  if (isMerged) return "merged";
  if (isPatchEquivalent) return "patch_equivalent";
  if (hasUniqueCommits) return "unique";
  return "review_required";
}

function git(repository, args) {
  return execFileSync("git", ["-C", repository, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function assertRepository(repository) {
  if (!existsSync(repository)) throw new Error(`Repository not found: ${repository}`);
  try { git(repository, ["rev-parse", "--git-dir"]); } catch { throw new Error(`Not a Git repository: ${repository}`); }
}

function parseArgs(argv) {
  const out = { repository: process.cwd(), authority: "origin/main", markdown: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repository") out.repository = resolve(argv[++i]);
    else if (argv[i] === "--authority") out.authority = argv[++i];
    else if (argv[i] === "--markdown") out.markdown = resolve(argv[++i]);
  }
  return out;
}

function listWorktrees(repository) {
  const raw = git(repository, ["worktree", "list", "--porcelain"]);
  const blocks = raw ? raw.split(/\n\n+/) : [];
  return blocks.map((block) => {
    const lines = block.split("\n");
    const entry = { path: lines.find((line) => line.startsWith("worktree "))?.slice(9) ?? "", head: lines.find((line) => line.startsWith("HEAD "))?.slice(5) ?? "", branch: null, detached: false };
    const ref = lines.find((line) => line.startsWith("branch "));
    if (ref) entry.branch = ref.slice(7).replace(/^refs\/heads\//, "");
    entry.detached = lines.includes("detached");
    return entry;
  }).sort((a, b) => a.path.localeCompare(b.path));
}

function markdownReport(data) {
  const lines = ["# Repository and migration inventory", "", `- Generated: ${new Date().toISOString()}`, `- Authority: \`${data.authority}\` (${data.authoritySha || "unavailable"})`, `- Historical checkout: \`${data.repositorySha || "unavailable"}\``, `- Ahead/behind: ${data.aheadBehind || "unavailable"}`, "", "## Safety boundary", "", "This inventory is read-only. No branch, worktree, migration, or file was deleted.", "", "## Branches", "", "| Branch | Disposition | Ahead | Behind |", "| --- | --- | ---: | ---: |"];
  for (const b of data.branches) lines.push(`| \`${b.name}\` | ${b.disposition} | ${b.ahead} | ${b.behind} |`);
  lines.push("", "## Worktrees", "", "| Path | Branch | Detached | HEAD |", "| --- | --- | --- | --- |", ...data.worktrees.map((w) => `| \`${w.path}\` | ${w.branch ? `\`${w.branch}\`` : "(none)"} | ${w.detached ? "yes" : "no"} | \`${w.head}\` |`), "", "## Dirty paths", "", ...(data.dirtyTracked.length ? data.dirtyTracked.map((p) => `- tracked: \`${p}\``) : ["- none"]), ...(data.untracked.length ? data.untracked.map((p) => `- untracked: \`${p}\``) : ["- untracked: none"]), "", "## Migration and journal differences", "", ...(data.migrationDiff.length ? data.migrationDiff.map((p) => `- \`${p}\``) : ["- none detected"]));
  return `${lines.join("\n")}\n`;
}

export function collectInventory({ repository, authority = "origin/main" }) {
  assertRepository(repository);
  const repositorySha = git(repository, ["rev-parse", "HEAD"]);
  let authoritySha;
  try { authoritySha = git(repository, ["rev-parse", authority]); } catch { throw new Error(`Authority ref not found: ${authority}`); }
  const counts = git(repository, ["rev-list", "--left-right", "--count", `${authority}...HEAD`]).split(/\s+/).filter(Boolean);
  const status = git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const dirtyTracked = [], untracked = [];
  for (const line of status ? status.split("\n") : []) {
    const path = line.slice(3);
    if (line.startsWith("??")) untracked.push(path); else if (path) dirtyTracked.push(path);
  }
  dirtyTracked.sort(); untracked.sort();
  const names = git(repository, ["for-each-ref", "--format=%(refname:short)", "refs/heads"]).split("\n").filter(Boolean).sort();
  const branches = names.map((name) => {
    const countsForBranch = git(repository, ["rev-list", "--left-right", "--count", `${authority}...${name}`]).split(/\s+/).filter(Boolean);
    const behind = Number(countsForBranch[0] || 0), ahead = Number(countsForBranch[1] || 0);
    let isMerged = false;
    try { execFileSync("git", ["-C", repository, "merge-base", "--is-ancestor", name, authority], { stdio: "ignore" }); isMerged = true; } catch { /* not merged */ }
    let equivalent = false;
    let cherryFailed = false;
    try { equivalent = execFileSync("git", ["-C", repository, "cherry", authority, name], { encoding: "utf8" }).split("\n").filter((l) => l.startsWith("+")).length === 0 && ahead > 0; } catch { cherryFailed = true; }
    return { name, ahead, behind, disposition: classifyBranch({ isMerged: isMerged && ahead === 0, isPatchEquivalent: equivalent, hasUniqueCommits: ahead > 0, reviewRequired: cherryFailed }) };
  });
  const trackedMigrationDiff = git(repository, ["diff", "--name-only", `${authority}...HEAD`, "--", "drizzle/*.sql", "drizzle/meta/_journal.json"]).split("\n").filter(Boolean);
  const migrationDiff = [...new Set([...trackedMigrationDiff, ...[...dirtyTracked, ...untracked].filter((path) => path === "drizzle/meta/_journal.json" || /^drizzle\/\d+_.+\.sql$/.test(path))])].sort();
  branches.sort((a, b) => a.name.localeCompare(b.name));
  return { repository, repositorySha, authority, authoritySha, aheadBehind: `${counts[1] || 0} ahead / ${counts[0] || 0} behind`, dirtyTracked, untracked, branches, worktrees: listWorktrees(repository), migrationDiff };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const data = collectInventory(args);
  const output = markdownReport(data);
  if (args.markdown) { writeFileSync(args.markdown, output); } else process.stdout.write(output);
}
