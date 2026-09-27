# Samply Integration Spec

## Goal

Use Samply as Label Suite's external audio review and delivery layer without turning it into the system of record.

Label Suite should continue to own:

- release, track, work, and rights metadata
- readiness and clearance state
- internal tasking and approvals
- tenant boundaries and product navigation

Samply should provide:

- high-quality hosted playback
- external-facing share links
- version-aware review surfaces
- upload portals for contributor intake
- comment and upload events that Label Suite can ingest

## Recommendation

Adopt Samply in three product surfaces:

1. `Release review embed`
2. `External share page`
3. `Contributor upload embed`

Do not use Samply embeds as the primary internal UI for approvals, metadata editing, or rights operations.

## Why It Fits Label Suite

The current app already has the right primitives:

- `releases`, `tracks`, `works`, `media_assets`, and `documents` in [`src/db/schema.ts`](/Users/malthe/Hermes/Projects/label-suite_neon_r2-1/src/db/schema.ts:93)
- release readiness and scoped analytics UX in [`src/components/releases/ReleaseWorkspace.tsx`](/Users/malthe/Hermes/Projects/label-suite_neon_r2-1/src/components/releases/ReleaseWorkspace.tsx:58)
- tenant-safe object storage and signed URL patterns in [`src/server/storage.ts`](/Users/malthe/Hermes/Projects/label-suite_neon_r2-1/src/server/storage.ts:1)
- existing external-ingestion patterns in [`scripts/sisense-sync.ts`](/Users/malthe/Hermes/Projects/label-suite_neon_r2-1/scripts/sisense-sync.ts:1)

This means Samply can slot in as a peer integration rather than forcing a rewrite of core domain logic.

## External Surfaces

### 1. Release review embed

Purpose:

- play final or in-progress audio directly inside a release workspace
- let internal users and invited reviewers hear the same hosted audio
- keep review context next to release readiness, tracks, and assets

Shape:

- Label Suite creates or links a Samply project per release
- Label Suite creates one or more Samply players per release
- the release page can render a Samply iframe for the selected player

Good fit:

- `Review` tab on release detail
- optional player in track editor workspace
- manager/client-facing “listen here” panel without exposing raw storage URLs

Not a fit:

- replacing the release workspace UI itself
- using the embed as the only place review decisions are made

### 2. External share page

Purpose:

- generate audience-specific listening pages from Label Suite
- keep asset selection and distribution intent in Label Suite
- offload playback quality and streaming UX to Samply

Suggested share types:

- `dsp_pitch`
- `radio`
- `manager`
- `press_preview`
- `internal`

Each share page should map to a Samply player with its own settings for:

- comments enabled or disabled
- downloads enabled or disabled
- quality setting
- version visibility
- public vs restricted link strategy

Label Suite should store the share intent and audience; Samply should handle playback and link behavior.

### 3. Contributor upload embed

Purpose:

- receive incoming files from remixers, mix engineers, mastering engineers, videographers, and photographers
- keep inbound delivery tied to a release, campaign, document request, or media asset request

Shape:

- Label Suite creates or links a Samply upload-enabled project or player
- a contributor page embeds the Samply upload portal
- Label Suite passes known contributor metadata into the embedded iframe where possible
- upload completion triggers a Label Suite sync or review task

Best first use cases:

- revised master delivery
- instrumental / clean / radio edit delivery
- cover art revisions
- press photo intake
- campaign asset collection

## Embeds Strategy

### Use embeds

Use Samply embeds when the host page needs:

- strong playback quality
- quick setup
- lightweight review or share UX
- minimal custom playback controls

### Do not overuse embeds

Avoid making embeds the primary pattern for:

- tenant-aware CRUD flows
- internal workflows needing deep app-state sync
- rights and clearance editing
- audit-heavy approval tracking

Reason:

- Samply's public embed documentation is iframe-based, not a full host-side SDK
- that implies limited state introspection and limited host-app control
- embeds should be treated as presentation surfaces, not core application state

## API Scope

The public Samply API currently gives us enough surface area for an MVP around:

- projects
- players
- files
- comments
- webhooks

Recommended MVP flow:

1. Create or link a Samply project per release
2. Upload release files and optional artwork
3. Create audience-specific players
4. Persist remote IDs in Label Suite
5. Ingest webhook events for comments and uploads
6. Render selected players as embeds where useful

## Proposed Data Model Additions

Add dedicated tables instead of scattering Samply IDs onto existing product tables.

### `samply_connections`

Purpose:

- records one configured Samply account per org
- stores connection metadata, not raw token in plaintext forever

Suggested fields:

- `id`
- `org_id`
- `label`
- `base_url`
- `status`
- `last_checked_at`
- `created_at`
- `updated_at`

### `samply_projects`

Purpose:

- links Label Suite releases, campaigns, or assets to Samply projects

Suggested fields:

- `id`
- `org_id`
- `release_id`
- `campaign_id`
- `remote_project_id`
- `remote_project_name`
- `primary_player_id`
- `upload_enabled`
- `last_synced_at`
- `created_at`
- `updated_at`

### `samply_players`

Purpose:

- tracks audience-specific links / players created from a project

Suggested fields:

- `id`
- `org_id`
- `samply_project_id`
- `release_id`
- `remote_player_id`
- `player_type`
- `name`
- `embed_url`
- `share_url`
- `public`
- `downloads_enabled`
- `comments_enabled`
- `quality`
- `created_at`
- `updated_at`

### `samply_files`

Purpose:

- maps Label Suite tracks, works, media assets, or documents to uploaded Samply files/stacks

Suggested fields:

- `id`
- `org_id`
- `samply_project_id`
- `track_id`
- `work_id`
- `media_asset_id`
- `document_id`
- `remote_box_id`
- `remote_stack_id`
- `file_name`
- `source_storage_key`
- `sync_status`
- `last_synced_at`
- `created_at`
- `updated_at`

### `samply_events`

Purpose:

- stores raw webhook deliveries for idempotent processing and debugging

Suggested fields:

- `id`
- `org_id`
- `event_type`
- `remote_event_id`
- `remote_project_id`
- `remote_box_id`
- `payload`
- `processed_at`
- `created_at`

### `samply_comment_links`

Purpose:

- links remote comments to local review tasks, notes, or future approval entities

Suggested fields:

- `id`
- `org_id`
- `samply_event_id`
- `remote_comment_id`
- `release_id`
- `track_id`
- `ops_task_id`
- `comment_status`
- `created_at`
- `updated_at`

## Sync Rules

### Label Suite -> Samply

Label Suite should be the source of truth for:

- release naming
- track ordering
- version grouping intent
- share intent and audience

Outbound sync actions:

- create project
- update project name
- upload files
- create stack for alternate versions
- create or update players

### Samply -> Label Suite

Samply should feed back:

- comment creation
- upload started / completed / failed
- optional project/player metadata changes if we later support them

Inbound events should never silently overwrite Label Suite product state.

Instead:

- append event rows
- map to review notes or ops tasks
- require explicit product-side actions where ambiguity exists

## Comment Handling

Recommended stance:

- treat Samply comments as review signals, not final approval state

Reasons:

- current public docs show create/list support
- `get` and `update` are not documented as generally available
- that makes full two-way comment reconciliation brittle for a first pass

Practical MVP:

- ingest `comment.created`
- create a local ops task or review note
- link the task back to the release/track
- keep “approve / changes requested / ready” inside Label Suite

## Security Model

### Immediate token storage

For the current single-org / operator-managed setup, store the rotated Samply token in server-side environment variables only.

Recommended keys:

```sh
SAMPLY_API_TOKEN=your-rotated-token
SAMPLY_BASE_URL=https://samply.app/api/v0
SAMPLY_ORG_ID=true-nature
```

Store it:

- locally in `.env`
- in production in your host or deployment secret store

Never store it:

- in client-side env vars
- in checked-in config files
- in browser storage
- in Astro pages or React props sent to the browser

### Longer-term multi-tenant storage

If Label Suite becomes self-serve and each org connects its own Samply account:

- move from one env token to per-org encrypted credentials
- store ciphertext in Postgres
- encrypt/decrypt server-side only
- rotate keys independently from customer tokens

Do not build this before there is a real multi-org Samply onboarding need.

## Webhooks

Recommended webhook subscriptions:

- `comment.created`
- `upload.started`
- `upload.completed`
- `upload.failed`
- optionally `player.updated` and `project.updated` for diagnostics

Handling rules:

- write every delivery to `samply_events`
- process idempotently by `remote_event_id`
- treat webhook payloads as integration signals, not final authority
- add a reconciliation path for re-fetching remote state when needed

Note:

- the current public docs describe webhook creation and payloads
- they do not clearly document request-signing or verification headers
- until that exists, do not let webhooks directly mutate critical product state without validation

## Phased Delivery

### Phase 1: Outbound review foundation

Build:

- env-driven Samply client
- `samply_projects`, `samply_players`, `samply_files`
- create project
- upload files
- create player
- store embed URL

UI:

- `Review` panel on release page
- “Create Samply review player” action

### Phase 2: External share pages

Build:

- share-type templates
- player presets by audience
- share page routes in Label Suite

UI:

- one-click `Create radio link`
- one-click `Create DSP preview`
- one-click `Create manager review`

### Phase 3: Upload portal intake

Build:

- contributor upload page
- Samply upload embed
- upload-completed event ingestion

UI:

- request asset / request master / request revision flows

### Phase 4: Comment ingestion

Build:

- webhook endpoint
- `samply_events`
- comment-to-task mapping

UI:

- review activity feed on release and track pages

## Decisions

### Decide now

- use Samply as playback/review/delivery infrastructure
- keep Label Suite as system of record
- use embeds only where they improve review and sharing UX
- store the rotated token server-side in env for the current setup

### Defer

- per-customer OAuth onboarding
- encrypted per-org token vault
- bi-directional comment editing
- using Samply as the primary approval system
- deep host-page control beyond iframe embedding

## Recommended Next Implementation Slice

The best first slice is:

1. add env-backed Samply server config
2. add local tables for remote project/player/file IDs
3. add a server action or API endpoint to create a release review project + player
4. show the resulting embed on the release page

That gets us a real end-to-end outcome without locking us into a bad architecture.
