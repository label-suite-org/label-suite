import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const revisionHelper = path.join(projectRoot, "scripts", "write-build-revision.sh");

describe("write-build-revision", () => {
  const temporaryDirectories: string[] = [];

  function createCheckout(): string {
    const directory = mkdtempSync(path.join(tmpdir(), "label-suite-revision-build-"));
    temporaryDirectories.push(directory);
    expect(spawnSync("git", ["init", "--quiet"], { cwd: directory, encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: directory, encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("git", ["config", "user.name", "Revision Test"], { cwd: directory, encoding: "utf8" }).status).toBe(0);
    writeFileSync(path.join(directory, "fixture.txt"), "revision fixture\n", "utf8");
    expect(spawnSync("git", ["add", "fixture.txt"], { cwd: directory, encoding: "utf8" }).status).toBe(0);
    expect(spawnSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: directory, encoding: "utf8" }).status).toBe(0);
    return directory;
  }

  afterEach(() => {
    while (temporaryDirectories.length > 0) rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  });

  it("writes the exact committed Git SHA as a strict revision artifact", () => {
    const checkout = createCheckout();
    const expected = spawnSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], { cwd: checkout, encoding: "utf8" });
    expect(expected.status).toBe(0);
    const revisionFile = path.join(checkout, ".release-revision");

    const result = spawnSync("sh", [revisionHelper, revisionFile], { cwd: checkout, encoding: "utf8" });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(readFileSync(revisionFile, "utf8")).toBe(`${expected.stdout.trim()}\n`);
  });

  it("fails closed when the build context is not a Git checkout", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "label-suite-revision-no-git-"));
    temporaryDirectories.push(directory);
    const revisionFile = path.join(directory, ".release-revision");

    const result = spawnSync("sh", [revisionHelper, revisionFile], { cwd: directory, encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(existsSync(revisionFile)).toBe(false);
  });

  it("rejects a malformed revision returned by Git", () => {
    const checkout = createCheckout();
    const fakeBin = path.join(checkout, "fake-bin");
    const fakeGit = path.join(fakeBin, "git");
    mkdirSync(fakeBin);
    writeFileSync(fakeGit, "#!/bin/sh\nprintf '%s\\n' unknown\n", "utf8");
    chmodSync(fakeGit, 0o755);
    const revisionFile = path.join(checkout, ".release-revision");

    const result = spawnSync("sh", [revisionHelper, revisionFile], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
    });

    expect(result.status).not.toBe(0);
    expect(existsSync(revisionFile)).toBe(false);
  });
});
