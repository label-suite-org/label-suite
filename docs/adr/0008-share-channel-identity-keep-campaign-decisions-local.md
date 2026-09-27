# ADR 0008: Share channel identity while keeping discovery decisions campaign-specific

**Status:** Accepted
**Date:** 2026-08-15

Discovery Candidates use one tenant-scoped provider identity for each external channel, while Discovery Evidence, Research Shortlist membership, and Discovery Review State belong to the campaign that produced them. This prevents duplicate channel identities and makes prior campaign context visible without allowing one campaign's judgment to silently govern another; we reject both campaign-local channel copies and workspace-global shortlist decisions because the former fragments evidence while the latter erases campaign context.
