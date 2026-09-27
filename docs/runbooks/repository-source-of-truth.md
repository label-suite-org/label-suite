> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Repository source of truth

This runbook prevents Label Suite work from being stranded in local branches,
agent worktrees, or earlier checkouts while production continues from a
different history.

## Authorities

| Concern | Authority |
| --- | --- |
| Production code | `origin/main` in `label-suite-org/label-suite_neon_r2` |
| Work intake and status | GitHub Issues |
| Review and merge evidence | GitHub pull requests and GitHub Actions verification |
| Production deployment and runtime | Dokploy Docker Compose service, connected through its installed GitHub App |
| Deployed revision | Public `/api/health` `revision` matching the merged `main` SHA |
| Operational application data | Production PostgreSQL |

GitHub Actions verifies pull requests and `main`; it has no production deploy
authority or production secrets. Dokploy tracks merged `main`, serializes its
native Compose deployments, and is the only production runtime/deployment
owner. A local branch is never an authority, even when it contains newer work.

“Latest” means reachable from `origin/main`, approved by GitHub Actions, and
recorded as the deployed SHA—not the newest commit timestamp in a local clone.

## Mandatory delivery sequence

### 1. Start from current `origin/main`

```sh
git fetch origin main
git worktree add -b codex/<issue>-<slug> ../label-suite-<slug> origin/main
cd ../label-suite-<slug>
bash scripts/install-repository-guards.sh
bash scripts/repository-flow-check.sh start
```

Use one coherent branch per issue or independently reviewable change. Do not
start feature work on `main`, in a detached checkout, or in a dirty worktree.

### 2. Preserve provenance while working

- Record the GitHub issue number in the branch or pull request.
- Commit coherent slices with focused verification evidence.
- Preserve dirty work and unique commits; never reset, overwrite, delete, or
  silently combine them.
- Treat migrations, service health, and signed-in browser checks as separate
  gates.

### 3. Prove the branch is ready

Run the focused checks required by the change, then:

```sh
npm run ci
bash scripts/repository-flow-check.sh pr
```

The preflight requires the canonical repository, a named branch other than
`main`, current `origin/main` in the branch ancestry, a clean worktree, a
pushed upstream branch, and local `HEAD` equal to the pushed SHA. If
`origin/main` moved, deliberately integrate it, rerun verification, and push
again.

### 4. Merge through GitHub

Open a pull request into `main` with the issue, acceptance criteria, migrations,
verification evidence, and remaining production-only gates. Do not push to
`main` directly. Retain the feature branch/worktree until exact-SHA production
verification is recorded.

Require GitHub pull requests, the GitHub Actions verification status, resolved
review conversations, and appropriate approval for production-impacting
changes. Branch protection should reject force pushes and bypasses.

### 5. Dokploy deploys the merged SHA

After the pull-request GitHub Actions verification is green and the pull
request merges:

1. Dokploy's installed GitHub App observes the merge push to `main` and
   auto-deploys the merged checkout with auto-deploy enabled.
2. Dokploy serializes its Docker Compose deployment; a local checkout, direct
   main push, or manual server copy cannot substitute for this path.
3. The image build derives and embeds its SHA from the Dokploy checkout. No
   operator configures a mutable runtime revision value.
4. Compose runs migrations, then the worker, then the web service.
5. `/api/health` must report HTTP 200, web/database/worker `ok`, and a revision
   exactly equal to the merged SHA. Record ancillary aggregate degradation
   separately.
6. Run the affected signed-in flow; it is a separate acceptance gate from
   health.

See `docs/runbooks/label-suite-deploy.md` for the initial cutover, rollback,
and evidence procedure.

### 6. Verify and close

Record the merged and deployed SHAs, GitHub Actions run, Dokploy deployment,
migration result, health response, signed-in browser evidence, rollback point,
and explicitly unrun/blocked gates on the pull request or issue. Only then
close the issue and remove the feature worktree.

## Emergency production recovery

Emergency work does not bypass provenance. Open a recovery issue, obtain
explicit owner approval, branch from current `origin/main`, make the smallest
safe change, and use an expedited pull request with GitHub Actions verification.
If production recovery cannot wait, use the known-good Dokploy deployment
history with recorded SHA/operator/reason and reconcile that exact state through
a pull request immediately afterward.
