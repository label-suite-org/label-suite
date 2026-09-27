# ADR 0007: Campaign OS relationship and reporting records

**Status:** Accepted

**Date:** 2026-08-14

## Context

Campaign OS needs to retain the real working relationship with a creator while
keeping Contact and Budget records canonical. It must not create a global creator
database, infer contact permission from a public address, or maintain a second
payment ledger beside Budget.

## Decision

- A new Campaign OS Campaign requires both an Artist and a Release. Existing
  incomplete campaigns remain readable as legacy records.
- A Creator Engagement is local to one Campaign and points to an existing
  Directory Contact.
- Outreach Permission is local to that Campaign and channel. It records its
  basis and can be revoked. A permission record never authorises bulk email,
  scraped-contact automation, another campaign, or fan marketing.
- An engagement records the agreed rate. Its payment state is derived from its
  linked Budget Line; Campaign OS does not store an independently writable paid
  state.
- Finalising a Campaign Report saves a narrative and an immutable rollup of
  known costs, delivery, and manual metrics. Live records may later be corrected
  without altering that report.

## Consequences

- Contact is the reusable relationship record; Creator Engagement is the
  campaign-specific record.
- Budget remains the financial source of truth, so Campaign OS cost displays
  cannot disagree with finance.
- Reports are suitable historical evidence but must state that post metrics are
  manually captured observations, not live platform truth.
- Branded fan Drops, consent records, fan events, platform imports, and social
  monitoring remain separate future work.
