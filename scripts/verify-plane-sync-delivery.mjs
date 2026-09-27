import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parse } from "yaml";

const repository = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dockerfile = join(repository, "ops/plane-sync/Dockerfile");
const composeFile = join(repository, "ops/plane-sync/compose.yml");
const workflowFile = join(repository, ".github/workflows/verify.yml");
const documentedEnvironmentFile = join(repository, "docs/runbooks/github-plane-sync.env.example");
const dokployMutatedComposePath = "ops/plane-sync/compose.yml";
const dokployMaterializedEnvironmentPath = "ops/plane-sync/.env";
const temporaryDirectory = mkdtempSync(join(tmpdir(), "label-suite-plane-sync-delivery-"));
const buildContext = join(temporaryDirectory, "build-context");
const resourceSuffix = randomBytes(12).toString("hex");
const imageTag = `label-suite-plane-sync-delivery-contract:${resourceSuffix}`;
const containerName = `label-suite-plane-sync-delivery-contract-${resourceSuffix}`;
const canaries = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
const expectedRuntimeImage = "node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd";
let releaseRevision = "";
let ownedImageId;
let ownedContainerId;

function command(commandName, args, options = {}) {
  return execFileSync(commandName, args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function gitCommand(args, options = {}) {
  const { env = {}, ...commandOptions } = options;
  return command("git", args, {
    ...commandOptions,
    env: {
      ...process.env,
      ...env,
      GIT_NO_REPLACE_OBJECTS: "1",
    },
  });
}

function directoryContainsFiles(path) {
  if (!existsSync(path)) return false;
  return readdirSync(path, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? directoryContainsFiles(join(path, entry.name)) : true,
  );
}

function optionalGitConfig(context, pattern) {
  try {
    return gitCommand(["config", "--local", "--get-regexp", pattern], { cwd: context }).trim();
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return "";
    throw error;
  }
}

function assertImmutableGitProvenance(context) {
  for (const variable of ["GIT_REPLACE_REF_BASE", "GIT_GRAFT_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"]) {
    assert.equal(process.env[variable], undefined, "PLANE_SYNC_MUTABLE_GIT_METADATA");
  }

  const replacePath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "refs/replace"], { cwd: context }).trim();
  assert.equal(directoryContainsFiles(replacePath), false, "PLANE_SYNC_MUTABLE_GIT_METADATA");
  assert.equal(gitCommand(["for-each-ref", "--format=%(refname)", "refs/replace"], { cwd: context }).trim(), "", "PLANE_SYNC_MUTABLE_GIT_METADATA");

  for (const metadataPath of ["info/grafts", "objects/info/alternates"]) {
    const path = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", metadataPath], { cwd: context }).trim();
    assert.equal(existsSync(path) && statSync(path).size > 0, false, "PLANE_SYNC_MUTABLE_GIT_METADATA");
  }

  assert.equal(
    optionalGitConfig(context, "^(extensions\\.partial[Cc]lone|remote\\..*\\.promisor)$"),
    "",
    "PLANE_SYNC_MUTABLE_GIT_METADATA",
  );
  // A shallow checkout is safe for this contract because the complete HEAD
  // commit and tree are local; external alternates and promisor fetches are not.
}

function dockerignorePatternRegex(pattern) {
  const normalized = pattern.replace(/^\/+|\/+$/g, "");
  const anchored = normalized.includes("/");
  let expression = anchored ? "^" : "(?:^|/)";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
  }

  return new RegExp(`${expression}(?:/.*)?$`);
}

function dockerignorePatterns(source) {
  return source.split(/\r?\n/).flatMap((line) => {
    const pattern = line.trim();
    if (!pattern || pattern.startsWith("#")) return [];
    if (pattern.startsWith("!")) throw new Error("PLANE_SYNC_DOCKERIGNORE_NEGATION_UNSUPPORTED");
    return [dockerignorePatternRegex(pattern)];
  });
}

function effectiveUntrackedContextCount(statusRecords, dockerignoreSource) {
  const ignored = dockerignorePatterns(dockerignoreSource);
  return statusRecords.filter((record) => {
    if (!record.startsWith("?? ") && !record.startsWith("!! ")) return false;
    const path = record.slice(3).replace(/\/$/, "");
    return !ignored.some((pattern) => pattern.test(path));
  }).length;
}

function assertInvokingCheckoutHasNoEffectiveUntracked(context) {
  const records = gitCommand([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignored=matching",
  ], { cwd: context }).split("\0").filter(Boolean);
  const count = effectiveUntrackedContextCount(records, readFileSync(join(context, ".dockerignore"), "utf8"));
  if (count !== 0) throw new Error(`PLANE_SYNC_UNTRACKED_CONTEXT:${count}`);
}

function selfTestInvokingCheckoutGuard() {
  const context = join(temporaryDirectory, "untracked-checkout-self-test");
  mkdirSync(context, { recursive: true });
  gitCommand(["init", "--quiet"], { cwd: context });
  cpSync(join(repository, ".dockerignore"), join(context, ".dockerignore"));
  gitCommand(["add", ".dockerignore"], { cwd: context });
  gitCommand([
    "-c", "user.name=Plane Sync Delivery Contract",
    "-c", "user.email=plane-sync-delivery@example.test",
    "-c", "commit.gpgsign=false",
    "commit", "--quiet", "--no-verify", "-m", "untracked checkout guard fixture",
  ], { cwd: context });

  const sourcePath = join(context, "ops/plane-sync/src/untracked-checkout.ts");
  mkdirSync(dirname(sourcePath), { recursive: true });
  writeFileSync(sourcePath, "export const untrackedCheckout = true;\n");
  assert.throws(
    () => assertInvokingCheckoutHasNoEffectiveUntracked(context),
    (error) => error instanceof Error && error.message === "PLANE_SYNC_UNTRACKED_CONTEXT:1",
  );
  rmSync(join(context, "ops"), { recursive: true, force: true });

  const excludedArtifacts = [
    join(context, ".superpowers/sdd/ignored-report.md"),
    join(context, "ops/plane-sync/dist/ignored-artifact.js"),
  ];
  for (const path of excludedArtifacts) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "excluded\n");
  }
  assert.doesNotThrow(() => assertInvokingCheckoutHasNoEffectiveUntracked(context));

  gitCommand(["config", "extensions.partialClone", "origin"], { cwd: context });
  assert.throws(() => assertImmutableGitProvenance(context), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  gitCommand(["config", "--unset", "extensions.partialClone"], { cwd: context });

  const alternatesPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "objects/info/alternates"], { cwd: context }).trim();
  mkdirSync(dirname(alternatesPath), { recursive: true });
  writeFileSync(alternatesPath, "/nonexistent/external-object-store\n");
  assert.throws(() => assertImmutableGitProvenance(context), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  rmSync(alternatesPath, { force: true });

  const head = gitCommand(["rev-parse", "HEAD"], { cwd: context }).trim();
  const shallowPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "shallow"], { cwd: context }).trim();
  writeFileSync(shallowPath, `${head}\n`);
  assert.doesNotThrow(() => assertImmutableGitProvenance(context));
  rmSync(shallowPath, { force: true });
}

function createSyntheticGraftParent(context) {
  const tree = gitCommand(["rev-parse", "--verify", "HEAD^{tree}"], { cwd: context }).trim();
  const revision = gitCommand([
    "-c", "commit.gpgsign=false",
    "commit-tree", tree,
    "-m", "Plane sync delivery synthetic graft parent",
  ], {
    cwd: context,
    env: {
      GIT_AUTHOR_NAME: "Plane Sync Delivery Contract",
      GIT_AUTHOR_EMAIL: "plane-sync-delivery@example.test",
      GIT_COMMITTER_NAME: "Plane Sync Delivery Contract",
      GIT_COMMITTER_EMAIL: "plane-sync-delivery@example.test",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  }).trim();
  assert.match(revision, /^[0-9a-f]{40}$/, "PLANE_SYNC_SYNTHETIC_GRAFT_PARENT_INVALID");
  assert.equal(
    gitCommand(["cat-file", "-t", revision], { cwd: context }).trim(),
    "commit",
    "PLANE_SYNC_SYNTHETIC_GRAFT_PARENT_INVALID",
  );
  assert.equal(
    gitCommand(["rev-list", "--parents", "-n", "1", revision], { cwd: context }).trim(),
    revision,
    "PLANE_SYNC_SYNTHETIC_GRAFT_PARENT_INVALID",
  );
  return revision;
}

function selfTestSyntheticGraftParent() {
  const context = join(temporaryDirectory, "synthetic-graft-parent-self-test");
  mkdirSync(context, { recursive: true });
  gitCommand(["init", "--quiet"], { cwd: context });
  gitCommand([
    "-c", "user.name=Plane Sync Delivery Contract",
    "-c", "user.email=plane-sync-delivery@example.test",
    "-c", "commit.gpgsign=false",
    "commit", "--allow-empty", "--quiet", "--no-verify", "-m", "synthetic graft parent self-test",
  ], { cwd: context });

  const head = gitCommand(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: context }).trim();
  const shallowPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "shallow"], { cwd: context }).trim();
  writeFileSync(shallowPath, `${head}\n`);
  assert.throws(() => gitCommand(["rev-parse", "--verify", "HEAD^"], { cwd: context }));
  assert.doesNotThrow(() => assertImmutableGitProvenance(context));

  const syntheticParent = createSyntheticGraftParent(context);
  const graftPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"], { cwd: context }).trim();
  mkdirSync(dirname(graftPath), { recursive: true });
  writeFileSync(graftPath, `${head} ${syntheticParent}\n`);
  assert.throws(() => assertImmutableGitProvenance(context), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
}

function requiredFile(path) {
  if (!existsSync(path)) throw new Error(`Plane sync delivery contract failed: missing ${basename(path)}`);
}

function shouldRemoveOwnedResource(currentId, ownedId) {
  return typeof ownedId === "string" && ownedId.length > 0 && currentId === ownedId;
}

function dockerResourceId(kind, reference) {
  try {
    return command("docker", [kind, "inspect", "--format", "{{.Id}}", reference]).trim();
  } catch {
    return undefined;
  }
}

function assertNoCanaries(value, label) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  for (const canary of canaries) {
    assert.equal(bytes.includes(Buffer.from(canary)), false, `${label} must not contain injected secret bytes`);
  }
}

function inspectRevisionAuthority() {
  const source = readFileSync(dockerfile, "utf8");
  const imageStages = [...source.matchAll(/^FROM\s+(\S+)\s+AS\s+(\S+)$/gm)].map((match) => [match[1], match[2]]);
  assert.deepEqual(imageStages, [
    [expectedRuntimeImage, "builder"],
    [expectedRuntimeImage, "runtime"],
  ], "every Plane sync Docker stage must use the exact approved Alpine Node image");
  assert.match(source, /git rev-parse --verify HEAD\^\{commit\}/, "image revision must come from checkout Git metadata");
  assert.match(source, /"MUTABLE_REVISION"/, "legacy mutable revision input must emit its exact diagnostic");
  assert.doesNotMatch(readFileSync(composeFile, "utf8"), /PLANE_SYNC_REVISION/, "compose must not accept a mutable revision input");
  assert.doesNotMatch(readFileSync(documentedEnvironmentFile, "utf8"), /PLANE_SYNC_REVISION/, "operator documentation must not accept a mutable revision input");
}

function requireDocker() {
  try {
    command("docker", ["version", "--format", "{{.Server.Version}}"]);
  } catch (error) {
    throw new Error(`Plane sync delivery contract failed: Docker is unavailable (${error instanceof Error ? error.message : String(error)})`);
  }
}

function assertNoSecretMaterial(values, label) {
  const forbidden = /(?:GITHUB_APP_PRIVATE_KEY|GITHUB_WEBHOOK_SECRET|PLANE_API_TOKEN|PRIVATE_KEY|WEBHOOK_SECRET|API_TOKEN)/i;
  const inspected = Array.isArray(values) ? values : [values];
  assert.equal(inspected.some((value) => forbidden.test(value)), false, `${label} must not contain runtime secret material`);
}

function prepareBuildContext() {
  // The verifier never mirrors untracked source bytes. It constructs a full
  // Git checkout, copies only the current tracked diff, and commits that exact
  // deterministic tree so the Docker context and asserted revision are one unit.
  assertImmutableGitProvenance(repository);
  assertInvokingCheckoutHasNoEffectiveUntracked(repository);
  const sourceHead = gitCommand(["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  gitCommand(["clone", "--quiet", "--no-checkout", repository, buildContext], { cwd: temporaryDirectory });
  gitCommand(["checkout", "--quiet", "--detach", sourceHead], { cwd: buildContext });
  assertImmutableGitProvenance(buildContext);

  const trackedChanges = gitCommand(["status", "--porcelain=v1", "--untracked-files=no"]).trim();
  if (trackedChanges) {
    const trackedPaths = gitCommand(["ls-files", "-z"]).split("\0").filter(Boolean);
    for (const path of trackedPaths) {
      const source = join(repository, path);
      const target = join(buildContext, path);
      if (!existsSync(source)) {
        rmSync(target, { recursive: true, force: true });
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true, dereference: false, verbatimSymlinks: true });
    }
    gitCommand(["add", "--all"], { cwd: buildContext });
    gitCommand(
      [
        "-c", "user.name=Plane Sync Delivery Contract",
        "-c", "user.email=plane-sync-delivery@example.test",
        "-c", "commit.gpgsign=false",
        "commit", "--quiet", "--no-verify", "-m", "delivery contract working tree",
      ],
      {
        cwd: buildContext,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
          GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
        },
      },
    );
  }

  releaseRevision = gitCommand(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: buildContext }).trim();
  assert.match(releaseRevision, /^[0-9a-f]{40}$/);
}

function injectPositiveCanaries() {
  writeFileSync(join(buildContext, ".env"), `PLANE_API_TOKEN=${canaries[0]}\n`);
  const plausibleSecret = join(buildContext, "ops/plane-sync/runtime-private-key.pem");
  writeFileSync(plausibleSecret, `-----BEGIN PRIVATE KEY-----\n${canaries[1]}\n-----END PRIVATE KEY-----\n`);
}

function assertContextControlFilesMatchHead(context) {
  assertImmutableGitProvenance(context);
  for (const path of [".dockerignore", "ops/plane-sync/Dockerfile"]) {
    const actual = readFileSync(join(context, path));
    const expected = gitCommand(["cat-file", "blob", `HEAD:${path}`], { cwd: context, encoding: null });
    assert.deepEqual(actual, expected, `${path} must exactly match the build-context HEAD before Docker starts`);
  }
}

function assertNegativeFixtureBaseline(context) {
  const status = gitCommand(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: context });
  if (status !== "") throw new Error("PLANE_SYNC_FIXTURE_BASELINE_INVALID");

  const treeEntry = gitCommand(["ls-tree", "HEAD", "--", "CLAUDE.md"], { cwd: context }).trim();
  const match = /^120000 blob ([0-9a-f]{40})\tCLAUDE\.md$/.exec(treeEntry);
  if (!match) throw new Error("PLANE_SYNC_FIXTURE_BASELINE_INVALID");
  const expectedTarget = gitCommand(["cat-file", "blob", match[1]], { cwd: context });
  let actualTarget;
  try {
    actualTarget = readlinkSync(join(context, "CLAUDE.md"));
  } catch {
    throw new Error("PLANE_SYNC_FIXTURE_BASELINE_INVALID");
  }
  if (actualTarget !== expectedTarget) throw new Error("PLANE_SYNC_FIXTURE_BASELINE_INVALID");
}

function assertFixtureStatus(context, expected, code) {
  const actual = gitCommand([
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ], { cwd: context }).split("\0").filter(Boolean);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(code);
}

function createNegativeFixture(label) {
  const context = join(temporaryDirectory, `${label}-context`);
  cpSync(buildContext, context, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
  });
  assertNegativeFixtureBaseline(context);
  return context;
}

function selfTestNegativeFixtureCopy() {
  // Deliberate control only: default cpSync rewrites relative symlink text and
  // must never be used to construct a build or negative-test fixture.
  const ordinary = join(temporaryDirectory, "ordinary-copy-self-test");
  cpSync(buildContext, ordinary, { recursive: true, dereference: false });
  const expectedTarget = gitCommand(["cat-file", "blob", "HEAD:CLAUDE.md"], { cwd: buildContext });
  if (readlinkSync(join(ordinary, "CLAUDE.md")) === expectedTarget) {
    throw new Error("PLANE_SYNC_ORDINARY_COPY_SELF_TEST_INVALID");
  }

  const preserved = createNegativeFixture("preserved-copy-self-test");
  if (readlinkSync(join(preserved, "CLAUDE.md")) !== expectedTarget) {
    throw new Error("PLANE_SYNC_VERBATIM_COPY_SELF_TEST_INVALID");
  }
  rmSync(ordinary, { recursive: true, force: true });
  rmSync(preserved, { recursive: true, force: true });
}

function runDockerBuild(context, tag, extraArguments = [], verifyControls = true) {
  if (verifyControls) assertContextControlFilesMatchHead(context);
  command("docker", [
    "build",
    "--progress=plain",
    "--file", join(context, "ops/plane-sync/Dockerfile"),
    "--tag", tag,
    ...extraArguments,
    context,
  ]);
}

function capturedProcessOutput(error) {
  if (!error || typeof error !== "object") return "";
  return [error.stdout, error.stderr]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
    .join("\n");
}

function deliveryOutputSummary(output, diagnostics) {
  const text = String(output);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const normalized = text
    .replace(/[\u001b\u009b]\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/[\u001b\u009b]\[[0-?]*[ -\\/]*[@-~]/g, "");
  const failure = /\bfailed to solve\b/i.test(normalized)
    ? "solve"
    : /\bdid not complete successfully\b/i.test(normalized)
      ? "process"
      : /\b(?:load metadata|pull access denied|manifest unknown|network|timed? ?out)\b/i.test(normalized)
        ? "transport"
        : "unknown";
  return [
    "lines=" + Math.min(lines.length, 999),
    "bytes=" + Math.min(Buffer.byteLength(text), 999999),
    "diagnostics=" + (diagnostics.length === 0 ? "none" : diagnostics.length === 1 ? "one" : "multiple"),
    "failure=" + failure,
  ].join(",");
}

function assertExactDeliveryDiagnostic(output, expectedCode) {
  const diagnostics = output.split(/\r?\n/).flatMap((line) => {
    // BuildKit's plain progress stream is normally free of terminal control
    // sequences, but hosted runners can still preserve ANSI cursor/color
    // codes around a line (and leave a carriage return before the newline).
    // Strip those transport decorations before matching the *whole* line so
    // Dockerfile source echoes can never count as runtime diagnostics.
    const normalized = line
      .replace(/[\u001b\u009b]\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
      .replace(/[\u001b\u009b]\[[0-?]*[ -\/]*[@-~]/g, "")
      .trim()
      .replace(/^#\d+\s+(?:\d+(?:\.\d+)?s?\s+)?/, "");
    const match = /^PLANE_SYNC_DIAGNOSTIC:([A-Z][A-Z0-9_]*)$/.exec(normalized);
    return match ? [match[1]] : [];
  });
  if (diagnostics.length !== 1 || diagnostics[0] !== expectedCode) {
    throw new Error(
      "PLANE_SYNC_NEGATIVE_REASON_MISMATCH:" + expectedCode + ":" + deliveryOutputSummary(output, diagnostics),
    );
  }
}

function selfTestDeliveryDiagnosticParser() {
  const syntheticBuildkitOutput = [
    "#12 [builder 5/9] RUN printf 'PLANE_SYNC_DIAGNOSTIC:CONTEXT_MISSING'",
    "#12 0.127 PLANE_SYNC_DIAGNOSTIC:CONTEXT_EXTRA",
  ].join("\n");
  assert.throws(
    () => assertExactDeliveryDiagnostic(syntheticBuildkitOutput, "CONTEXT_MISSING"),
    /PLANE_SYNC_NEGATIVE_REASON_MISMATCH:CONTEXT_MISSING/,
  );
  assert.doesNotThrow(() => assertExactDeliveryDiagnostic(syntheticBuildkitOutput, "CONTEXT_EXTRA"));
  assert.throws(
    () => assertExactDeliveryDiagnostic(
      "#12 [builder 5/9] RUN printf 'PLANE_SYNC_DIAGNOSTIC:CONTEXT_MISSING'",
      "CONTEXT_MISSING",
    ),
    /PLANE_SYNC_NEGATIVE_REASON_MISMATCH:CONTEXT_MISSING/,
  );
  assert.throws(
    () => assertExactDeliveryDiagnostic(
      "#12 0.127 PLANE_SYNC_DIAGNOSTIC:CONTEXT_EXTRA\n#12 0.128 PLANE_SYNC_DIAGNOSTIC:CONTEXT_EXTRA",
      "CONTEXT_EXTRA",
    ),
    /PLANE_SYNC_NEGATIVE_REASON_MISMATCH:CONTEXT_EXTRA/,
  );
  assert.doesNotThrow(() => assertExactDeliveryDiagnostic(
    "\u001b[2K\u001b[0m#12 0.127 PLANE_SYNC_DIAGNOSTIC:CONTEXT_EXTRA\r\n",
    "CONTEXT_EXTRA",
  ));
  assert.match(
    deliveryOutputSummary("ERROR: failed to solve: process did not complete successfully", []),
    /^lines=1,bytes=\d+,diagnostics=none,failure=solve$/,
  );
}

function expectDockerBuildFailure({
  label,
  context,
  reasonCode,
  extraArguments = [],
  verifyControls = true,
}) {
  const negativeTag = `label-suite-plane-sync-delivery-negative-${label}:${resourceSuffix}`;
  assert.equal(dockerResourceId("image", negativeTag), undefined, `negative-test tag ${label} must be unowned before use`);
  let unexpectedlySucceeded = false;
  let negativeImageId;
  let failureOutput = "";
  try {
    runDockerBuild(context, negativeTag, extraArguments, verifyControls);
    unexpectedlySucceeded = true;
    negativeImageId = dockerResourceId("image", negativeTag);
  } catch (error) {
    failureOutput = capturedProcessOutput(error);
  } finally {
    const currentId = dockerResourceId("image", negativeTag);
    if (shouldRemoveOwnedResource(currentId, negativeImageId)) command("docker", ["image", "rm", negativeTag]);
  }
  assert.equal(unexpectedlySucceeded, false, `${label} build must fail closed`);
  assertNoCanaries(failureOutput, `captured ${label} failure`);
  assertExactDeliveryDiagnostic(failureOutput, reasonCode);
}

function verifyRevisionRejections() {
  assertNegativeFixtureBaseline(buildContext);
  expectDockerBuildFailure({
    label: "mutable-revision",
    context: buildContext,
    reasonCode: "MUTABLE_REVISION",
    extraArguments: ["--build-arg", "PLANE_SYNC_REVISION=0123456789abcdef0123456789abcdef01234567"],
  });

  const dirtyContext = createNegativeFixture("dirty-checkout");
  appendFileSync(join(dirtyContext, "package.json"), "\n");
  assertFixtureStatus(dirtyContext, [" M package.json"], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:dirty-checkout");
  expectDockerBuildFailure({
    label: "dirty-checkout",
    context: dirtyContext,
    reasonCode: "CONTEXT_MODIFIED",
  });

  const noGitContext = createNegativeFixture("no-git");
  rmSync(join(noGitContext, ".git"), { recursive: true, force: true });
  if (existsSync(join(noGitContext, ".git"))) throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:missing-git");
  expectDockerBuildFailure({
    label: "missing-git",
    context: noGitContext,
    reasonCode: "MISSING_GIT",
    verifyControls: false,
  });

  const untrackedSourceContext = createNegativeFixture("untracked-source");
  writeFileSync(join(untrackedSourceContext, "ops/plane-sync/src/untracked-contract.ts"), "export const untrackedContextByte = true;\n");
  assertFixtureStatus(
    untrackedSourceContext,
    ["?? ops/plane-sync/src/untracked-contract.ts"],
    "PLANE_SYNC_FIXTURE_MUTATION_INVALID:untracked-source",
  );
  expectDockerBuildFailure({
    label: "untracked-source",
    context: untrackedSourceContext,
    reasonCode: "CONTEXT_EXTRA",
  });

  const deletedTrackedContext = createNegativeFixture("deleted-tracked");
  rmSync(join(deletedTrackedContext, "ops/plane-sync/src/index.ts"));
  assertFixtureStatus(
    deletedTrackedContext,
    [" D ops/plane-sync/src/index.ts"],
    "PLANE_SYNC_FIXTURE_MUTATION_INVALID:deleted-tracked",
  );
  expectDockerBuildFailure({
    label: "deleted-tracked",
    context: deletedTrackedContext,
    reasonCode: "CONTEXT_MISSING",
  });

  const dirtyDockerignoreContext = createNegativeFixture("dirty-dockerignore");
  appendFileSync(join(dirtyDockerignoreContext, ".dockerignore"), "\nops/plane-sync/src/untracked-contract.ts\n");
  assertFixtureStatus(dirtyDockerignoreContext, [" M .dockerignore"], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:dirty-dockerignore");
  assert.throws(() => assertContextControlFilesMatchHead(dirtyDockerignoreContext));
  expectDockerBuildFailure({
    label: "dirty-dockerignore",
    context: dirtyDockerignoreContext,
    reasonCode: "CONTEXT_MODIFIED",
    verifyControls: false,
  });

  const dirtyDockerfileContext = createNegativeFixture("dirty-dockerfile");
  appendFileSync(join(dirtyDockerfileContext, "ops/plane-sync/Dockerfile"), "\n# uncommitted control-file byte\n");
  assertFixtureStatus(
    dirtyDockerfileContext,
    [" M ops/plane-sync/Dockerfile"],
    "PLANE_SYNC_FIXTURE_MUTATION_INVALID:dirty-dockerfile",
  );
  assert.throws(() => assertContextControlFilesMatchHead(dirtyDockerfileContext));
  expectDockerBuildFailure({
    label: "dirty-dockerfile",
    context: dirtyDockerfileContext,
    reasonCode: "CONTEXT_MODIFIED",
    verifyControls: false,
  });

  const ignoredEnvironmentContext = createNegativeFixture("ignored-environment");
  writeFileSync(join(ignoredEnvironmentContext, ".env.local"), `PLANE_API_TOKEN=${canaries[0]}\n`);
  assertFixtureStatus(ignoredEnvironmentContext, [], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:ignored-environment");
  expectDockerBuildFailure({
    label: "ignored-environment",
    context: ignoredEnvironmentContext,
    reasonCode: "CONTEXT_EXTRA",
  });

  const privateKeyContext = createNegativeFixture("private-key");
  const privateKeyPath = join(privateKeyContext, "outputs/runtime-private-key-copy.pem");
  mkdirSync(dirname(privateKeyPath), { recursive: true });
  writeFileSync(privateKeyPath, canaries[1]);
  assertFixtureStatus(privateKeyContext, [], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:private-key");
  expectDockerBuildFailure({
    label: "private-key",
    context: privateKeyContext,
    reasonCode: "CONTEXT_EXTRA",
  });

  const nonignoredCanaryContext = createNegativeFixture("nonignored-canary");
  writeFileSync(join(nonignoredCanaryContext, "ops/plane-sync/context-canary.txt"), canaries[0]);
  assertFixtureStatus(
    nonignoredCanaryContext,
    ["?? ops/plane-sync/context-canary.txt"],
    "PLANE_SYNC_FIXTURE_MUTATION_INVALID:nonignored-canary",
  );
  expectDockerBuildFailure({
    label: "nonignored-canary",
    context: nonignoredCanaryContext,
    reasonCode: "CONTEXT_EXTRA",
  });

  const replaceRefContext = createNegativeFixture("replace-ref");
  const originalHead = command("git", ["rev-parse", "HEAD"], { cwd: replaceRefContext }).trim();
  const markerPath = "ops/plane-sync/src/replaced-provenance-marker.ts";
  writeFileSync(join(replaceRefContext, markerPath), "export const replacedProvenanceMarker = true;\n");
  command("git", ["add", "--", markerPath], { cwd: replaceRefContext });
  const replacementTree = command("git", ["write-tree"], { cwd: replaceRefContext }).trim();
  const replacementCommit = command("git", ["commit-tree", replacementTree, "-p", originalHead], {
    cwd: replaceRefContext,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Plane Sync Delivery Contract",
      GIT_AUTHOR_EMAIL: "plane-sync-delivery@example.test",
      GIT_COMMITTER_NAME: "Plane Sync Delivery Contract",
      GIT_COMMITTER_EMAIL: "plane-sync-delivery@example.test",
      GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    },
  }).trim();
  command("git", ["replace", originalHead, replacementCommit], { cwd: replaceRefContext });
  const replacementMetadata = gitCommand(["for-each-ref", "--format=%(refname) %(objectname)", "refs/replace"], { cwd: replaceRefContext }).trim();
  if (replacementMetadata !== `refs/replace/${originalHead} ${replacementCommit}`) {
    throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:replace-ref");
  }
  if (command("git", ["rev-parse", "HEAD"], { cwd: replaceRefContext }).trim() !== originalHead) {
    throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:replace-ref");
  }
  if (command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: replaceRefContext }) !== "") {
    throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:replace-ref");
  }
  assert.throws(() => assertImmutableGitProvenance(replaceRefContext), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  expectDockerBuildFailure({
    label: "replace-ref",
    context: replaceRefContext,
    reasonCode: "MUTABLE_GIT_METADATA",
    verifyControls: false,
  });

  const graftContext = createNegativeFixture("graft");
  const graftRevision = gitCommand(["rev-parse", "--verify", "HEAD^{commit}"], { cwd: graftContext }).trim();
  assert.equal(graftRevision, releaseRevision, "PLANE_SYNC_FIXTURE_MUTATION_INVALID:graft");
  const parentRevision = createSyntheticGraftParent(graftContext);
  const graftPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "info/grafts"], { cwd: graftContext }).trim();
  mkdirSync(dirname(graftPath), { recursive: true });
  const graftSource = `${graftRevision} ${parentRevision}\n`;
  writeFileSync(graftPath, graftSource);
  assertFixtureStatus(graftContext, [], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:graft");
  if (readFileSync(graftPath, "utf8") !== graftSource) throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:graft");
  assert.throws(() => assertImmutableGitProvenance(graftContext), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  expectDockerBuildFailure({
    label: "graft",
    context: graftContext,
    reasonCode: "MUTABLE_GIT_METADATA",
    verifyControls: false,
  });

  const alternatesContext = createNegativeFixture("alternates");
  const externalObjectsPath = gitCommand(["rev-parse", "--path-format=absolute", "--git-path", "objects/info/alternates"], { cwd: alternatesContext }).trim();
  mkdirSync(dirname(externalObjectsPath), { recursive: true });
  const externalObjectsSource = "/external/object-store\n";
  writeFileSync(externalObjectsPath, externalObjectsSource);
  assertFixtureStatus(alternatesContext, [], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:alternates");
  if (readFileSync(externalObjectsPath, "utf8") !== externalObjectsSource) {
    throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:alternates");
  }
  assert.throws(() => assertImmutableGitProvenance(alternatesContext), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  expectDockerBuildFailure({
    label: "alternates",
    context: alternatesContext,
    reasonCode: "MUTABLE_GIT_METADATA",
    verifyControls: false,
  });

  const promisorContext = createNegativeFixture("promisor");
  gitCommand(["config", "remote.origin.promisor", "true"], { cwd: promisorContext });
  assertFixtureStatus(promisorContext, [], "PLANE_SYNC_FIXTURE_MUTATION_INVALID:promisor");
  if (optionalGitConfig(promisorContext, "^remote\\.origin\\.promisor$") !== "remote.origin.promisor true") {
    throw new Error("PLANE_SYNC_FIXTURE_MUTATION_INVALID:promisor");
  }
  assert.throws(() => assertImmutableGitProvenance(promisorContext), /PLANE_SYNC_MUTABLE_GIT_METADATA/);
  expectDockerBuildFailure({
    label: "promisor",
    context: promisorContext,
    reasonCode: "MUTABLE_GIT_METADATA",
    verifyControls: false,
  });
}

function javaScriptFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(path, entry.name);
    return entry.isDirectory() ? javaScriptFiles(entryPath) : entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

function runtimeSpecifiers(source) {
  const file = ts.createSourceFile("runtime.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const specifiers = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier), "static import/export specifier must be a quoted literal");
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        assert.equal(node.arguments.length, 1, "dynamic import/require must have exactly one argument");
        assert.ok(ts.isStringLiteral(node.arguments[0]), "dynamic import/require argument must be one static single- or double-quoted literal");
        specifiers.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return specifiers;
}

function assertRuntimeImports(path) {
  const external = javaScriptFiles(path).flatMap((file) => runtimeSpecifiers(readFileSync(file, "utf8")))
    .filter((specifier) => !specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../"));
  assert.deepEqual(external, [], `plane-sync runtime must not import external packages: ${external.join(", ")}`);
}

function inspectImage() {
  const [image] = JSON.parse(command("docker", ["image", "inspect", imageTag]));
  assert.equal(image.Id, ownedImageId);
  assert.equal(image.Config.User, "plane-sync");
  assert.equal(image.Config.WorkingDir, "/app");
  assert.deepEqual(Object.keys(image.Config.ExposedPorts ?? {}).sort(), ["8787/tcp"]);
  assert.ok(image.Config.Healthcheck?.Test?.some((part) => part.includes("127.0.0.1:8787/health")), "image healthcheck must probe /health on port 8787");
  assertNoSecretMaterial(image.Config.Env ?? [], "image environment");
  assertNoCanaries(JSON.stringify(image.Config.Env ?? []), "image environment");
  const history = command("docker", ["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", imageTag]);
  assertNoSecretMaterial(history.split("\n"), "image history");
  assertNoCanaries(history, "image history");

  assert.equal(dockerResourceId("container", containerName), undefined, "delivery-contract container name must be absent before ownership begins");
  ownedContainerId = command("docker", [
    "container", "create", "--name", containerName, "--entrypoint", "node", imageTag,
    "-e",
    "import { readFileSync } from 'node:fs'; const os = /^ID=(.+)$/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1]; process.stdout.write(JSON.stringify({ uid: process.getuid(), cwd: process.cwd(), revision: readFileSync('/app/.release-revision', 'utf8'), node: process.version, os }));",
  ]).trim();
  assert.equal(dockerResourceId("container", containerName), ownedContainerId);

  const runtimeTar = join(temporaryDirectory, "runtime.tar");
  command("docker", ["container", "export", "--output", runtimeTar, containerName]);
  assertNoCanaries(readFileSync(runtimeTar), "exported runtime filesystem");

  const copiedDist = join(temporaryDirectory, "runtime-dist");
  command("docker", ["container", "cp", `${containerName}:/app/dist`, copiedDist]);
  assertRuntimeImports(copiedDist);
  for (const file of javaScriptFiles(copiedDist)) assertNoCanaries(readFileSync(file), `runtime artifact ${basename(file)}`);

  const runtime = JSON.parse(command("docker", ["container", "start", "--attach", containerName]));
  assert.deepEqual(runtime, {
    uid: 10001,
    cwd: "/app",
    revision: releaseRevision + "\n",
    node: "v24.18.0",
    os: "alpine",
  });
}

function assertRenderedCompose(compose) {
  const service = compose.services?.["plane-sync"];
  assert.ok(service, "compose must render a plane-sync service");
  assert.equal(service.env_file, undefined, "compose must not depend on a materialized runtime env file");
  assert.deepEqual(service.volumes?.map((volume) => volume.target), ["/data"]);
  assert.equal(service.restart, "unless-stopped");
  assert.equal(service.container_name, undefined, "compose must not set a fixed container name");
  assert.equal(service.ports, undefined, "compose must not publish a fixed host port");
  assert.equal(/(^|\n)\s*(container_name|networks)\s*:/m.test(readFileSync(composeFile, "utf8")), false, "compose must not set fixed container or network names");
}

function assertComposeEnvironmentContract() {
  const source = readFileSync(composeFile, "utf8");
  for (const variable of [
    "GITHUB_REPOSITORY",
    "SYNC_WRITE_MODE",
    "GITHUB_APP_ID",
    "GITHUB_APP_INSTALLATION_ID",
    "GITHUB_APP_PRIVATE_KEY_B64",
    "GITHUB_WEBHOOK_SECRET",
    "PLANE_BASE_URL",
    "PLANE_API_TOKEN",
    "PLANE_WORKSPACE",
    "PLANE_PROJECT_ID",
  ]) {
    assert.match(
      source,
      new RegExp(`^\\s+${variable}: \\$\\{${variable}:\\?${variable} must be set\\}$`, "m"),
      `${variable} must use fail-closed Compose interpolation`,
    );
  }
  assert.doesNotMatch(source, /(^|\n)\s*env_file\s*:/m, "compose must not declare env_file");
  assert.doesNotMatch(source, /PLANE_SYNC_RUNTIME_ENV_FILE/, "compose must not expose the removed runtime env-file override");
}

function assertDokployComposeBuildContextContract() {
  const ignored = dockerignorePatterns(readFileSync(join(repository, ".dockerignore"), "utf8"));
  for (const path of [dokployMutatedComposePath, dokployMaterializedEnvironmentPath]) {
    assert.equal(
      ignored.some((pattern) => pattern.test(path)),
      true,
      `Dokploy controller file must be excluded from the Docker build context: ${path}`,
    );
  }
  assert.equal(
    ignored.some((pattern) => pattern.test("docs/runbooks/github-plane-sync.env.example")),
    false,
    "tracked .env.example documentation must remain in the verified Docker context",
  );
}

function replaceDokployInterpolation(source, variable, value) {
  const interpolation = new RegExp(`^(\\s+${variable}: )\\$\\{${variable}:\\?${variable} must be set\\}$`, "m");
  assert.match(source, interpolation, `${variable} must begin as required Compose interpolation`);
  return source.replace(interpolation, `$1${value}`);
}

function createDokployPreprocessedComposeFixture() {
  const context = createNegativeFixture("dokploy-compose-preprocess");
  const path = join(context, dokployMutatedComposePath);
  let source = readFileSync(path, "utf8");
  source = replaceDokployInterpolation(source, "GITHUB_APP_PRIVATE_KEY_B64", canaries[0]);
  source = replaceDokployInterpolation(source, "GITHUB_WEBHOOK_SECRET", canaries[1]);
  source = replaceDokployInterpolation(source, "PLANE_API_TOKEN", canaries[0]);
  writeFileSync(path, source);
  writeFileSync(
    join(context, dokployMaterializedEnvironmentPath),
    [
      `GITHUB_WEBHOOK_SECRET=${canaries[0]}`,
      `PLANE_API_TOKEN=${canaries[1]}`,
    ].join("\n") + "\n",
  );
  assertFixtureStatus(
    context,
    [` M ${dokployMutatedComposePath}`],
    "PLANE_SYNC_FIXTURE_MUTATION_INVALID:dokploy-controller-preprocess",
  );
  return context;
}

function assertDockerContextExcludesDokployControllerFiles(context) {
  for (const [path, destination] of [
    [dokployMutatedComposePath, "/compose.yml"],
    [dokployMaterializedEnvironmentPath, "/runtime.env"],
  ]) {
    const probeDockerfile = join(
      temporaryDirectory,
      `Dockerfile.dokploy-controller-${basename(path).replace(/[^a-z0-9]+/gi, "-")}-probe`,
    );
    writeFileSync(probeDockerfile, `FROM scratch\nCOPY ${path} ${destination}\n`);
    let unexpectedlySucceeded = false;
    let failureOutput = "";
    try {
      command("docker", [
        "build",
        "--progress=plain",
        "--file", probeDockerfile,
        context,
      ]);
      unexpectedlySucceeded = true;
    } catch (error) {
      failureOutput = capturedProcessOutput(error);
    }
    assert.equal(unexpectedlySucceeded, false, `Dokploy controller file must be unavailable to Docker COPY: ${path}`);
    assertNoCanaries(failureOutput, `Dokploy controller-file exclusion probe output: ${path}`);
    assert.match(failureOutput, new RegExp(path.replace(/[.]/g, "\\.")), `Docker COPY probe must reject ${path}`);
  }
}

function assertImageHasNoCanaries(tag, label) {
  const [image] = JSON.parse(command("docker", ["image", "inspect", tag]));
  assertNoCanaries(JSON.stringify(image.Config), `${label} image config`);
  const history = command("docker", ["image", "history", "--no-trunc", "--format", "{{.CreatedBy}}", tag]);
  assertNoCanaries(history, `${label} image history`);
  const archive = join(temporaryDirectory, `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.tar`);
  command("docker", ["image", "save", "--output", archive, tag]);
  assertNoCanaries(readFileSync(archive), `${label} image archive`);
  rmSync(archive, { force: true });
}

function verifyDokployComposePreprocessFixture() {
  const context = createDokployPreprocessedComposeFixture();
  assertDockerContextExcludesDokployControllerFiles(context);

  const tag = `label-suite-plane-sync-delivery-dokploy-compose:${resourceSuffix}`;
  assert.equal(dockerResourceId("image", tag), undefined, "Dokploy-compose fixture image tag must be absent before ownership begins");
  let ownedId;
  try {
    runDockerBuild(context, tag);
    ownedId = dockerResourceId("image", tag);
    assert.ok(ownedId, "Dokploy-mutated Compose fixture must build successfully");
    assertImageHasNoCanaries(tag, "Dokploy-mutated Compose fixture");
  } finally {
    const currentId = dockerResourceId("image", tag);
    if (shouldRemoveOwnedResource(currentId, ownedId)) {
      try { command("docker", ["image", "rm", tag]); } catch { /* Preserve the original verification failure. */ }
    }
  }
}

function renderComposeEnvironment(environmentSource) {
  writeFileSync(join(buildContext, ".env"), environmentSource);
  const rendered = JSON.parse(command("docker", [
    "compose", "--env-file", join(buildContext, ".env"),
    "-f", join(buildContext, "ops/plane-sync/compose.yml"), "config", "--format", "json",
  ], { cwd: buildContext }));
  assertRenderedCompose(rendered);
  return rendered;
}

function renderCompose() {
  const canaryEnvironment = [
    "GITHUB_REPOSITORY=label-suite-org/label-suite_neon_r2",
    "GITHUB_APP_ID=123456",
    "GITHUB_APP_INSTALLATION_ID=123456",
    "GITHUB_APP_PRIVATE_KEY_B64=AA==",
    `GITHUB_WEBHOOK_SECRET=${canaries[0]}`,
    "PLANE_BASE_URL=https://plane.example.test",
    `PLANE_API_TOKEN=${canaries[1]}`,
    "PLANE_WORKSPACE=workspace",
    "PLANE_PROJECT_ID=00000000-0000-4000-8000-000000000000",
    "SYNC_WRITE_MODE=dry-run",
  ].join("\n");
  const defaultCompose = renderComposeEnvironment(canaryEnvironment);
  assert.equal(defaultCompose.services["plane-sync"].environment.GITHUB_WEBHOOK_SECRET, canaries[0]);
  assert.equal(defaultCompose.services["plane-sync"].environment.PLANE_API_TOKEN, canaries[1]);

  const documentedCompose = renderComposeEnvironment(readFileSync(documentedEnvironmentFile, "utf8"));
  assertRenderedCompose(documentedCompose);
}

const exactPlaneCommands = [
  "npm run deps:ci",
  "npm run plane-sync:test",
  "npm run plane-sync:build",
  "npm run plane-sync:delivery-contract",
];

function assertExactKeys(value, keys, label) {
  assert.deepEqual(Object.keys(value ?? {}).sort(), [...keys].sort(), `${label} keys must be exact`);
}

function validateWorkflow(workflow, source) {
  assertExactKeys(workflow, ["name", "on", "permissions", "concurrency", "jobs"], "workflow");
  assert.equal(workflow.name, "Verify");
  assert.deepEqual(workflow.permissions, { contents: "read" }, "workflow permissions must be exactly contents: read");
  assert.deepEqual(workflow.concurrency, {
    group: "verify-${{ github.event.pull_request.number || github.ref }}",
    "cancel-in-progress": true,
  });
  assert.doesNotMatch(source, /\$\{\{\s*secrets(?:\.|\[)/i, "workflow must not reference GitHub secrets anywhere");

  const job = workflow.jobs?.["plane-sync"];
  assert.ok(job, "workflow must contain the plane-sync verification job");
  assertExactKeys(job, ["runs-on", "timeout-minutes", "steps"], "plane-sync job");
  assert.equal(job["runs-on"], "ubuntu-24.04", "plane-sync must use the exact hosted runner");
  assert.equal(job["timeout-minutes"], 30, "plane-sync timeout must remain bounded at 30 minutes");
  assert.equal(/(?:deploy|dokploy|production)/i.test(JSON.stringify(job)), false, "plane-sync workflow must have no deployment authority");
  assert.equal(job.steps?.length, 3, "plane-sync must contain only checkout, setup-node, and verification steps");

  const [checkout, setup, verification] = job.steps;
  assertExactKeys(checkout, ["uses", "with"], "checkout step");
  assert.equal(checkout.uses, "actions/checkout@v7");
  assert.deepEqual(checkout.with, { "persist-credentials": false }, "checkout inputs must be exact");
  assertExactKeys(setup, ["uses", "with"], "setup-node step");
  assert.equal(setup.uses, "actions/setup-node@v7");
  assert.deepEqual(setup.with, { "node-version": 24, cache: "npm" }, "setup-node inputs must be exact");
  assertExactKeys(verification, ["name", "run"], "verification step");
  assert.equal(verification.name, "Verify the Plane sync delivery contract");
  const commands = String(verification.run ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(commands, exactPlaneCommands, "plane-sync commands must be exact and ordered");
}

function inspectWorkflow() {
  const source = readFileSync(workflowFile, "utf8");
  const workflow = parse(source);
  validateWorkflow(workflow, source);

  for (const mutation of [
    (candidate) => { candidate.jobs["plane-sync"]["runs-on"] = "self-hosted"; },
    (candidate) => { candidate.defaults = { run: { shell: "bash" } }; },
    (candidate) => { candidate.jobs["plane-sync"].defaults = { run: { shell: "bash" } }; },
    (candidate) => { candidate.jobs["plane-sync"].container = "node:24"; },
    (candidate) => { candidate.jobs["plane-sync"].services = { database: { image: "postgres:17" } }; },
    (candidate) => { candidate.jobs["plane-sync"].strategy = { matrix: { node: [24] } }; },
    (candidate) => { candidate.jobs["plane-sync"].needs = "verify"; },
    (candidate) => { candidate.jobs["plane-sync"].if = "always()"; },
    (candidate) => { candidate.env = { LEAK: "value" }; },
    (candidate) => { candidate.jobs["plane-sync"].env = { LEAK: "value" }; },
    (candidate) => { candidate.jobs["plane-sync"].environment = "production"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2].env = { LEAK: "value" }; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2].shell = "bash"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2]["working-directory"] = "ops/plane-sync"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2].if = "always()"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2]["continue-on-error"] = true; },
    (candidate) => { candidate.jobs["plane-sync"].steps[2].run += "\nnpm run deploy"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[0].with["persist-credentials"] = true; },
    (candidate) => { candidate.jobs["plane-sync"].steps[0].with.repository = "other/repository"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[0].with.ref = "other-ref"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[0].with.token = "value"; },
    (candidate) => { candidate.jobs["plane-sync"].steps[0].with.path = "other-path"; },
    (candidate) => { candidate.jobs["plane-sync"].steps.push({ run: "true" }); },
    (candidate) => { candidate.permissions = { contents: "write" }; },
  ]) {
    const candidate = structuredClone(workflow);
    mutation(candidate);
    assert.throws(() => validateWorkflow(candidate, source));
  }
  assert.throws(() => validateWorkflow(workflow, `${source}\n# \${{ secrets.PLANE_TOKEN }}`));
}

function selfTestGuards() {
  assert.equal(shouldRemoveOwnedResource("same", "same"), true);
  assert.equal(shouldRemoveOwnedResource("different", "owned"), false);
  assert.equal(shouldRemoveOwnedResource(undefined, "owned"), false);
  assert.equal(shouldRemoveOwnedResource("existing", undefined), false);

  const dockerignoreSource = readFileSync(join(repository, ".dockerignore"), "utf8");
  assert.equal(
    effectiveUntrackedContextCount(["?? ops/plane-sync/src/untracked-checkout.ts"], dockerignoreSource),
    1,
  );
  assert.equal(
    effectiveUntrackedContextCount([
      "!! .superpowers/sdd/ignored-report.md",
      "!! ops/plane-sync/dist/ignored-artifact.js",
      "!! .env",
    ], dockerignoreSource),
    0,
  );
  selfTestInvokingCheckoutGuard();
  selfTestSyntheticGraftParent();
  selfTestDeliveryDiagnosticParser();

  assert.deepEqual(
    runtimeSpecifiers("import 'node:fs'; import value from './value.js'; export { x } from '../x.js'; const y = require(\"node:path\"); const z = import('./z.js');"),
    ["node:fs", "./value.js", "../x.js", "node:path", "./z.js"],
  );
  for (const source of [
    "import external from 'bad-package';",
    "const external = require(\"bad-package\");",
    "const external = import('bad-package');",
    "export { external } from \"bad-package\";",
  ]) {
    assert.deepEqual(runtimeSpecifiers(source), ["bad-package"]);
  }
  for (const source of [
    "const external = import(specifier);",
    "const external = import(`./${name}.js`);",
    "const external = import('./' + name);",
    "const external = require(specifier);",
    "const external = require /* comment */ (specifier);",
    "const external = require(`./${name}.js`);",
    "const external = require('./' + name);",
    "const external = import(",
  ]) {
    assert.throws(() => runtimeSpecifiers(source), /(?:static single- or double-quoted literal|exactly one argument)/);
  }
}

function buildImage() {
  assert.equal(dockerResourceId("image", imageTag), undefined, "delivery-contract image tag must be absent before ownership begins");
  runDockerBuild(buildContext, imageTag);
  ownedImageId = dockerResourceId("image", imageTag);
  assert.ok(ownedImageId, "successful build must resolve to an owned image ID");
}

try {
  requiredFile(dockerfile);
  requiredFile(composeFile);
  requiredFile(workflowFile);
  requiredFile(documentedEnvironmentFile);
  selfTestGuards();
  inspectRevisionAuthority();
  inspectWorkflow();
  assertComposeEnvironmentContract();
  assertDokployComposeBuildContextContract();
  requireDocker();
  prepareBuildContext();
  assertContextControlFilesMatchHead(buildContext);
  selfTestNegativeFixtureCopy();
  verifyRevisionRejections();
  verifyDokployComposePreprocessFixture();
  injectPositiveCanaries();
  buildImage();
  inspectImage();
  renderCompose();
  process.stdout.write("Plane sync delivery contract verified.\n");
} finally {
  const currentContainerId = dockerResourceId("container", containerName);
  if (shouldRemoveOwnedResource(currentContainerId, ownedContainerId)) {
    try { command("docker", ["container", "rm", "--force", "--volumes", containerName]); } catch { /* Preserve the original verification failure. */ }
  }
  const currentImageId = dockerResourceId("image", imageTag);
  if (shouldRemoveOwnedResource(currentImageId, ownedImageId)) {
    try { command("docker", ["image", "rm", imageTag]); } catch { /* Preserve the original verification failure. */ }
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
