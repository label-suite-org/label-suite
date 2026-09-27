> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Dokploy GitHub webhook ingress

## Ownership and boundary

`ops/dokploy-webhook-ingress/Caddyfile` is the canonical source for the Label
Suite-owned site block in Winona's shared Caddy configuration. The runtime copy
is `/opt/music-stack/caddy/Caddyfile`, mounted read-only into the `caddy`
container at `/etc/caddy/Caddyfile`. The repository fragment contains no
credential material; GitHub App credentials remain inside GitHub and Dokploy.

The only public request forwarded to Dokploy is exact
`POST /api/deploy/github`. Every other method and path returns `404`. An
unsigned request to the accepted path reaches Dokploy's signature verifier and
returns `401`; it cannot create a deployment. Run the repeatable, non-mutating
probe with:

```sh
npm run deploy:ingress-probe
```

GitHub Actions is verification-only. Dokploy's installed GitHub App connection
tracks `label-suite-org/label-suite_neon_r2` on `main`, with auto-deploy and push
triggers enabled. Dokploy remains the sole production deployment owner.

## Reviewed reconciliation procedure

Change the ingress only after a pull request updating the canonical fragment
has merged and its GitHub Actions verification is green.

1. Compare the merged fragment with the single
   `label-suite-deploy.truenature.online` block in the runtime Caddyfile. Stop
   if the shared file contains another block for the same host.
2. Save a timestamped rollback copy beside the runtime file before editing it.
   Do not copy the rest of the shared Caddyfile into this repository.
3. Replace only that host block with the merged fragment, then validate the
   complete live configuration:

   ```sh
   docker exec caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
   ```

4. Reload without recreating the container:

   ```sh
   docker exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
   npm run deploy:ingress-probe
   ```

5. Record the merged SHA, rollback filename, validation result, reload result,
probe output, and one automatic Dokploy deployment caused by a signed GitHub
delivery. Never perform a local-checkout deployment as a substitute.

If validation, reload, or the probe fails, restore the timestamped runtime
backup, repeat `caddy validate`, run `caddy reload`, and rerun the probe. Keep
the failed candidate and command output as issue evidence.

## Current reconciliation evidence

On 2026-08-12 CEST, the live host block matched the canonical fragment and the
public probe returned:

- `GET /api/deploy/github` -> `404`
- unsigned `POST /api/deploy/github` -> `401`
- `GET /github` and `POST /github` -> `404`
- `GET /` -> `404`

The complete live Caddyfile validated successfully before and after a
no-content-change reload. The reload completed successfully; the validator
reported only pre-existing formatting and redundant forwarded-header warnings.
The post-reload probe returned the same five results, and Label Suite health
remained available at the exact deployed revision.

The pre-change rollback file retained on Winona is
`/opt/music-stack/caddy/Caddyfile.before-dokploy-webhook-20260801T1335Z`.
GitHub App redelivery `3834528430462861312` previously returned `200` through
this exact ingress. Fresh automatic delivery evidence for merge SHA
`ee1ea402f6edbb049f48908d6cedc11a03c26017` is Dokploy deployment
`4NOlIsNS8QXZ2_9Hs3-An`, created seconds after the merge and completed at the
same SHA without a local deployment.

## Retired surface inventory

The following artifacts remain installed only as inactive recovery/audit
evidence. They are not deployment owners:

| Artifact | Current state |
| --- | --- |
| `label-suite-deploy-hook.service` | static, inactive |
| `label-suite-deploy.service` | disabled, inactive |
| `label-suite-deploy.timer` | disabled, inactive |
| GitHub repository webhook `657264907` (`workflow_run` to retired `/github`) | inactive |

Removal is destructive and requires a separate explicit owner approval. Until
then, keep all four inactive and verify periodically that the legacy route
still returns `404`. Do not re-enable the units, timer, repository webhook, or
any repository-driven deployment workflow.
