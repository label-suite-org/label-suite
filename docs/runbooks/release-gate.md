> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Release gate

This runbook covers the verification and delivery gates for Label Suite. The
authority path is `origin/main` → GitHub Actions verification → merged `main` →
Dokploy deployment. GitHub Actions is verification-only: it never contacts
production and has no production credentials or deployment authority.

## Before a PR: schema and repository gates

From a clean worktree based on the intended `origin/main` revision:

```bash
npm run db:manifest-check
git fetch --no-tags --force origin "cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7:refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7"
test "$(git rev-parse --verify refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7^{commit})" = cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7
npm run db:policy-check -- --policy config/schema-drift-policy.json
export EXPECTED_DATABASE_URL='postgres://...'
DATABASE_URL="$EXPECTED_DATABASE_URL" npm run db:migrate
npm run db:schema-contract -- --database-url-env EXPECTED_DATABASE_URL --output /tmp/label-suite-schema-contract.json
printf '%s\n' '{"version":1,"entries":[]}' > /tmp/label-suite-empty-policy.json
npm run db:drift-check -- --database-url-env EXPECTED_DATABASE_URL --contract /tmp/label-suite-schema-contract.json --policy /tmp/label-suite-empty-policy.json --report /tmp/label-suite-schema-report.json --revision "$(git rev-parse HEAD)"
npm test -- scripts/schema-contract.test.ts
npm run check
npm run build
git diff --check
```

The identical expected contract uses the empty policy only for its self-check;
the committed policy is validated separately and against approved production
evidence.

The committed policy uses exact `(kind, object)` matching and fails closed. An
`adopt` entry must be absent after its canonical migration; `retain` and
`remove_later` entries must still be present. Unknown drift and stale policy
fail. `remove_later` is classification only and never authorizes deletion or
manual production SQL.

## CI verification

The workflow provisions disposable PostgreSQL 17 and runs:

```bash
bash scripts/run-ci-release-gate.sh
```

The canonical workflow is `.github/workflows/verify.yml`. It grants only
`contents: read`, uses `persist-credentials: false`, and runs against disposable
PostgreSQL with synthetic fixtures. GitHub Actions must not receive production
runtime secrets or deployment credentials. Dokploy's installed GitHub App owns
the production handoff after a reviewed, verified merge. The retained Forgejo
workflow is historical evidence, not a release gate or fallback delivery path.

The script first runs dependency/deployment-contract checks, the migration
manifest check, verifies pinned provenance commit
`cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7` already exists in the full-history
checkout, records a local ref, and runs policy validation before
`npm run db:migrate`. It then keeps
the expected-contract self-check and the original negative drift fixture, plus a
policy-aware fixture where one known difference is accepted but an unknown
difference must fail. CI has no production URL, credentials, Dokploy token, or
deploy command.

The runtime portion builds the standalone artifact, starts the web process and
worker, checks `/api/health`, and runs:

```bash
npm run release-gate:ci
```

`release-gate:ci` runs preflight and the authenticated Playwright matrix. The
expected revision is the single `${{ github.sha }}` value supplied by CI; the
runtime reads the clean-build `.release-revision` artifact, never runtime Git
state or a mutable `APP_COMMIT_SHA`.

## Authenticated flow matrix

The required flows run at desktop 1440 px, mobile 390 px, and mobile 320 px:

```text
sidebar-collapse-reopen
mobile-primary-and-more-navigation
analytics-artist-release-filter
analytics-workspace-hierarchy
artist-readiness-to-exact-field
release-blocker-to-exact-field
command-k-record-open
campaign-preview-with-zero-unconfirmed-sends
event-open-edit-and-project-context
```

Core surfaces `/dashboard`, `/analytics`, `/artists`, `/releases`, `/campaigns`,
`/events`, and `/settings` run in light and dark themes with screenshots and
sanitized Axe attachments. The same gate fails on React hydration mismatches,
React error `#418`, and the Recharts zero-size warning phrase
`of chart should be greater than 0`; warnings are never suppressed. Campaign
preview must record zero POST requests to
`/api/email/send`; the composer requires a second explicit confirmation before
any send-boundary POST.

Required environment values are supplied by disposable fixture seed data in CI:
`E2E_BASE_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_ARTIST_ID`,
`E2E_RELEASE_ID`, `E2E_TRACK_ID`, `E2E_EVENT_ID`,
`RELEASE_GATE_REQUIRE_WORKER_HEALTH`, and
`RELEASE_GATE_EXPECTED_REVISION`. Missing values or runtime health block the
gate; flows must not be silently skipped.

## Issue, PR, merge, and Dokploy handoff

Keep the acceptance criteria and evidence on the GitHub issue.
From a clean worktree, run the local gates, then use the normal review path:

```bash
bash scripts/repository-flow-check.sh pr
git push -u origin codex/issue-120-<topic>
# Open, review, and merge the pull request in GitHub.
```

Merge only after review and green GitHub checks. Dokploy then observes the
GitHub `main` update and deploys `origin/main`; no local branch, preview
checkout, or mutable runtime SHA is a deployment source.

## Production inspection and deployment gates

After a reviewed PR passes GitHub checks and is merged to `main`, let Dokploy
deploy the GitHub `main` update. Do not deploy from a local branch or preview.
Verify the exact merged SHA, health, canonical host redirect, and signed-in
flows separately:

```bash
git fetch origin main --no-tags
git rev-parse origin/main
curl -fsS https://suite.truenature.online/api/health
curl -fsSI https://label-suite.truenature.online/login
curl -fsSI https://label-suite.truenature.online/login | grep -Fi 'location: https://suite.truenature.online/login'
```

The health `revision` must equal the merged `origin/main` SHA. Bind the
post-deploy evidence to that same SHA by creating a clean detached worktree,
regenerating the expected contract from its disposable database, and keeping
all temporary evidence inside one disposable directory. Do not reuse a
contract from another checkout or an arbitrary `/tmp` path:

```bash
git fetch --no-tags origin main
MERGED_SHA="$(git rev-parse --verify origin/main^{commit})"
SOURCE_REPO="$(git rev-parse --show-toplevel)"
VERIFY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/label-suite-schema-verify.XXXXXX")"
VERIFY_WORKTREE="$VERIFY_ROOT/repository"
cleanup_schema_verify() {
  git -C "$SOURCE_REPO" worktree remove --force "$VERIFY_WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$VERIFY_ROOT"
}
trap cleanup_schema_verify EXIT
git -C "$SOURCE_REPO" worktree add --detach "$VERIFY_WORKTREE" "$MERGED_SHA"
test "$(git -C "$VERIFY_WORKTREE" rev-parse HEAD)" = "$MERGED_SHA"
test -z "$(git -C "$VERIFY_WORKTREE" status --porcelain)"
cd "$VERIFY_WORKTREE"
git fetch --no-tags --force origin "cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7:refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7"
test "$(git rev-parse --verify refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7^{commit})" = cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7
npm run deps:ci

export EXPECTED_DATABASE_URL='postgres://...'
DATABASE_URL="$EXPECTED_DATABASE_URL" npm run db:migrate
EXPECTED_CONTRACT="$VERIFY_ROOT/expected-contract.json"
EXPECTED_POLICY="$VERIFY_ROOT/empty-policy.json"
printf '%s\n' '{"version":1,"entries":[]}' > "$EXPECTED_POLICY"
npm run db:schema-contract -- \
  --database-url-env EXPECTED_DATABASE_URL \
  --output "$EXPECTED_CONTRACT"
npm run db:drift-check -- \
  --database-url-env EXPECTED_DATABASE_URL \
  --contract "$EXPECTED_CONTRACT" \
  --policy "$EXPECTED_POLICY" \
  --report "$VERIFY_ROOT/expected-report.json" \
  --revision "$MERGED_SHA"

# Only an approved credentialed runtime boundary may provide this URL.
export PRODUCTION_READONLY_DATABASE_URL='provided-by-approved-runtime-boundary'
npm run db:drift-check -- \
  --database-url-env PRODUCTION_READONLY_DATABASE_URL \
  --contract "$EXPECTED_CONTRACT" \
  --policy "$VERIFY_WORKTREE/config/schema-drift-policy.json" \
  --report "$VERIFY_ROOT/production-schema-report.json" \
  --revision "$MERGED_SHA"
```

The clean worktree check makes `HEAD`, the generated contract, the committed
policy, and `--revision` one exact merged revision; the CLI rejects a revision
that resolves to a different `HEAD`. The production comparison uses a
read-only transaction and produces sanitized evidence only. Run it again after
Dokploy's migration; all `adopt` entries must be absent and unknown/stale
counts must be zero. Never run manual production SQL.

## Backup and rollback

Backup/restore rehearsal and rollback are separate explicit gates. Before any
destructive or removal work, record an owner-approved backup, restore proof,
rollback target SHA, and recovery issue. A policy `remove_later` entry alone is
not deletion authority. A green health check, CI run, or schema report does not
prove backup recoverability or signed-in product behavior.
