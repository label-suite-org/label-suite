# Sync licensing

Owners and operators open **Sync** in the sidebar or **More → Sync** in the native app. Artist and release pages link to their deals. Create a deal with the production, recording title, exact version and provenance; link existing catalog records, contacts, documents and assets when confirmed. Leave unknown values blank or Unknown. A fee reported with a dollar sign does not establish its currency code or whether it covers one side or both rights.

Record commercial progress, master and publishing clearance, signature/effectiveness, delivery, collection, settlement and cue-sheet follow-up separately. Approval needs evidence. Material changes reset clearance and contract review, preserving the previous revision. Resolve stale-edit conflicts by reloading the deal before reapplying edits. A changed next action reopens the linked Tasks item; completing it remains a Tasks operation.

Receipts use exact decimal amounts, currency, date and accounting references. Retry the same pending receipt instead of creating another one. A balance is calculated only for accepted, confirmed single-side fees in a known currency. All-in and per-side fees require allocation review. Collection does not post royalty earnings or pay artists. Settlement requires a reviewed worksheet and supporting evidence. This release does not generate legal agreements, send invoices, perform payments, submit cue sheets to societies, or contact licensors.

## Verification and rollout

Migration `0106_sync_licensing.sql` adds tenant-scoped deals, revisions and receipts with forced RLS and same-workspace reference checks. It contains no customer seed. Fresh-migration validation and focused persistence tests use disposable PostgreSQL, never production.

Run `SYNC_INTEGRATION=1 DATABASE_URL=<local label_suite_sync_test URL> npm test -- src/server/sync.integration.test.ts`, `npm test -- src/lib/sync.test.ts src/pages/api/sync/sync-auth.test.ts`, repository CI, and a native build. The local integration target must be localhost or 127.0.0.1 with database name `label_suite_sync_test`; CI uses its explicitly disposable database. PostgreSQL timezone must match CI's UTC for unrelated timestamp-based auth fixtures.

Before creating the first operational case, verify the merged main revision through Dokploy, migrations, `/api/health`, and signed-in Sync. Find existing artist/release/recording records and check for an existing deal before creating one. Store owner-supplied facts with provenance and leave absent contract terms, clearances and money movements unconfirmed. Pilot details and evidence belong in the private workspace, not public source or CI fixtures.

Rollback uses the prior verified Dokploy revision. Preserve the additive tables and their data; the older application ignores them. Do not drop tables to roll back application code. Physical-device acceptance remains separate from simulator validation.
