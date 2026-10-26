# Native tour dashboard and Square sync

The current iPhone client consumes `GET /api/native/projects/:id/tour`. Its
Today → Tour entry opens the dashboard, with Project details retaining the
existing editor, events, budget and linked resources. The client is delivered
separately; this change provides the shared organization-scoped API and worker.

The worker schedules enabled Square connections every five minutes. The phone
refreshes the dashboard every minute while its screen is open. The dashboard
shows the last successful sync and flags data older than fifteen minutes.
`integrations.manage` can request a sync; other non-payee project readers can
read the dashboard. No Square credentials reach the phone.

Square access remains read-only. Fetching the complete configured tour period
lets later refunds update prior payments. Receipts use organization + merchant
+ payment identity; repeat imports update rather than append. A database lock
serializes token rotation and imports. Refreshed single-use credentials commit
before fetching sales. Voids survive re-imports. Manual card totals block a
Square import until reconciled. Non-card, split-tender, service-charge and
ambiguous partial-tax refunds are held. A formerly valid payment that becomes
ambiguous is excluded from totals until review.

Sales exclude tax/tips and deduct refunds once. Processing fees are reference
figures until reconciled against budget costs. Cash counts and transfers are
balances/movements, not revenue. USD/CAD totals are not combined. Show payments
fulfil guarantees; they are not added to the same guarantee. Forecast merch is
the average of observed nights, explicitly provisional; missing nights are not
zeroes. An absent cost budget or guarantee produces an unknown forecast.
Dates marked `not_performing` are excluded from show revenue and projections.

## Operator migration

Use `scripts/import-tour-bundle.ts PRIVATE.json` to rehearse the import in a
transaction that rolls back. The bundle must have mode 0600. Use the schema in
that script; no private tour data belongs in this repository. First reconcile
existing events, lodging and budget IDs. `supersededBudgets` preserves original
planned amounts and sets only their active forecast to zero after checking the
expected old amount. Import current allowances once using stable source keys.
Booking costs belong in the expense ledger once, not again in lodging costs.
Expense attribution includes unpaid items and does not claim a reimbursement
balance. Preserve unknown payment dates and owners.

An `unresolved` list blocks the bundle before a database connection opens.
Mapped lodging requires its existing ID and snapshot revision; subsequent user
edits abort the import. Lodging estimated costs are references, not additional
ledger expenses. Itinerary mappings check the event date and previous notes,
with optional checked title/status corrections. Preserve original notes in the
prepared text. An identical rerun skips those updates.

Follow the public web cutover runbook: private database/config/image backup,
isolated migration rehearsal, approved drift policy, reviewed public main,
required CI and Winona resource admission. No production import is performed by
migrations, deployment, CI, or the default worker.

Before copying Square credentials, pause TREK's Square importer so only one
application can rotate its single-use refresh token. Keep a private rollback
copy and verify the merchant, consent scope and tour time window. Supply the
existing token only through the private bundle. It is sealed with the existing
server secret-storage mechanism. `--apply --enable-square` explicitly imports
and activates the connection. Repeat the bundle dry-run: no new rows should be
needed. Verify receipt counts/totals and two successive syncs against the
source. Credentials are insert-only; a later rerun cannot restore a stale
refresh token. Re-enabling an existing paused connection requires a separate
operator update after validation.

TREK remains the recoverable source until itinerary, lodging, expenses and
income reconcile and physical iPhone acceptance passes. An installed build or
healthy endpoint alone does not establish migration completion. Roll back UI
through the reviewed release process; retain additive tables and do not restore
an old single-use refresh token after it has rotated.

Square reference: https://developer.squareup.com/docs/oauth-api/receive-and-manage-tokens

## Shared budget assumptions

The native tour response includes optional `budget_plan` with `revision`, `updated_at`, `currency` and `plan`. `POST /api/native/projects/:id/tour/budget` saves reviewed merch totals/date, scenario rates, deductions and conditional funding. It requires fresh `budgets.mutate` membership, an owned tour, the current currency, an explicit nullable `expected_revision`, and a UUID `request_id`. A duplicate acknowledged request returns its saved record; stale edits return 409. The update and audit are transactional. Migration 0107 adds a nullable JSON column to existing tour details without changing money entries.

Show guarantees, expected costs and shows remaining continue to come from the live dashboard; they are not copied into assumptions. Reviewed artist merch remains dated input, not automatic attribution of mixed-artist provider sales. Conditional funding is not received cash. Native clients must preserve failed-save drafts, retry explicitly with the same ID, and never present unacknowledged changes as shared. No real tour values belong in fixtures or public source.
