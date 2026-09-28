# Public source and production boundary

This is the production source repository `label-suite-org/label-suite`,
exported from private candidate `5ffd1fc2af8b17123681c678a2e9d29fc533f1c7`.
The original export alone did not establish deployment. The separately verified
web cutover completed on 27 September 2026 at public main revision
`f0b1e2c8360b30453eb93a685ff6f0e26dcfedb4`, following
[PR #2](https://github.com/label-suite-org/label-suite/pull/2).
This is a historical checkpoint; verify the current deployed revision for each
subsequent release.

The original private repository retains its history, issues, pull requests,
production evidence, and rollback records. Do not copy those wholesale here.
Dokploy deploys reviewed, verified public `main` through its serialized Compose
lane. The private repository is retained for backlog and recovery, not as the
current production source. Retained Forgejo delivery references are historical;
GitHub alone owns current repository, issue, PR and CI state.

## Export boundary

Excluded: old Git history, environment backups, internal audits/research/reviews,
agent handoffs and local tooling state, screenshots, private campaign research
seeds, grant enrichment data, `docs/plans`, and retired CI workflows.
The grant enrichment tool requires an explicit private `GRANT_ENRICHMENT_DATA`
JSON path. It retains the existing validation and transaction handling.

Migration files remain intact. Email delivery now requires a configured sender
instead of embedding the owner address. Historical tenant and record
identifiers remain in migrations to preserve migration checksums and behavior;
they are not credentials. No production database or uploaded assets are included.
Test credentials refer only to disposable fixtures; the CI auth signing secret is
generated for each run. Public CI must never receive production credentials.

Product specifications (including mobile parity), technical architecture, and
deployment runbooks are retained as historical
reference; hostnames and repository identifiers are not secrets. Historical
lineage tests remain compatibility tests, not authority to import old history.

## Schema verification

`config/schema-drift-policy.json` is an empty policy for freshly migrated databases.
It is NOT a replacement for the private deployment's approved drift policy.
Private historical commit objects are intentionally absent. Public CI checks the
migration manifest, fresh schema, unexpected drift rejection, and known-policy
fixtures without fetching private history. Existing policy-provenance validation
remains unchanged. Any production upgrade still requires its private approved
policy and provenance; do not use this empty baseline to approve that upgrade.

## Acceptance status

The owner approved a web-first rollout on 27 September 2026. Follow the
[public web cutover procedure](docs/runbooks/public-web-cutover.md). Native
physical-device testing and the TestFlight pilot remain open independently;
this sequencing decision does not certify those features or enable providers.

Publication verification and CI results must be checked for the exact public SHA.
A passing public workflow does not automatically satisfy checks on private PRs,
authorize production deployment, or prove physical-device/provider acceptance.
The completed cutover does not by itself authorize changing deployment
integrations, credential rotation, license changes or external-provider activation.
