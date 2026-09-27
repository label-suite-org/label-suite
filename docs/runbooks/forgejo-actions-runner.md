> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Retired: Forgejo Actions direct runner

> **Historical reference only — not an operational runbook.** GitHub is the
> canonical repository and GitHub Actions owns verification. Forgejo checks
> cannot satisfy release gates. Follow
> [Repository source of truth](repository-source-of-truth.md) for current
> delivery and deployment instructions.
>
> The configuration and commands below describe the former runner. They do not
> establish its current runtime state or authorize registering, restarting, or
> removing it. Any retirement work requires a separate live inventory and
> preservation of unique data and active jobs.

**Scope:** `malthe/label-suite_neon_r2` only

**Host:** Winona

**Execution:** direct Ubuntu 24.04 host execution

**Service:** `forgejo-runner-label-suite.service`

This runner formerly executed Label Suite verification jobs when Forgejo
was the canonical repository. The owner explicitly accepted direct host
execution. There is no job-container isolation: repository workflow code runs
as the `winona` service user and that user has administrative and Docker access.

## Historical boundaries

- Register the runner at repository scope, never user, organization, or global
  scope.
- Advertise only `label-suite-direct:host` and keep capacity at one job.
- Do not place Dokploy, production database, Google, YouTube, email, or other
  runtime secrets in Forgejo Actions.
- The workflow creates its PostgreSQL fixture as
  `label-suite-forgejo-ci-postgres`, bound only to `127.0.0.1:55432`, and removes
  it with volumes after the job.
- `.github/workflows/verify.yml` was the supplementary GitHub contract.
  `.forgejo/workflows/verify.yml` owned Forgejo execution and accounted for the
  direct runner's lack of workflow `services:` support.

## Historical operations (do not execute as current guidance)

Inspect the runner and recent logs:

```sh
sudo systemctl status forgejo-runner-label-suite.service
sudo journalctl -u forgejo-runner-label-suite.service -n 200 --no-pager
```

Stop or restart it:

```sh
sudo systemctl stop forgejo-runner-label-suite.service
sudo systemctl restart forgejo-runner-label-suite.service
```

The service reads its Forgejo token from the root-owned file
`/etc/forgejo-runner-label-suite/token`. Never print or copy that file into an
issue, pull request, shell transcript, or repository.

## Historical removal procedure (requires a separately reviewed plan)

1. Stop and disable `forgejo-runner-label-suite.service`.
2. Delete the repository-scoped runner in Forgejo under **Settings → Actions →
   Runners**.
3. Remove `/etc/systemd/system/forgejo-runner-label-suite.service`,
   `/etc/forgejo-runner-label-suite`, and `/var/lib/forgejo-runner-label-suite`.
4. Reload systemd and remove any stopped `label-suite-forgejo-ci-postgres`
   fixture container.

Removing this runner stops CI execution. It does not authorize bypassing
required verification checks.
