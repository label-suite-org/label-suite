#!/usr/bin/env bash
set -euo pipefail

root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'Run this command inside the Label Suite repository.\n' >&2
  exit 1
}

cd "$root"
git config core.hooksPath .githooks
printf 'Installed Label Suite repository guards for %s\n' "$root"
