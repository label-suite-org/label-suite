> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Repository hygiene and schema drift

This runbook separates source preservation, schema evidence, CI verification,
deployment, and signed-in verification. `origin/main` is the production code
authority. Forgejo Actions verifies; Dokploy deploys the merged `main` checkout.

## Static gates

Run these from a clean worktree based on the intended `origin/main` revision:

```bash
npm run repo:inventory -- --repository "$PWD" --authority origin/main --markdown docs/audit/repository-and-migration-inventory.md
npm run db:manifest-check
git fetch --no-tags --force origin "cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7:refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7"
test "$(git rev-parse --verify refs/ci/schema-policy-provenance/cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7^{commit})" = cc93da93b67eca34e4c8d7a4c8f5dee35fc67ac7
npm run db:policy-check -- --policy config/schema-drift-policy.json
```

The manifest gate rejects duplicate migration prefixes and orphaned or missing
journal entries. Policy validation is database-free and fails closed for bad
versions, duplicate identities, unsupported kinds/dispositions, stale metadata,
or provenance that cannot be verified from the checkout's tracked files or
reachable Git objects. It must run before any database migration work.

## Disposable expected contract

Use PostgreSQL 17 and a disposable database. Keep the URL in an environment
variable; never put it in a report, commit, or command output:

```bash
export EXPECTED_DATABASE_URL='postgres://...'
DATABASE_URL="$EXPECTED_DATABASE_URL" npm run db:migrate
npm run db:schema-contract -- --database-url-env EXPECTED_DATABASE_URL --output /tmp/label-suite-schema-contract.json
printf '%s\n' '{"version":1,"entries":[]}' > /tmp/label-suite-empty-policy.json
npm run db:drift-check -- --database-url-env EXPECTED_DATABASE_URL --contract /tmp/label-suite-schema-contract.json --policy /tmp/label-suite-empty-policy.json --report /tmp/label-suite-expected-report.json --revision "$(git rev-parse HEAD)"
```

The identical expected contract uses the empty policy only for its self-check;
the committed policy is validated separately above and against approved
production evidence below.

The capture/check transaction is read-only. Catalog output excludes system and
extension-owned objects and the Drizzle ledger implementation table/indexes.
Migration identities use the SHA-256 of canonical SQL; unmatched historical
ledger rows remain explicit `ledger-row-<id>@<hash>` identities.

## CI fixtures

`bash scripts/run-ci-release-gate.sh` performs the same manifest and committed
policy checks, fetches the exact pinned policy provenance object from `origin`,
then migrates disposable PostgreSQL. It preserves the expected-contract
self-check and the original negative fixture. A second fixture marks one known
table difference as `retain` and adds an unclassified table; the policy-aware
check must fail and identify only the unknown drift as unresolved. No production
credentials, production URL, or deployment authority is available to Actions.

## Approved production read-only inspection

Only an approved credentialed runtime boundary may provide the production URL.
Bind every post-deploy evidence input to the exact merged `origin/main` SHA:
create a clean detached worktree at that SHA, regenerate the disposable
expected contract there, and keep the contract, policy, and reports inside one
disposable directory. Never reuse a contract from another checkout or an
arbitrary `/tmp` path:

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
that resolves to a different `HEAD`. Inspect only the sanitized report. It
contains contract revision, exact drift identities, dispositions, and
counts—not connection strings, credentials, row data, SQL definitions, or
arbitrary database errors. Run the production command again after Dokploy's
migration and compare reports (excluding an explicitly documented timestamp,
if one is ever added) before treating the evidence as deterministic.

## Policy dispositions

- `adopt`: a historical difference is now canonical. It is successful only when
  absent from current drift; a present adoption is stale and fails the gate.
- `retain`: an owner-approved historical structure remains. It must be present
  in current drift; a missing entry is stale and fails the gate.
- `remove_later`: classification only for a structure intentionally retained
  pending a separately approved removal. It must be present in current drift;
  this entry never authorizes deletion, DDL, or manual SQL.
- Unknown current drift is unresolved and always fails. Any stale retain or
  remove-later entry fails as well.

## Additive remediation and delivery

1. Record the Forgejo issue, owner, source, rationale, follow-up issue,
   backup/rollback plan, and sanitized evidence. Do not edit production
   manually.
2. Fetch the authority and create a clean worktree; preserve every existing
   dirty checkout:

   ```bash
   git fetch origin main --no-tags
   git worktree add ../label-suite-issue-120-<topic> -b codex/issue-120-<topic> origin/main
   cd ../label-suite-issue-120-<topic>
   ```

3. Add only an additive migration and update the policy/audit with exact
   identities. Re-run the disposable capture, manifest, policy, focused tests,
   and sanitized report checks.
4. Run the repository gate, push the named branch, and open a PR targeting
   `main`:

   ```bash
   bash scripts/repository-flow-check.sh pr
   git push -u origin codex/issue-120-<topic>
   # Open the pull request in Forgejo and wait for its required checks.
   ```

   Forgejo Actions must pass with no production credentials and no deployment
   step.
5. Merge only after review and green Forgejo checks. Dokploy observes the
   Forgejo `main` update and deploys that exact
   `origin/main` checkout. Do not deploy a local branch, preview checkout, or
   mutable runtime SHA.
6. Verify the deployed SHA and separate runtime gates:

   ```bash
   curl -fsS https://suite.truenature.online/api/health
   curl -fsSI https://label-suite.truenature.online/login
   curl -fsSI https://label-suite.truenature.online/login | grep -Fi 'location: https://suite.truenature.online/login'
   ```

   Re-run the policy-aware production read-only check after Dokploy's migration
   and require every `adopt` entry to be absent; unresolved and stale counts
   must be zero.

## Backup, rollback, and signed-in gates

Backup/restore rehearsal, retention, and rollback to a named previously verified
`main` SHA are separate owner-approved gates. A green schema check does not prove
backup recoverability or authorize destructive change. Signed-in browser flows,
including login, dashboard, analytics, artist/release/event operations, and the
release-gate fixture matrix, are also separate evidence. Health alone is not
schema parity proof.

Woodpecker has been removed. Forgejo Actions is verification-only; Dokploy owns
production deployment. Manual production SQL is prohibited, and a `remove_later`
classification is not deletion authority.
