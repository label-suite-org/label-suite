# syntax=docker/dockerfile:1
# Pinned multi-architecture Node 24 manifest, selected by the approved delivery plan.
FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

WORKDIR /app
ENV GIT_NO_REPLACE_OBJECTS=1

RUN apk add --no-cache git

# The production build context is the clean Dokploy Git checkout. The root
# .dockerignore deliberately retains .git while excluding local/runtime data.
COPY . .

# PLANE_SYNC_REVISION is a reserved rejected input, never a revision source.
ARG PLANE_SYNC_REVISION
RUN test -z "$PLANE_SYNC_REVISION" \
  || (printf '%s%s\n' "PLANE_SYNC_DIAGNOSTIC:" "MUTABLE_REVISION" >&2; exit 1)

# Reject mutable or externally resolved Git metadata before any object read.
RUN node --input-type=module <<'EOF'
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const git = (args) => execFileSync("git", args, {
  encoding: "utf8",
  env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" },
});
const gitPath = (path) => git(["rev-parse", "--path-format=absolute", "--git-path", path]).trim();
const directoryContainsFiles = (path) => existsSync(path) && readdirSync(path, { withFileTypes: true }).some((entry) =>
  entry.isDirectory() ? directoryContainsFiles(join(path, entry.name)) : true,
);
const diagnostic = (code) => {
  process.stderr.write(["PLANE_SYNC_DIAGNOSTIC", code].join(":") + "\n");
  process.exit(1);
};
const optionalGitConfig = (pattern) => {
  try {
    return git(["config", "--local", "--get-regexp", pattern]).trim();
  } catch (error) {
    if (error && typeof error === "object" && error.status === 1) return "";
    diagnostic("MISSING_GIT");
  }
};

try {
  if (directoryContainsFiles(gitPath("refs/replace"))) diagnostic("MUTABLE_GIT_METADATA");
  if (git(["for-each-ref", "--format=%(refname)", "refs/replace"]).trim()) diagnostic("MUTABLE_GIT_METADATA");
  for (const path of [gitPath("info/grafts"), gitPath("objects/info/alternates")]) {
    if (existsSync(path) && statSync(path).size > 0) diagnostic("MUTABLE_GIT_METADATA");
  }
  if (optionalGitConfig("^(extensions\\.partial[Cc]lone|remote\\..*\\.promisor)$")) {
    diagnostic("MUTABLE_GIT_METADATA");
  }
} catch {
  diagnostic("MISSING_GIT");
}
EOF

# This manifest proves every effective-context byte COPY receives is exactly in
# HEAD. `.dockerignore` excludes Dokploy's controller-mutated Compose file
# before Docker transfers the context, so it cannot leak into a build layer.
RUN node --input-type=module <<'EOF'
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join, relative } from "node:path";

const diagnostic = (code) => {
  process.stderr.write(["PLANE_SYNC_DIAGNOSTIC", code].join(":") + "\n");
  process.exit(1);
};

try {
  const tree = execFileSync("git", ["ls-tree", "-rz", "--full-tree", "HEAD"]);
  const expected = new Map();
  const excludedTrackedContextPaths = new Set(["ops/plane-sync/compose.yml"]);
  for (const record of tree.toString("utf8").split("\0").filter(Boolean)) {
    const tab = record.indexOf("\t");
    const [mode, type, object] = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    if (path.startsWith(".superpowers/") || excludedTrackedContextPaths.has(path)) continue;
    if (type !== "blob") diagnostic("CONTEXT_UNSUPPORTED");
    expected.set(path, { mode, object });
  }

  const actual = new Map();
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      const path = relative("/app", absolute);
      if (path === ".git") continue;
      if (entry.isDirectory()) {
        visit(absolute);
        continue;
      }
      const stat = lstatSync(absolute);
      const content = stat.isSymbolicLink() ? Buffer.from(readlinkSync(absolute)) : readFileSync(absolute);
      const mode = stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
      const header = Buffer.from(`blob ${content.length}\0`);
      const object = createHash("sha1").update(header).update(content).digest("hex");
      actual.set(path, { mode, object });
    }
  }
  visit("/app");

  for (const [path, entry] of expected) {
    const received = actual.get(path);
    if (!received) diagnostic("CONTEXT_MISSING");
    if (received.mode !== entry.mode || received.object !== entry.object) diagnostic("CONTEXT_MODIFIED");
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) diagnostic("CONTEXT_EXTRA");
  }
} catch {
  diagnostic("CONTEXT_INVALID");
}
EOF

RUN revision="$(git rev-parse --verify HEAD^{commit} 2>/dev/null)" \
  && test "$(git rev-parse --is-inside-work-tree 2>/dev/null)" = "true" \
  && test "$(printf '%s' "$revision" | wc -c)" -eq 40 \
  && printf '%s\n' "$revision" > .release-revision \
  && chmod 0444 .release-revision \
  && rm -rf .git \
  || (printf '%s%s\n' "PLANE_SYNC_DIAGNOSTIC:" "REVISION_INVALID" >&2; exit 1)

RUN npm ci --ignore-scripts
RUN npm run plane-sync:build
RUN node --input-type=module <<'EOF'
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const diagnostic = (code) => {
  process.stderr.write(["PLANE_SYNC_DIAGNOSTIC", code].join(":") + "\n");
  process.exit(1);
};
const files = (path) => readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? files(join(path, entry.name)) : entry.name.endsWith(".js") ? [join(path, entry.name)] : [],
);
function specifiers(source) {
  const file = ts.createSourceFile("runtime.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const found = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (!ts.isStringLiteral(node.moduleSpecifier)) diagnostic("RUNTIME_IMPORT_INVALID");
      found.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        if (node.arguments.length !== 1 || !ts.isStringLiteral(node.arguments[0])) {
          diagnostic("RUNTIME_IMPORT_INVALID");
        }
        found.push(node.arguments[0].text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
try {
  const imports = files("ops/plane-sync/dist").flatMap((path) => specifiers(readFileSync(path, "utf8")));
  const external = imports.filter((specifier) =>
    !specifier.startsWith("node:") && !specifier.startsWith("./") && !specifier.startsWith("../"),
  );
  if (external.length > 0) diagnostic("RUNTIME_IMPORT_INVALID");
} catch {
  diagnostic("RUNTIME_IMPORT_INVALID");
}
EOF

FROM node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    SERVICE_REVISION_FILE=/app/.release-revision

RUN addgroup -S -g 10001 plane-sync \
  && adduser -S -D -H -u 10001 -G plane-sync plane-sync \
  && mkdir -p /data \
  && chown plane-sync:plane-sync /data \
  && chmod 0750 /data

COPY --from=builder --chown=root:root /app/ops/plane-sync/dist ./dist
COPY --from=builder --chown=root:root /app/ops/plane-sync/config/seed-registry.json ./config/seed-registry.json
COPY --from=builder --chown=root:root /app/.release-revision ./.release-revision

USER plane-sync
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD ["node", "-e", "fetch('http://127.0.0.1:8787/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/index.js"]
