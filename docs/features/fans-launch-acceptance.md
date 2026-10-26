# Fan email launch hardening

## Scope and acceptance

Prepare a one-artist public launch while retaining the owner-only live pilot. Do not activate public signup, import existing fans, change existing signup/QR destinations, upgrade a provider plan, or overwrite concurrent native/tour work during this release. The postal address is supplied by the owner later; never publish a placeholder address.

- Public signup requires an explicit flag, selected artist, existing workspace/owner configuration and postal address. With the flag absent/false, only the owner can sign up or receive mail. Closing the flag again excludes real fans from queued dispatch as well as new signup.
- Every scheduled audience remains confirmed, scoped to the artist and reviewed revision. Send test to me remains one explicit owner address in both modes.
- Campaign HTML includes the configured postal address and identifies True Nature as sender. The public privacy notice has matching scope and retention wording; while public signup is closed it continues to describe the pilot.
- Confirmation, owner-test and campaign attempts share an atomic UTC daily budget. Default 200, maximum 250 on the current shared 300/day plan. No provider call occurs after exhaustion. Signup intake also has a shared daily bound in addition to existing address/email/Drop limits.
- On exhausted delivery budget, campaigns enter review with `daily_email_budget` before provider preparation; confirmations are marked failed. No automatic reschedule or next-day resend. An operator checks remaining quota and the absence of a provider identity before a new reviewed draft; a fan may request a fresh confirmation after the next UTC reset. Never resend an unknown provider outcome.
- Reservations are conservative: failed/unknown attempts and recipients excluded later still consume that day's budget. Other application/Brevo workflows are outside this counter; verify their allowance before opening signup. This does not promise 200 delivered emails or replace account-level monitoring.
- Reconciliation uses the maximum of provider aggregates and authenticated, recipient-deduplicated webhook observations. A verified delivery cannot become zero because aggregates lag. Delivery implies a send; an open/click does not prove delivery or a human action.
- Existing cancellation, stale-review, suppression, tenant-isolation and uncertain-response tests continue to pass. Add focused public gate, budget concurrency/exhaustion and report regression checks.

## Before opening signup

1. Supply the business postal address in Dokploy, review the True Nature controller/contact details and the public notice. Verify provider processing/transfer terms and settle tracking disclosure/consent before public activation. Do not claim that Brevo tracking is disabled: the current campaign API does not expose a verified per-campaign off switch. Do not change shared account tracking settings as a side effect of this release.
2. Assign the manual retention reviews to the workspace owner: every three months, review unconfirmed signups older than 30 days and activity older than 12 months. Remove no-longer-needed records, while preserving minimal opt-out/consent evidence and unresolved requests. Inventory both Label Suite and dedicated Brevo lists/campaigns. Never erase a shared contact or clear a blacklist to clean a list. Document deletion requests and replay them after any backup restore. No cleanup is automated by this release.
3. Verify sender/domain authentication, current shared provider quota, dedicated folder exclusion from welcome automations, authenticated webhook processing, worker health and the emergency stop. Verify edge abuse controls before broadly sharing the link; app rate limits and the daily budget bound traffic but do not replace edge protection.
4. Publish a separate fan-facing Drop only after reviewing the copy/offer from the signup workstream. Keep the current concert signup/QR destination intact until a separate cutover decision. Accept new double-opt-in subscriptions first. List membership alone does not establish consent for import.
5. On an owner-controlled address, complete mobile signup, real confirmation, audience review, scheduled inbox receipt, cancellation, and unsubscribe followed by exclusion from preview and dispatch. Confirm the provider unsubscribe's label-wide scope; never clear a real blacklist merely to restore testability. Use isolated fixtures for synthetic bounce and unknown-response tests.
6. Accept the physical iPhone flow against the latest combined app. The native copy change in this release only removes the obsolete 500-recipient advice; coordinate it with the current native workstream before the next build/install. Preserve saved drafts and the latest shared source.
7. Only after all items above pass, verify the intended `FAN_PUBLIC_ARTIST_ID` exists in the configured workspace, set it, and explicitly set `FAN_PUBLIC_SIGNUP_ENABLED=true` through Dokploy. Missing postal address must still fail closed. A code merge or deployment is not activation approval.

## Recovery and current hold

Keep `FAN_PUBLIC_SIGNUP_ENABLED` absent/false throughout this release. Close it to return to owner-only mode; turn both existing email flags off to stop all Fans intake/delivery. Preserve subscription data and provider IDs. Recheck queued/unknown jobs before reopening and never bulk-retry them. The release adds no database migration, new dependency or automatic deletion.

Sources checked: [Brevo free-plan limits](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [campaign creation API](https://developers.brevo.com/reference/create-email-campaign), [campaign reporting API](https://developers.brevo.com/reference/get-email-campaign), [FTC commercial-email guidance](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business). Operational acceptance is not a legal compliance certification.
