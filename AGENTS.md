# Label Suite public source candidate

## Repository and production boundary

- This repository is `https://github.com/label-suite-org/label-suite`.
  The `origin` remote must point here.
- Read `PUBLIC_SOURCE.md`. This is a fresh-history verification candidate.
- The owner approved preparing the web release separately from native device
  acceptance. Follow `docs/runbooks/public-web-cutover.md` for promotion gates.
- The existing private GitHub repository `label-suite-org/label-suite_neon_r2`
  still owns production and its outstanding backlog. Do not change Dokploy's
  source or deploy this candidate without a separately verified cutover.
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
Merge only after required checks and review pass. A merge here does not grant
production deployment authority. Report tested, merged, and deployed separately.

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
