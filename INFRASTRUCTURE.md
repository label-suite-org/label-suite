> Retained technical/historical reference. Current public candidate and production
> boundaries are defined in `PUBLIC_SOURCE.md`; this document does not authorize deployment.

# Infrastructure and caching

The provider and data-flow registry is maintained in
[`docs/integration-inventory.md`](./docs/integration-inventory.md).

## Runtime topology

Production runs the Astro Node standalone build as a Dokploy Docker Compose
service. Dokploy owns the Compose lifecycle and Traefik routes
`suite.truenature.online` to container port 4321.

Application pages are server-rendered because they depend on the signed-in
user, active workspace, permissions, and current Postgres data. The public
landing page is prerendered. Astro's fingerprinted client assets are immutable
and should retain a one-year CDN TTL.

Authenticated HTML, API, and auth responses explicitly use:

```text
Cache-Control: private, no-store
Vary: Cookie
```

Do not add shared CDN or full-page caching to authenticated routes. If an
expensive dashboard query needs caching, cache the org-scoped data result or a
precomputed aggregate and include the workspace in the cache key.

## R2 storage

R2 is the object store for artwork, audio, documents, media assets, and raw
analytics snapshots. Keys are prefixed with the workspace ID. Browser uploads
request a short-lived presigned PUT URL and upload directly to R2. The existing
server-mediated upload remains as a compatibility fallback if a browser or
bucket policy blocks a direct upload.

JPEG, PNG, WebP, and AVIF uploads are converted once into private 96px, 320px,
and 800px WebP variants. List and workspace views request the smallest suitable
variant and fall back to the original when a legacy variant is unavailable.
Signed URL requests from a render are batched into a single authenticated API
call and reused in memory/session storage until shortly before expiry.

Existing images can be inspected and backfilled with:

```sh
npm run images:optimize
npm run images:optimize -- --apply
```

The `label-suite` bucket CORS policy was applied on 2026-07-10 for production
and local direct uploads. Keep the configured policy equivalent to:

```json
[
  {
    "AllowedOrigins": [
      "https://label-suite.truenature.online",
      "http://localhost:4321"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Keep contracts, royalty statements, private audio, and internal documents in
the private delivery path using permission-checked signed download URLs.

For explicitly public artwork and artist images, connect a dedicated R2 custom
domain, set `R2_PUBLIC_BASE_URL` to that origin, and use versioned object keys.
Do not expose a bucket or prefix containing private objects. Configure
Cloudflare caching for public asset types and enable Smart Tiered Cache after
the custom domain is active.

## Cache and Redis policy

Redis is not part of the current stack. Do not introduce it preemptively. Use
Postgres indexes and precomputed analytics first, then measure route and query
latency. Redis becomes useful when multiple Node replicas need shared cache
invalidation, distributed rate limits, pub/sub, or a Redis-backed job queue.

The PostgreSQL-backed durable job runner now handles validation sweeps with
leases, heartbeats, retries, and idempotency. Sisense synchronization still runs
as a separate scheduled process. Move recurring provider work into typed job
handlers incrementally; do not introduce Redis unless measured contention or
multi-replica coordination requires it.

## Deployment

GitHub Actions runs the verification contract, tests, schema checks, Astro
checks, production build, and authenticated release gate for pull requests and
`main`. It does not receive production secrets or deploy production. Once a
verified pull request merges, Dokploy's installed GitHub App tracks `main` and
auto-deploys the exact checkout through its serialized Compose lane. The image
embeds that checkout SHA; Compose applies migrations before starting worker and
web services. Verify public health reports the exact merged revision, then run
the separate signed-in acceptance flow. See
[`docs/runbooks/label-suite-deploy.md`](./docs/runbooks/label-suite-deploy.md)
and [`docs/runbooks/repository-source-of-truth.md`](./docs/runbooks/repository-source-of-truth.md).

Dokploy auto-deploy is enabled for `main`. Production credentials remain only in
Dokploy Project/Environment values. Prefer a reverted or forward-fix `main`
commit for rollback; record any emergency Dokploy history recovery and reconcile
it through GitHub immediately.
