# Public web release cutover

This procedure governs promotion of `label-suite-org/label-suite` through
Dokploy. It supersedes the retained historical deployment instructions for
this cutover. Production remains on its existing source until verified below.
The private repository retains backlog, historical provenance and recovery
evidence. Never import those records or production secrets into public CI.

## Scope

Deploy the reviewed web application and shared backend. Physical-iPhone
acceptance and the two-week TestFlight pilot remain separate open work.
Native private uploads require separately approved private storage; missing
configuration must continue to fail closed. This rollout does not enable
APNs, telemetry, outreach, payments or other providers. Calendar acceptance
remains explicit; passing mocked reconciliation tests is not live acceptance.

## Before switching source

1. Verify required checks on the exact reviewed public `main` SHA. Record
   the current deployed SHA and preserve private Dokploy source configuration,
   runtime image identities and database recovery evidence.
2. Follow the host's resource admission rules. Do not start heavy work while
   admission is red or bypass a frozen batch workload.
3. Take a fresh production backup and rehearse the candidate migrations on an
   isolated copy with no worker, scheduler or outbound provider activity.
   Verify the upgraded schema against the private approved drift policy and
   its reachable private provenance. The public empty policy is insufficient.
4. Confirm the configured email sender, existing runtime variables, GitHub App
   repository access, Compose path and serialized Dokploy deployment lane.
   Preserve old repository access for recovery.

## Deploy and verify

Switch only the existing Dokploy source to `label-suite-org/label-suite`,
branch `main`, Compose path `compose.prod.yml`. Use Dokploy's native serialized
Compose deployment. Never deploy from a local checkout or import private Git
history into the public repository.

Confirm migrations exit successfully and web and worker run the reviewed SHA.
Require public health HTTP 200 with matching revision and healthy database
and worker. Verify representative signed-in web workflows separately. Record
results and remaining acceptance items in the private release tracker.

Restoring source settings alone does not restore runtime images or data.
Prefer a reviewed forward fix or revert through public `main`; any emergency
Dokploy rollback needs the existing owner authorization and recorded compatible
database/image recovery point. Preserve additive migration data and uploaded
objects. Do not close native acceptance work as part of web deployment.
