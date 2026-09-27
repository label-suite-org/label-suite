> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Label Suite Operator MCP Runbook

**Status:** Active diagnostic and proposal-intake path

**Owner:** Label Suite operations

**Production origin:** `https://suite.truenature.online`

This local MCP server lets Codex inspect bounded suite, job, release, and
campaign health and read, claim, release, and submit cited pending
campaign-enrichment proposals. Diagnostic tools are read-only. It cannot accept
or reject suggestions, update a lead or stage, save or approve a draft, publish
a page, or send outreach.
Label Suite remains the system of record and its signed-in review UI remains the
only proposal-decision surface.

## Install and verify

Use Node.js 22.12 or newer from the reviewed repository checkout, install the
locked dependencies, and run the local package tests:

```sh
npm ci
npm run campaign:mcp:test
npm run campaign:mcp -- --base-url https://suite.truenature.online
npx tsx ops/campaign-enrichment-mcp/src/index.ts auth login --base-url https://suite.truenature.online
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich list --campaign <campaign-id> --json
```

The MCP command stays attached to stdio until its host closes the connection.
Its stdout is protocol-only. The fixed ready message and safe transport
diagnostics go to stderr. Never add banners, debug logging, or provider output
to stdout.

## Create and store the credential

1. Sign in to Label Suite and open **Settings → Codex tools**. Operations access
   is required.
2. Create a named 30-day token. Its fixed scopes are exactly
   `campaign.enrichment.read`, `campaign.enrichment.claim`, and
   `campaign.enrichment.propose`, plus the read-only
   `operator.diagnostics.read` scope.
3. Keep the one-time token panel open and run:

   ```sh
   npx tsx ops/campaign-enrichment-mcp/src/index.ts auth login --base-url https://suite.truenature.online
   ```

4. Enter the token only at the non-echoing macOS Keychain prompt. Do not put it
   in an argument, environment variable, shell history, proposal file, Codex
   configuration, log, or chat.
5. Confirm storage, then dismiss the one-time panel:

   ```sh
   npx tsx ops/campaign-enrichment-mcp/src/index.ts auth status --base-url https://suite.truenature.online
   ```

The Keychain service is `label-suite-campaign-enrichment` and its account is the
normalized Label Suite origin. The adapter uses `/usr/bin/security` and has no
plaintext file or environment-variable fallback. If Keychain is unavailable,
login fails closed.

## Configure Codex MCP

Use the checked-in executable by absolute path. For the canonical checkout on
this workstation, add this server to Codex's MCP configuration:

```toml
[mcp_servers.label_suite_campaign_enrichment]
command = "/Users/malthe/Hermes/Projects/label-suite_neon_r2-1/ops/campaign-enrichment-mcp/bin/label-suite.mjs"
args = ["mcp", "serve", "--base-url", "https://suite.truenature.online"]
```

Restart or reload MCP servers in Codex after saving the configuration. The
server exposes exactly:

- `list_enrichment_queue`
- `get_enrichment_item`
- `claim_enrichment_item`
- `submit_enrichment_proposal`
- `release_enrichment_item`
- `label_suite_health`
- `label_suite_jobs_health`
- `label_suite_operations_brief`

Codex authentication remains inside Codex. Do not copy Codex credentials,
browser cookies, `~/.codex/auth.json`, or OpenAI/OpenRouter credentials into
Label Suite, the MCP configuration, or macOS Keychain.

## CLI recovery workflow

List one campaign, inspect one item, and claim its current revision:

```sh
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich list --campaign <campaign-id> --json
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich show <lead-id> --json
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich claim <lead-id> --revision <64-character-lead-revision> --json
```

`enrich list` defaults to 20 results; an explicit `--limit` must be from 1
through 50. Claims default to 20 minutes and expire server-side without
changing the lead. Release an owned claim when abandoning work:

```sh
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich release <lead-id> --claim <claim-id> --json
```

Create a local proposal file with this strict shape. Use a new UUID
`idempotency_key`; include 1–8 unique fields from `musical_fit`, `pitch_angle`,
`contact_route`, and `programming_focus`; and use only HTTPS evidence URLs.
Evidence entries within one proposal must also be unique after canonicalizing
the HTTPS URL, retrieval instant, Unicode/case/whitespace-normalized title, and
Unicode/case/whitespace-normalized citation text.

```json
{
  "claim_id": "<claim-id>",
  "expected_lead_revision": "<64-character-lowercase-sha256>",
  "idempotency_key": "<uuid>",
  "proposals": [
    {
      "field": "programming_focus",
      "value": "<proposed value>",
      "rationale": "<why the evidence supports this proposal>",
      "evidence": [
        {
          "title": "<source title>",
          "url": "https://example.com/source",
          "retrieved_at": "2026-08-10T12:00:00.000Z",
          "citation_text": "<bounded supporting excerpt or precise paraphrase>"
        }
      ]
    }
  ],
  "client": {
    "name": "label-suite-codex",
    "version": "0.1.0",
    "session_label": null
  }
}
```

Validate and submit it through the CLI:

```sh
npx tsx ops/campaign-enrichment-mcp/src/index.ts enrich propose <lead-id> --file <absolute-proposal-file.json> --json
```

The CLI validates the complete file before composing a client or making a
request. A successful submission creates pending suggestions only. Verify the
suggestions and their `Submitted through Codex MCP` provenance in the campaign
UI; do not Accept or Reject unless the operator separately chooses to do so.

## Rotation, revocation, and uninstall

Rotate without a plaintext handoff:

1. Create a new named token in **Settings → Codex tools**.
2. Run `auth login` and enter the new token at the Keychain prompt. This replaces
   the credential for the same Label Suite origin.
3. Run `auth status`, then perform a read-only queue check.
4. Revoke the old token in Label Suite. Revocation blocks its next request.

For incident response, revoke the affected server token first, then remove the
local Keychain item:

```sh
npx tsx ops/campaign-enrichment-mcp/src/index.ts auth logout --base-url https://suite.truenature.online
```

To uninstall, remove the `label_suite_campaign_enrichment` MCP configuration,
reload Codex, run `auth logout`, and verify `auth status` reports no credential.
Removing local configuration does not revoke a server token; revoke every
active token separately in Label Suite.

## Safe recovery

- **Authentication or scope failure (CLI exit 3):** run `auth status`. If the
  token was revoked or expired, rotate it. Never recover by putting a token in
  plaintext configuration.
- **Stale revision (exit 4):** keep the proposal file local, run `enrich show`
  again, reclaim with the new revision, review the changed context, and submit
  an intentionally updated file with the current revision and a new
  idempotency key.
- **Claim conflict or expiry (exit 4):** do not work around the lease. Release an
  owned claim or wait for the reported expiry, reload the item, then reclaim.
- **Unavailable service (exit 5):** retain the local proposal file, check Label
  Suite health, and retry only after availability returns. Version one has no
  offline mutation queue.
- **Protocol failure:** confirm the absolute executable and arguments, and
  inspect the MCP host's stderr. Treat any non-JSON-RPC stdout as a defect; do
  not print the token, proposal text, citations, or raw provider responses.

Request IDs are safe correlation values for operator support. Token values,
proposal contents, raw web pages, and Codex transcripts are not troubleshooting
artifacts and must not be copied into logs.

Local-tool JSON requests are capped at 512 KiB whether or not a valid
`Content-Length` is present. The reader also rejects structures deeper than 64
levels or larger than 10,000 JSON nodes before schema validation. These cases
return the fixed `invalid_request` envelope without reflecting the body.

Every token create/revoke and bearer operation emits bounded structured
telemetry. When an organization is resolved, the same allowlisted event is
written to the existing tenant `audit_logs`: request/token/org/user IDs when
known, tool/operation, campaign/lead IDs when known, safe result category,
duration, and proposal count. Bearer/hash material, proposal or evidence text,
fetched content, contact data, and raw errors are forbidden. The audit write is
awaited but best-effort and non-transactional: telemetry/audit failure never
changes a completed domain operation or replaces its fixed safe error envelope.
Investigate a missing audit row through server telemetry using the request ID.

## Release and Fountain acceptance boundaries

Automated browser evidence uses only disposable, `e2e-` synthetic fixtures and
must pass the release-gate target safety check before seeding or creating a
token. The focused gate is:

```sh
npm run test:e2e:release-gate:campaign-enrichment
```

The real Fountain pass is manual and requires explicit owner approval before
creating a production token. It may list, inspect, claim, research, submit cited
pending proposals, compare before/after evidence, and revoke the token. It must
not Accept/Reject, save or approve copy, publish, send, record delivery, or
change a stage.
