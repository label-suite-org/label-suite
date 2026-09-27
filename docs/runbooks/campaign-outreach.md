> Historical deployment reference, not an executable procedure for this public
> candidate. Do not run legacy private-history fetches, change repository remotes,
> use Forgejo delivery instructions, or deploy from this document. Follow
> [PUBLIC_SOURCE.md](../../PUBLIC_SOURCE.md) and [AGENTS.md](../../AGENTS.md).
> Public CI uses only the fresh database policy and does not fetch private history.

# Campaign authoring and outreach workflow

## What the editor stores

Campaign goal, notes, public release notes, focused outreach bodies, and radio-update bodies use the same deliberately small document format. Supported formatting is paragraph, H2, H3, bold, italic, links, bullet and ordered lists, blockquote, undo, and redo. Images, tables, code, strike-through, underline, arbitrary HTML, and floating menus are not supported.

The authoritative saved value is canonical, validated Tiptap JSON. The server derives plain text and safe HTML from that JSON; client HTML and model HTML are never accepted as authority. Campaign/public-page fields allow 20,000 characters. Focused and radio email bodies allow 10,000 characters. Older plain-text values are converted once into paragraphs when loaded, then remain readable and become canonical JSON on the next explicit save.

## Draft and restore behaviour

Focused and radio email drafts are immutable versions. **Save as new draft** or **Save manual version** creates the next version; it does not edit an approved version in place. Restoring an older version only loads it as unsaved copy. Save it explicitly to create a new current version, then review the resulting version under the normal approval gate.

## AI proposals

AI assist can draft, enrich, improve, shorten, adjust tone, or use a bounded custom instruction. The request reports document or selection scope and the exact permitted campaign references. OpenRouter is the provider when configured; it may be disabled, time out, fail at the network/provider boundary, or return a malformed/invalid proposal. The audited safe categories are `disabled`, `refused`, `timeout`, `network`, `provider`, `malformed_output`, `invalid_proposal`, and `unknown_citation`; raw provider text is never exposed. In every case manual editing remains available.

Each result is an audited proposal with its provider/model summary, compact context references, accepted usable citation links, and a labeled Current/Proposed comparison. It never directly edits saved content. Review the comparison, then:

- **Accept suggestion** updates only the local, unsaved editor state.
- **Reject suggestion** leaves the editor unchanged.
- If the editor changed while the proposal was pending, the result is stale. Keep the comparison visible, choose **Discard stale suggestion and retry**, then request a fresh proposal.

Only accepted usable citations from authoritative research are shown. Provider raw responses, contacts, secrets, and unaccepted evidence are not displayed.

## Authority separation

These actions intentionally remain separate:

| Action | Effect | Does not do |
| --- | --- | --- |
| Accept AI | Local unsaved editor change | Save, review, approve, publish, deliver, record sent, or advance a lead |
| Save | Persist canonical content or a new draft version | Review, approve, publish, deliver, or record sent |
| Review page | Mark a saved page revision reviewed | Publish it |
| Approve draft | Approve the current saved email draft | Deliver email or record a send |
| Publish | Owner-only publication of a reviewed page | Send outreach |
| Record sent | Audit an externally performed manual send | Deliver a message |

AI/provider output is always a proposal, never an external action. No outreach was sent and nothing was published by the editor implementation workflow.

## Relationship Activity lane

Campaign → Outreach → Activity is a provider-neutral read model composed from
Label Suite-owned outreach events, tasks, email metadata, lead milestones, and
review state. It is not a universal event store and it does not import provider
payloads, credentials, message bodies, fan identities, or unrestricted details.

The chronology and category filters are read-only. **Open workflow** only
navigates to the existing Outreach lead anchor or Ops Tasks; it does not start
research, create a draft, send a message, change a stage, or create a task.

Recommendation controls are deliberately narrower:

| Control | Effect | Does not do |
| --- | --- | --- |
| Dismiss recommendation | Writes one `dismissed` proposal decision | Change a lead, task, draft, stage, send, or provider state |
| Mark handled | Writes one `resolved` proposal decision | Approve, send, publish, or complete the linked workflow |

Only an operator/owner with `operations.mutate` sees those controls. A member
can read the lane but cannot write a decision. A **Partial activity** notice
names only recognized unavailable sources; an empty source that loaded
successfully is shown as complete and does not imply missing data.

After **Record sent** succeeds for an external manual send, refresh the
Outreach workspace and Activity snapshot separately. A refresh failure must not
turn a successfully recorded send into a failed send, and Activity never sends
or verifies delivery itself.

## Tomorrow's radio batch update

1. Prepare and explicitly save the public-page fields and release note.
2. Mark that saved revision reviewed. A reviewed preview is authenticated and is not public until an owner separately publishes it.
3. Create or open the radio draft, use AI only to suggest/review copy, and save a new radio version when ready.
4. Explicitly approve the current saved email draft.
5. Generate the no-send preview to inspect exact recipients, exclusions, and deduplication.
6. Separately authorize any delivery outside this editor, then record sent only after that external action actually occurred.

Do not treat an AI acceptance, a preview, a saved draft, or an approved draft as a send authorization.
