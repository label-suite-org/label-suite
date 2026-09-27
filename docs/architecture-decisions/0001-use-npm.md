# ADR 0001: Use npm as the only package manager

**Status:** Accepted  
**Date:** 2026-07-26  
**Tracking:** GitHub issue #42

## Context

The repository tracked both `package-lock.json` and `pnpm-lock.yaml`, plus a
`pnpm-workspace.yaml` that did not define multiple packages. The production
Dockerfiles, GitHub Actions workflow, package scripts, development
documentation, and existing operational workflow already used npm.

Multiple lockfiles can resolve different dependency graphs and make it unclear
which graph was tested or deployed.

## Decision

Label Suite uses npm 10.9.8 as its only package manager.

- `package.json` declares `"packageManager": "npm@10.9.8"`.
- `package-lock.json` is the only tracked dependency lockfile.
- Clean local and CI installs use `npm ci`.
- Dependency changes use npm and update `package-lock.json`.

## Consequences

- `pnpm-lock.yaml` and `pnpm-workspace.yaml` are removed.
- GitHub Actions and Docker continue using npm.
- Contributors need no additional package-manager bootstrap step.
- A future package-manager change requires a separate ADR and an atomic update
  to CI, Docker, documentation, and lockfiles.
