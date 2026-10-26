# Repository source of truth

The canonical production source is [label-suite-org/label-suite](https://github.com/label-suite-org/label-suite). `origin` must point to this public repository. GitHub owns source changes, pull requests and CI. Dokploy owns deployment and runtime.

The private `label-suite-org/label-suite_neon_r2` repository retains historical issues and recovery evidence only. Forgejo is retired; no current workflow creates issues, reviews, merges or deployments there. Obsolete procedures are available in Git history, not as current delivery instructions.

## Delivery

1. Verify host, working directory and `git remote get-url origin`. Preserve any unrelated dirty work.
2. Fetch public `origin/main` and use a clean named `codex/` branch/worktree. Run `bash scripts/install-repository-guards.sh` and `bash scripts/repository-flow-check.sh start`.
3. Make the smallest change and run focused verification, then `npm run ci`. Keep private business records, screenshots, credentials and logs out of this public repository. Use disposable test fixtures.
4. Commit and push the branch, run `bash scripts/repository-flow-check.sh pr`, and open a GitHub PR into public `main`. Record acceptance criteria, exact verification commands and outcomes.
5. Merge only when required checks and review pass, with deployment authorization and host resource admission established. Dokploy's installed GitHub App observes the merge push to `main`; a merge can trigger deployment.
6. Follow [public-web-cutover.md](public-web-cutover.md) for exact-source deployment and recovery verification. Verify the deployed SHA, health, and affected signed-in flows separately. Report tested, merged and deployed states honestly. Retain the worktree until production verification.

[AGENTS.md](../../AGENTS.md) and [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) define the current delivery and privacy boundaries. Native physical-device acceptance and provider activation remain separate gates.
