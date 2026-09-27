# ADR 0005: Campaign email provider boundary

**Status:** Accepted for the current campaign slice

**Date:** 2026-07-27

## Decision

Keep Brevo as the current campaign transport and put campaign sends behind a small provider interface. The configured provider is selected in server code, never from request data or the campaign UI. Creating a campaign, opening a preview, rendering a template, or linking a radio audience must not send mail.

The provider interface records the stable boundary needed for a later Kit/SES comparison: provider id, normalized recipient input, delivery result, provider message id, and an operator-visible error. The existing email log remains the operational record for recipient, subject, body, campaign, station, sender, status, and failure details.

## Out of scope

No provider migration, rich-text editor, unsubscribe model, webhook ingestion, or transport credential change is approved by this ADR. Any such change requires a follow-up provider/compliance review covering authentication, cost, deliverability, templates, unsubscribe/compliance, inbound events, migration, and rollback.

## Safety boundary

All outbound sends remain explicit operator actions through the existing send endpoint. The endpoint must continue to require the operations mutation capability, a selected recipient set, subject, body, and a logged result for every attempted recipient.

## Radio update preview boundary

The radio-update slice adds a transparent, no-send preview only. Its server-owned
preview binds the approved leadless radio email draft, the exact reviewed public
page revision, the saved audience selection, focused-lead exclusions, normalized
recipient set, and a deterministic preview hash. Client-supplied copy or version
fields cannot replace those reviewed records.

Every radio batch preview carries the hard blocker
`batch_compliance_unavailable`. The send path rejects that blocker before provider
resolution, so this slice adds no batch-send authority. Suppression, unsubscribe,
and the remaining compliance model are a future approval-gated prerequisite and
must be designed and reviewed before any batch delivery is enabled.
