#!/usr/bin/env bash
set -euo pipefail

# Acceptance seam: exercise repository-flow-check.sh as an operator-facing CLI.
# Every repository fixture is disposable and fetch is locally stubbed, so the
# checks prove canonical origin and delivery protections without network access.
root="$(git rev-parse --show-toplevel)"
flow="$root/scripts/repository-flow-check.sh"
sandbox="$(mktemp -d)"
fixture="$sandbox/repo"
trap 'rm -rf "$sandbox"' EXIT

mkdir "$fixture"
git -C "$fixture" init -q -b main
git -C "$fixture" config user.email test@example.invalid
git -C "$fixture" config user.name 'Repository Flow Test'
touch "$fixture/.keep"
git -C "$fixture" add .keep
git -C "$fixture" commit -qm base
base_sha="$(git -C "$fixture" rev-parse HEAD)"

git_bin="$(command -v git)"
mkdir "$sandbox/bin"
printf '#!/usr/bin/env bash\nif [[ "$1" == "fetch" ]]; then exit 0; fi\nexec "%s" "$@"\n' "$git_bin" > "$sandbox/bin/git"
chmod +x "$sandbox/bin/git"

run_flow() {
  (cd "$fixture" && PATH="$sandbox/bin:$PATH" "$flow" "$1")
}

expect_failure() {
  if run_flow "$1" >/dev/null 2>&1; then
    echo "repository-flow-check.test: $2 unexpectedly accepted" >&2
    exit 1
  fi
}

set_canonical_origin() {
  git -C "$fixture" remote remove origin 2>/dev/null || true
  git -C "$fixture" remote add origin "$1"
  git -C "$fixture" update-ref refs/remotes/origin/main HEAD
}

canonical_origins=(
  'https://github.com/label-suite-org/label-suite'
  'https://github.com/label-suite-org/label-suite.git'
  'git@github.com:label-suite-org/label-suite.git'
)

for remote in "${canonical_origins[@]}"; do
  set_canonical_origin "$remote"
  run_flow status >/dev/null
done

git -C "$fixture" remote set-url origin https://example.invalid/label-suite_neon_r2.git
expect_failure status 'non-canonical remote'
set_canonical_origin "${canonical_origins[0]}"

expect_failure start 'main branch'
expect_failure pr 'main branch'
git -C "$fixture" checkout -qb feature
run_flow start >/dev/null

touch "$fixture/dirty"
expect_failure start 'dirty worktree'
expect_failure pr 'dirty worktree'
rm "$fixture/dirty"

git -C "$fixture" checkout -q main
touch "$fixture/upstream-main"
git -C "$fixture" add upstream-main
git -C "$fixture" commit -qm 'advance main'
git -C "$fixture" update-ref refs/remotes/origin/main HEAD
git -C "$fixture" checkout -q feature
expect_failure start 'branch missing current origin/main'

git -C "$fixture" checkout -q main
git -C "$fixture" checkout -qB feature origin/main
run_flow start >/dev/null
expect_failure pr 'missing upstream'

git -C "$fixture" branch --set-upstream-to=origin/main feature
expect_failure pr 'wrong upstream'

git -C "$fixture" update-ref refs/remotes/origin/feature "$base_sha"
git -C "$fixture" branch --set-upstream-to=origin/feature feature
expect_failure pr 'unpublished feature commit'

git -C "$fixture" update-ref refs/remotes/origin/feature HEAD
run_flow pr >/dev/null

echo 'repository-flow-check.test: canonical GitHub variants and delivery protections verified offline'
