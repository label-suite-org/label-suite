#!/usr/bin/env bash
set -euo pipefail

mode="${1:-status}"
expected_repo="label-suite-org/label-suite"

fail() {
  printf 'repository-flow-check: %s\n' "$*" >&2
  exit 1
}

root="$(git rev-parse --show-toplevel 2>/dev/null)" ||
  fail "run this command inside the Label Suite repository"
cd "$root"

origin_url="$(git remote get-url origin 2>/dev/null)" ||
  fail "the origin remote is missing"
case "$origin_url" in
  "https://github.com/$expected_repo"|"https://github.com/$expected_repo.git"|"git@github.com:$expected_repo.git")
    ;;
  *)
    fail "origin points to $origin_url, expected GitHub repository $expected_repo"
    ;;
esac

git fetch --quiet origin main

branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[[ -n "$branch" ]] || fail "detached HEAD is not allowed for feature delivery"

head_sha="$(git rev-parse HEAD)"
main_sha="$(git rev-parse origin/main)"
dirty_count="$(git status --porcelain | wc -l | tr -d ' ')"

printf 'repository=%s\nbranch=%s\nhead=%s\norigin_main=%s\ndirty_paths=%s\n' \
  "$expected_repo" "$branch" "$head_sha" "$main_sha" "$dirty_count"

case "$mode" in
  status)
    exit 0
    ;;
  start)
    [[ "$branch" != "main" ]] ||
      fail "feature work must start on a named branch, never main"
    [[ "$dirty_count" == "0" ]] ||
      fail "start requires a clean worktree; preserve existing work first"
    git merge-base --is-ancestor origin/main HEAD ||
      fail "this branch does not contain current origin/main"
    ;;
  pr)
    [[ "$branch" != "main" ]] ||
      fail "a pull request must come from a feature branch, never main"
    [[ "$dirty_count" == "0" ]] ||
      fail "commit or preserve every tracked and untracked file before review"
    git merge-base --is-ancestor origin/main HEAD ||
      fail "origin/main moved; integrate it and rerun verification"

    upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
    [[ "$upstream" == "origin/$branch" ]] ||
      fail "push the branch to origin and configure its upstream as origin/$branch"
    upstream_sha="$(git rev-parse '@{upstream}')"
    [[ "$head_sha" == "$upstream_sha" ]] ||
      fail "local HEAD is not the pushed upstream SHA"
    ;;
  *)
    fail "usage: $0 [status|start|pr]"
    ;;
esac

printf 'result=ok\n'
