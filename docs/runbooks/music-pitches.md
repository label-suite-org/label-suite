# Music pitches and Samply

## Workflow

Open Campaign → Pitches, or a saved Sync opportunity → Music pitches. Create a
pitch, choose a recipient and a release, then select individual synced Samply
files. Add the recipient message, credits, confirmed rights information, and a
reply email. Downloads default to off.

Save draft only stores Label Suite data. **Create listening link** freezes that
content, creates a dedicated Samply player privately, verifies its selected
files and permissions, then enables link access. It does not alter the release
review player or send email. Anyone who receives or is forwarded the link can
listen; assigning a contact does not authenticate the listener.

Copy/open the listening page. After sending through your chosen channel, record
the date actually sent, response, next action, and follow-up date. A next action
creates a normal linked Task. Manage its completion in Tasks; clearing the next
action in the pitch marks that task done. A changed next action reopens it.

Published selections cannot be edited in Label Suite. The snapshot fixes provider file IDs, not the audio bytes stored at Samply. Create a new pitch to change files,
recipient, public text, or download permissions. Revoking hides the Label Suite
page first, then disables its dedicated Samply player. If Samply is unavailable,
the UI reports that direct provider access still needs revocation and offers a
retry. Previously downloaded copies cannot be revoked.

## Verified API capabilities and first-version scope

Documentation checked 2026-10-30:

- [Players](https://docs.samply.app/api/players.html): create a selection using
  `projectid` plus individual `boxids`; set public access, downloads, comments,
  metadata visibility, and version-stack access. Read and update the player.
  A selection is limited to one project. Passwords are mentioned in the product
  description, but no password/expiry field is documented in these API request
  schemas, so this workflow does not promise either.
- [Files](https://docs.samply.app/api/files.html): upload/download, inventory,
  artwork and file management. Existing release sync supplies the selectable
  local inventory; publishing checks current remote IDs are individual files.
- [Insights](https://docs.samply.app/api/insights.html): recent play, export,
  share and first-open events with player IDs; at most 100 recent events per
  request. Anonymous listeners have no display name. This first workflow does
  not import engagement statistics or infer listening from send status.
- [Webhooks](https://docs.samply.app/api/webhooks.html): project/player changes,
  uploads and comments. The documented list does not include listening events.

Samply hosts the audio in an embedded player; Label Suite hosts the message,
recording list, credits and reply address. No automatic outreach or new production
dependency is introduced. Existing Samply
configuration and release linking are prerequisites. A token can permit file
uploads and player writes while rejecting project creation; in that case, create
the project in Samply and link it in Label Suite. This implements the web
workflow; native editor parity is outside this slice.

## Recovery and verification

The link route authenticates and checks origin through middleware, but owns its
individual tenant-scoped transactions. It commits `preparing` before any remote
write, so a process failure cannot silently erase the reservation. The unique
provider name is `Label Suite pitch <pitch UUID>`. Samply can return an internal
player UUID and a separate public share ID in `playerUrl`. Store the share ID
for the embed and retain the internal ID for readback and revocation. A retry finds that existing
player and verifies its scope instead of creating another. An uncertain create
with no visible matching player stops for investigation; it never auto-repeats
the create. Do not reset that reservation without confirming the provider
outcome. Draft preflight failures leave the draft editable. If the player ID is known but publication is unfinished, it can be revoked directly.
An explicit 401/403 rejection of player creation also restores the draft, so
the owner can correct token access and retry. Timeouts remain reserved because
the provider may already have created the player.

`0108_pitches.sql` is additive and enables forced tenant RLS, same-workspace
foreign-reference checks and audit logging. Deploy through the usual public
repository/Dokploy procedure. If rolling back application code, retain the new
table and its records; revoke any active provider links explicitly if needed.

Focused checks:

```sh
npm exec vitest run src/pages/api/pitches/pitch-auth.test.ts src/components/pitches/PitchEditor.test.tsx src/middleware.test.ts -- --maxWorkers=1
# On a migrated, disposable local database named label_suite_pitch_test:
PITCH_INTEGRATION=1 npm exec vitest run src/server/pitches.integration.test.ts -- --maxWorkers=1
```

The integration suite also runs on the exact disposable main CI database. It
checks persistence/RLS, private drafts, exact-file publication, lost-response
recovery, follow-up Tasks, and revocation failures with a mocked Samply provider.
Before live acceptance, use an owner-approved test selection to verify that
Samply plays the selected individual versions (including an older version),
honors downloads-off, and denies the direct player after revocation. Mocked
provider tests are not evidence of those live provider behaviors.

Live acceptance on 2026-10-30 used a disposable project with generated tones.
The real API returned different internal and public player IDs, and the public
share ID was required for the embed. Desktop Chrome played the selected tone.
Selecting an older individual file showed
only that three-second version while a newer five-second version and another
track existed in the project. Revoking via Label Suite made the anonymous
provider embed report that the project was unavailable. No catalogue audio or
recipient messages were used.
