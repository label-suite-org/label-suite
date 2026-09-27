#!/bin/sh
set -eu

revision_file=${1:?revision artifact path is required}
revision=$(git rev-parse --verify 'HEAD^{commit}')

if ! printf '%s\n' "$revision" | grep -Eq '^[0-9a-f]{40}$'; then
  echo "Git checkout did not resolve to a 40-character lowercase commit SHA" >&2
  exit 1
fi

printf '%s\n' "$revision" > "$revision_file"
