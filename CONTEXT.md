# Label Suite

Label Suite is the tenant-scoped operating system for a music label. It preserves canonical operational records while coordinating catalog, campaign, analytics, and delivery work through explicit provenance and review state.

## Campaign Enrichment

**Campaign Discovery Run**:
One operator-triggered, campaign-scoped search for external evidence and prospective targets using canonical campaign and release context. Fountain Edits is the pilot, not a special discovery mode.
_Avoid_: Fountain search, automated prospecting

**Exact-Match Evidence**:
External evidence that names or otherwise unambiguously identifies a track or edit belonging to the campaign. It is observed usage, not a prediction of outreach fit.
_Avoid_: Strong candidate, high score

**Prospective Fit**:
A reviewable judgment that an external channel may suit a campaign based on its existing output and campaign context, without evidence that it has already used the campaign's music.
_Avoid_: Match, verified usage

**Research Shortlist**:
A durable set of discovery candidates retained for operator review, including provenance and prior decisions. Membership does not make a candidate a Campaign Lead or authorize drafting or outreach.
_Avoid_: Lead list, outreach queue

**Discovery Candidate**:
A workspace-identified external channel with campaign-specific evidence awaiting or retaining an operator decision. The channel identity is shared across campaigns; its evidence and review state are not.
_Avoid_: Prospect, lead

**Discovery Relevance**:
An explainable assessment of exactness, editorial fit, activity, and evidence strength used to order Discovery Candidates. It is distinct from the outreach-priority score applied after promotion.
_Avoid_: Lead score, match score

**Discovery Evidence**:
A normalized, inspectable provider record supporting a Discovery Candidate, including its source URL, publication time, matching query, provider, and retrieval time. Provider descriptions are refreshable; provenance and operator decisions are durable.
_Avoid_: Raw API response, proof of fit

**Discovery Review State**:
The campaign-specific operator disposition of a Discovery Candidate: Unreviewed, Shortlisted, Rejected, or Promoted. Rejection remains visible, and promotion does not authorize drafting or outreach.
_Avoid_: Lead status, outreach status

**Promotion**:
The explicit operator decision to create or link a Discovery Candidate as a Campaign Lead while preserving duplicate protection and selected evidence. Promotion does not alter an existing lead's status, priority, route, or notes by inference.
_Avoid_: Import, accept, approve outreach

**Campaign Enrichment Tool**:
An authorized, tenant-scoped, proposal-only client that reads campaign enrichment work and submits cited proposals for operator review. Codex MCP and the local launcher are adapters, not the domain concept itself.
_Avoid_: Local tool, MCP tool, Codex tool

**Campaign Activity**:
A tenant-scoped projection of outreach events, tasks, research, proposals, drafts, approvals, registered sends, replies, and outcomes. It may record explicit operator decisions but cannot send, publish, or mutate canonical campaign records by inference.
_Avoid_: Activity feed, autonomous next actions

## Analytics

**Analytics Source Import**:
An evidence-preserving ingestion of one external analytics source into normalized Analytics records. It retains the source file, provenance, and import-run outcome without making the external source authoritative for operational records.
_Avoid_: Generic CSV import, analytics sync

**Sisense Ingestion Run**:
One explicitly scoped attempt to acquire Sisense evidence and optionally publish normalized analytics records, with completeness, provenance, and failure state preserved together. Browser acquisition and saved-file acquisition are adapters to the same run.
_Avoid_: Scrape job, CSV upload

## Release Verification

**Release Gate Fixture World**:
The validated synthetic identities and relationships shared by release-gate seeding and verification. It does not define expected product behavior; visible copy, permissions, counts, sanitization, and no-send outcomes remain independently asserted.
_Avoid_: Fixture constants, test truth

**Release Evidence**:
Durable proof that one exact release revision passed its independent code, schema, recovery, deployment, runtime, and signed-in acceptance gates. Product-usage telemetry is not Release Evidence.
_Avoid_: Analytics proof, health-only verification

## Product Learning

**Product Telemetry**:
Pseudonymous, optional observations of how internal operators use Label Suite, retained to improve workflows. It is best-effort learning data, never an operational record or release authority.
_Avoid_: Audit log, usage truth, release evidence

**Telemetry Allowlist**:
The explicitly approved set of product events and bounded properties that may leave Label Suite for product learning. Anything absent from the allowlist is prohibited by default.
_Avoid_: Autocapture, collect everything

**Telemetry Preference**:
A User-owned, cross-Workspace choice to participate in Product Telemetry. A Workspace Owner may disable telemetry for the Workspace but cannot override or erase an individual User's opt-out.
_Avoid_: Workspace tracking permission, analytics consent

## Campaign OS

**Campaign**:
A time-bounded effort for one Artist and one Release. New Campaign OS campaigns
always have both links; legacy incomplete campaigns remain historical records.
_Avoid_: Promotion, project

**Creator Engagement**:
A Campaign-local working relationship with one Directory Contact, including its
outreach state, agreement, deliverables, and evidence. It is not a global Creator
profile.
_Avoid_: Creator record, influencer profile

**Outreach Permission**:
The recorded basis for contacting a Contact about one Campaign through one
channel. It does not grant permission for future campaigns or fan marketing.
_Avoid_: Public-email permission, blanket consent

**Campaign Cost**:
A Budget Line linked to a Campaign. Budget is the source of truth for committed
and paid amounts.
_Avoid_: Engagement payment status, campaign-side payment ledger

**Final Report**:
A Campaign's deliberately finalised narrative and immutable rollup of the known
costs, delivery, and manually captured results at that time.
_Avoid_: Live dashboard, running notes

## Native iOS

**Mobile Operational Parity**:
Every recurring label workflow is executable natively on iPhone while rare
administration, integration credentials, destructive bulk operations, complex
imports, and reconciliation may remain explicit, product-owner-approved web
exceptions.
_Avoid_: Screen parity, companion app, identical mobile version

**Native Record Route**:
A Workspace-scoped path to one canonical Label Suite record that preserves its
record type, identity, originating context, and predictable return behavior.
It navigates to canonical data and is never mutation authority.
_Avoid_: Mobile screen link, web deep link, action URL

**Mobile Web Exception**:
An explicitly approved operation that remains web-only with its reason, risk,
native handoff, and reconsideration trigger recorded. Missing implementation or
technical difficulty alone does not make an exception.
_Avoid_: Not supported, later, desktop feature

**Protected Mobile Snapshot**:
A bounded, visibly stale, read-only projection of recently viewed canonical
records and essential navigation summaries, isolated by user and Workspace and
erased when the session or Workspace access is removed.
_Avoid_: Offline mode, local database, sync cache

## Artist Archive

**Artist Archive**:
One ongoing, private space for an Artist and their manager, opened with a
revocable link. It contains explicitly shared agreement documents and the
history of submitted credits. It grants no Workspace membership.
_Avoid_: Public artist page, artist account, signing portal

**Shared Agreement**:
An operator-selected snapshot of an artist-linked Document's name, status and
file reference. Internal notes are excluded. Saving the archive refreshes the
selection; it does not copy file bytes, sign a document or confirm new terms.
_Avoid_: Automatically published contract, immutable signed copy

**Artist Submission**:
An attributed intake record describing a track, its contributors and any
reported writing shares. Marking it reviewed records that the label has read it;
it never changes canonical credits, rights or agreements automatically.
_Avoid_: Approved split, verified identity, executed agreement
