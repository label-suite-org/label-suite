#!/usr/bin/env bash
set -euo pipefail

temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/label-suite-ci-release-gate.XXXXXX")"
app_log="$temp_dir/app.log"
worker_log="$temp_dir/worker.log"
contract_file="$temp_dir/schema-contract.json"
empty_policy_file="$temp_dir/empty-policy.json"
policy_fixture_file="$temp_dir/policy-fixture.json"
policy_fixture_output="$temp_dir/policy-fixture.log"
app_pid=""
worker_pid=""
analytics_fixture_created=false
analytics_sandbox_created=false
drift_database_created=false
policy_database_created=false

cleanup() {
  if [[ -n "$worker_pid" ]]; then kill "$worker_pid" >/dev/null 2>&1 || true; fi
  if [[ -n "$app_pid" ]]; then kill "$app_pid" >/dev/null 2>&1 || true; fi
  if [[ "$policy_database_created" == true ]]; then dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists label_suite_policy_fixture >/dev/null 2>&1 || true; fi
  if [[ "$drift_database_created" == true ]]; then dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists label_suite_drift >/dev/null 2>&1 || true; fi
  if [[ "$analytics_sandbox_created" == true ]]; then dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists analytics_sandbox >/dev/null 2>&1 || true; fi
  if [[ "$analytics_fixture_created" == true ]]; then dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists analytics_fixture_ci >/dev/null 2>&1 || true; fi
  rm -rf "$temp_dir"
}
trap cleanup EXIT

for _ in $(seq 1 60); do
  if pg_isready -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
pg_isready -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}"

npm run deps:ci
npm run deploy:check
npm run db:manifest-check

# Fresh public database baseline; private production drift evidence is not exported.
npm run db:policy-check -- --policy config/schema-drift-policy.json
npm run db:migrate

analytics_sandbox_url="postgres://label_suite:label_suite@${PGHOST:-database}:${PGPORT:-5432}/analytics_sandbox"
dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists analytics_sandbox
createdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" analytics_sandbox
analytics_sandbox_created=true
DATABASE_URL="$analytics_sandbox_url" npm run db:migrate
ANALYTICS_SANDBOX_DB_URL="$analytics_sandbox_url" npm run test:analytics-sandbox-fixture

analytics_fixture_url="postgres://label_suite:label_suite@${PGHOST:-database}:${PGPORT:-5432}/analytics_fixture_ci"
dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists analytics_fixture_ci
createdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" analytics_fixture_ci
analytics_fixture_created=true
DATABASE_URL="$analytics_fixture_url" npm run db:migrate
ANALYTICS_FIXTURE_DB_URL="$analytics_fixture_url" npm run test:analytics-ingestion-fixture
ANALYTICS_FIXTURE_DB_URL="$analytics_fixture_url" npm run test:spotify-analytics-import
npm run db:verify-legacy

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS public.ci_partial_expected (
  id integer,
  later_expected_column text
);
COMMIT;
SQL

cat >"$empty_policy_file" <<'JSON'
{
  "version": 1,
  "entries": []
}
JSON
npm run db:schema-contract -- --database-url-env DATABASE_URL --output "$contract_file"
npm run db:drift-check -- --database-url-env DATABASE_URL --contract "$contract_file" --policy "$empty_policy_file"

drift_database=label_suite_drift
drift_url="postgres://label_suite:label_suite@${PGHOST:-database}:${PGPORT:-5432}/$drift_database"
dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists "$drift_database"
createdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" "$drift_database"
drift_database_created=true
DATABASE_URL="$drift_url" npm run db:migrate
psql "$drift_url" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE TABLE IF NOT EXISTS public.ci_partial_expected (id integer);
CREATE TABLE IF NOT EXISTS public.ci_partial_table (id integer);
ALTER TABLE public.ci_partial_table ADD COLUMN ci_unexpected_column text;
CREATE INDEX ci_unexpected_index ON public.ci_partial_table (id);
ALTER TABLE public.ci_partial_table ADD CONSTRAINT ci_unexpected_unique UNIQUE (id);
COMMIT;
SQL
if DATABASE_URL="$drift_url" npm run db:drift-check -- --database-url-env DATABASE_URL --contract "$contract_file" --policy "$empty_policy_file"; then
  echo "Drift checker unexpectedly passed" >&2
  exit 1
fi

policy_database=label_suite_policy_fixture
policy_url="postgres://label_suite:label_suite@${PGHOST:-database}:${PGPORT:-5432}/$policy_database"
dropdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" --if-exists "$policy_database"
createdb -h "${PGHOST:-database}" -U "${PGUSER:-label_suite}" "$policy_database"
policy_database_created=true
DATABASE_URL="$policy_url" npm run db:migrate
psql "$policy_url" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.ci_partial_expected (
  id integer,
  later_expected_column text
);
CREATE TABLE public.ci_known_policy_table (id integer);
SQL
cat >"$policy_fixture_file" <<'JSON'
{
  "version": 1,
  "entries": [
    {
      "kind": "unexpected_table",
      "object": "public.ci_known_policy_table",
      "disposition": "retain",
      "owner": "CI schema-contract fixture",
      "source": "drizzle/0000_jazzy_nitro.sql",
      "rationale": "This disposable fixture proves that a known difference is accepted while an unknown difference fails.",
      "followUpIssue": "https://github.com/label-suite-org/label-suite_neon_r2/issues/120"
    }
  ]
}
JSON
if ! DATABASE_URL="$policy_url" npm run db:drift-check -- \
  --database-url-env DATABASE_URL \
  --contract "$contract_file" \
  --policy "$policy_fixture_file"; then
  echo "Known policy fixture drift was not accepted." >&2
  exit 1
fi
psql "$policy_url" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE public.ci_unknown_policy_table (id integer);
SQL
if DATABASE_URL="$policy_url" npm run db:drift-check -- \
  --database-url-env DATABASE_URL \
  --contract "$contract_file" \
  --policy "$policy_fixture_file" >"$policy_fixture_output" 2>&1; then
  echo "Policy-aware drift checker unexpectedly passed with unknown drift" >&2
  sed -n '1,120p' "$policy_fixture_output" >&2 || true
  exit 1
fi
grep -q "unresolved unexpected_table: public.ci_unknown_policy_table" "$policy_fixture_output"
if grep -Eq "ci_known_policy_table|stale" "$policy_fixture_output"; then
  echo "Known policy fixture drift was not accepted." >&2
  sed -n '1,120p' "$policy_fixture_output" >&2 || true
  exit 1
fi

npx playwright install --with-deps chromium webkit
npm run ci

REQUIRE_WORKER_HEALTH=true node ./dist/server/entry.mjs >"$app_log" 2>&1 &
app_pid=$!
LABEL_SUITE_WORKER_ID=ci-release-gate npx tsx scripts/run-job-worker.ts >"$worker_log" 2>&1 &
worker_pid=$!

for _ in $(seq 1 60); do
  if curl -fsS "${PUBLIC_SITE_URL}/api/health" >/dev/null; then
    break
  fi
  sleep 2
done
if ! curl -fsS "${PUBLIC_SITE_URL}/api/health" >/dev/null; then
  echo "Release-gate runtime did not become healthy." >&2
  sed -n '1,240p' "$app_log" >&2 || true
  sed -n '1,240p' "$worker_log" >&2 || true
  exit 1
fi

export RELEASE_GATE_FIXTURE_MANIFEST="$temp_dir/fixture-manifest.json"
npm run release-gate:seed
E2E_BASE_URL="$PUBLIC_SITE_URL" \
  RELEASE_GATE_REQUIRE_WORKER_HEALTH=true \
  npm run release-gate:ci

E2E_BASE_URL="$PUBLIC_SITE_URL" ARTIST_PORTAL_BROWSER_TEST=1 \
  npx playwright test tests/release-gate/artist-portal.spec.ts

# Correction saves invalidate reviewed campaign snapshots; use a fresh fixture phase.
npm run release-gate:seed
E2E_BASE_URL="$PUBLIC_SITE_URL" \
  npx playwright test tests/release-gate/release-correction.spec.ts
