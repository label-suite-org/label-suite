# Fans & Drops: email-first core

Fans subscribe on a public Drop linked to one artist, optionally a release and selected shows. An operator saves the draft; only an owner can publish the reviewed revision. Published content is a separate snapshot. Staff changes never silently replace a live page. An unpublish removes the signup page but preserves earlier promised offers and consent records.

The native controls live in `ios/SuiteV2/Fans`; see that directory's integration instructions. They cover Drop editing/preview, public link/QR sharing, fan history/tags/export and message drafting/review/scheduling/cancellation/status. They use the existing native bearer session and current workspace membership. Fan addresses are limited to owner/operator access, even when other roles can read ordinary catalogue records.

## Consent and public access

- `/drops/{org}/{slug}` projects only explicitly published fields. Public signup never provisions a user or workspace.
- Signup requires a checked artist-specific email consent box. Email normalization trims/case-folds but preserves aliases. Names, cities and show choices become the subscription profile only after verification.
- Confirmation uses a purpose-bound HMAC token, expires after 24 hours and requires a POST. Link scanners opening a GET cannot confirm or revoke consent. The promised offer is captured with the signup.
- Confirmation emails and the completed confirmation page include an artist-specific unsubscribe link. Earlier confirmation links cannot undo a later unsubscribe. A fresh signup and confirmation can reconsent, unless provider suppression applies.
- Brevo campaign emails use Brevo's account-wide unsubscribe link, explicitly labelled as all email sent by the label. Hard bounce, spam and unsubscribe callbacks suppress the address across all artists. Importing a contact or creating a new campaign never clears Brevo's blacklist.
- Public responses are private/no-store with no-referrer. Intake has a 32 KiB body bound, a honeypot and durable HMAC-keyed limits: 20 attempts/address/hour, 3/email/day and 1,000/Drop/hour. These are initial abuse bounds, not a replacement for an edge WAF before broad exposure.
- No existing provider list is imported. Establish consent provenance before any later import; existing list membership alone is not consent evidence.

## Message lifecycle

A saved draft contains plain text, an optional HTTPS link and an artist/city/Drop/tag audience rule. The review returns the exact local audience (up to 500) and a hash bound to the saved revision. Schedule rejects a stale review and persists the job atomically with the message. An absolute timestamp is stored; the native date picker displays the operator's local timezone.

Label Suite owns scheduling. Brevo campaigns are created as drafts only when the job becomes due; no competing Brevo schedule is set. Each campaign receives a new dedicated list in the configured folder. The worker reads existing contact suppression, never clears it, and synchronizes only the reviewed recipients. New signups after review are not added. Consent and suppression are checked again under row locks before the bounded provider handoff; exclusions must be acknowledged before `sendNow`.

Cancellation is available for draft/scheduled messages. Preparation is the cutoff: queued provider email cannot reliably be recalled. To reschedule, cancel and create a new draft, then review again. If a worker dies or a provider response is lost, the message enters `review`. A job retry never repeats a send. Refresh provider status reads the recorded campaign ID and verifies its identity before updating status/report. A missing provider ID after an uncertain create requires manual investigation using the exact `Label Suite {message-id}` name; do not create a replacement until the original outcome is established.

`submitted` means Brevo accepted the handoff; it does not mean delivered. Reports expose sent, delivered, unique clicks, bounces, complaints and unsubscriptions. Authenticated webhooks add deduplicated fan activity and suppression. Opens/clicks are provider observations, not proof of a person listening or buying. Audience preview reflects known local suppression; the dispatch provider check can reduce that count further.

Initial bounds: 500 recipients per campaign; 100 most recent Drops/messages; 500 choices per catalogue type; 1,001 fans in the native list/export; 100 signups and 100 events per fan history. Windows are labelled in the UI. Increase them with pagination/throughput evidence when a real audience requires it.

## Owner-only delivery pilot

Set `FAN_ALLOWED_EMAIL` to the owner's exact address before enabling the fan flags. Signup rejects other recipients; audience review, scheduling and dispatch exclude them, and pending confirmations recheck the restriction before contacting the provider. The configured `FAN_BREVO_ORG_ID` also bounds this pilot. Missing, empty or malformed recipient configuration blocks all sending. Wider audiences require a separately reviewed implementation and activation decision.

The native **Send test to me** action is available only to a workspace owner whose authenticated account email matches the configured address. It snapshots the saved draft into a separate message/job, retaining the original draft. There is one test per saved revision: duplicate taps, concurrent requests and retries return the same test. Edit and save a new revision for another test. The worker creates a Brevo draft with no audience or schedule and calls `sendTest` with exactly one explicit address. Tests appear in message history and may be cancelled before preparation. `submitted` means provider acceptance, not inbox delivery; uncertain outcomes require review and never resend automatically.

## Configuration and activation

Existing dependencies only: Astro/React, Postgres/Drizzle, the jobs worker and Brevo. No new production package. Migrations `0103`, `0104` and `0105` are additive, use forced tenant RLS and enforce same-org references. Apply with the existing reviewed migration path; never drop the new tables as a rollback after collecting data.

Required existing settings: `DATABASE_URL`, `PUBLIC_SITE_URL`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

New settings in `.env.example`:

- `FAN_TOKEN_SECRET`: random 32+ bytes, kept stable. Rotation invalidates outstanding links.
- `FAN_EMAIL_ENABLED`: confirmation sending and signup intake; default disabled.
- `FAN_BROADCAST_ENABLED`: campaign scheduling/delivery; default disabled.
- `FAN_BREVO_ORG_ID`: one org permitted to use this account for marketing. Multiple provider accounts/tenants are outside this first release.
- `FAN_BREVO_FOLDER_ID`: a dedicated campaign folder, with no list-addition welcome automation.
- `FAN_BREVO_WEBHOOK_SECRET`: random 32+ characters; install as Brevo's custom `X-Label-Suite-Fan-Secret` webhook header. POST to `/api/fans/brevo/{org}`. This is the provider-supported custom-header authentication mechanism, not an invented provider signature.

Register marketing delivered/click/opened/proxy-open/hard-bounce/soft-bounce/spam/unsubscribe callbacks using the current provider event selection. Payload event names differ from registration names (`hard_bounce`, `soft_bounce`, etc.). Verify a captured owner-controlled event against the endpoint before enabling broadcasts. Account-wide suppression from other campaigns is also honored for known fans.

Before activation: confirm sender/domain authentication, plan quota, dedicated folder and automation exclusions, authenticated webhook delivery and retry behavior, worker health, runtime RLS role grants, public HTTPS/origin/proxy configuration and retention/erasure procedure. Check job capacity against the provider quota; 500 is an application bound, not an entitlement to that many sends. Do not assume a read-only readiness check authorizes provider writes or paid upgrades.

Pilot on owner-controlled addresses only: publish a fixture Drop → mobile signup → one confirmation → correct offer → correct artist/city audience → review/schedule one campaign → reconcile delivered/click → unsubscribe → excluded from the next preview and dispatch. Repeat cancellation and unknown-response recovery. Separately accept the native UI on the physical iPhone. Preserve existing signup forms, welcome workflows and QR destinations until the pilot and an explicit cutover decision.

Emergency stop: disable both fan flags using the existing configuration/rollback procedure. Cancel scheduled messages in the app before disabling, where possible. Inspect queued/failed jobs before re-enabling; never bulk-retry uncertain sends. Keep tables and provider campaign IDs. Rolling the application back leaves collected fan data intact; changing the HMAC secret is not a rollback.

## Verification

Focused tests: `FAN_TEST_DATABASE_URL=postgresql://...@127.0.0.1:PORT/fan_drops_test npm exec vitest run src/server/fan-drops.integration.test.ts -- --maxWorkers=1` uses a disposable database only and a non-superuser/no-bypass-RLS runtime role. Migrate that scratch DB first. Tests cover published snapshots, pending/confirmed consent, artist scope, revocation, suppression, tenant isolation, atomic jobs, cancellation, lost responses, reconciliation and callback deduplication. Unit tests cover token/body validation and route authority.

Required repository gate: `npm run ci`. Its pre-existing database tests require a separate clean local database named exactly `label_suite`, using UTC for both Postgres and Node. Do not point the general job-store test at a fixture database containing unrelated pending jobs. The fan integration suite is separately opt-in.

Live delivery, webhook registration, paid-provider changes, deployment and physical-device acceptance are separate gates. Test fixtures must never use a real audience. UGC, SMS, creator handoff, external discovery and existing-list import are deferred.
