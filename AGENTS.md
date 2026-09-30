# Label Suite source and delivery

## Repository and production boundary

- This repository is `https://github.com/label-suite-org/label-suite`.
  The `origin` remote must point here.
- Before choosing any checkout or CI workflow, verify `git remote get-url origin`
  and run `bash scripts/repository-flow-check.sh status`. This public repository
  is the sole source of truth for new product changes, pull requests and CI.
  Instructions in old private checkouts can be stale; use this file and
  `PUBLIC_SOURCE.md` to resolve that conflict, and check live Dokploy metadata
  before deployment. Never infer authority from a checkout's directory name.
- Read `PUBLIC_SOURCE.md`. The verified production source moved to this
  repository on 27 September 2026. Only reviewed, verified `origin/main`
  revisions may be deployed through Dokploy.
- Web delivery remains separate from native device acceptance. Follow
  `docs/runbooks/public-web-cutover.md` for deployment and recovery gates.
- The private GitHub repository `label-suite-org/label-suite_neon_r2` retains
  outstanding issues, historical PRs, provenance and recovery evidence.
  Reconcile that backlog without importing private history or closing items
  solely because their implementation was exported. Deliver source changes
  through pull requests in this public repository.
- GitHub is the source of truth. Forgejo references in retained documents are
  historical; do not create, merge, or deploy work there.
- Do not import private Git history, internal research, credentials, production
  database exports, or CI logs. Public Actions receives disposable fixtures only.
- The public empty drift policy applies only to fresh databases. Production
  verification still requires the private approved drift policy and evidence.

## Delivery

The initial root commit bootstraps the owner-authorized clean export.
Subsequent changes use named `codex/` branches and GitHub pull requests.
Preserve unrelated dirty work. Never reset, overwrite, or force-push it.

Before starting work:

```sh
git fetch origin main
bash scripts/install-repository-guards.sh
bash scripts/repository-flow-check.sh start
```

Before a pull request, run relevant focused checks, then `npm run ci` and
`bash scripts/repository-flow-check.sh pr`. Record the exact commands and SHA.
Merge only after required checks and review pass. Dokploy can automatically
deploy `main`; verify deployment authorization and host resource admission
before a merge that triggers deployment. A green check does not override a
resource hold or authorize provider activation. Report tested, merged, and
deployed separately.

## Implementation

Prefer the simplest correct implementation and existing patterns. Inspect the
relevant code and callers first; change the smallest practical surface. Avoid
unrelated refactors, hypothetical abstractions, and new dependencies. Ask before
adding a production dependency. Keep tests proportional to observable behavior.
Preserve validation, tenant authorization, accessibility, and data-loss safeguards.
Never print credentials. Verify the host, user, working directory, and applicable
instructions before environment changes. Preserve a private rollback copy of
live configuration before an authorized change.

## Development

Use `astro dev --background`; manage it with `astro dev status`, `astro dev logs`,
and `astro dev stop`. Do not point local tests at production data.
