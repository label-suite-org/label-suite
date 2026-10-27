# Native music catalogue captures

Analytics → Data health accepts a prepared JSON capture from a signed-in
Spotify for Artists or Apple Music for Artists song catalogue. Select the local
artist, preview the native artist, dates and song count, then import. Overview
shows the latest observation for each artist and provider. This is an explicit
import, not an automatic provider connection or an official CSV parser.

Record the exact inclusive dates, worldwide scope, capture time, provider artist
ID, every accessible song's provider ID and its native URL. Preserve native
versions and collaborator entries; never join by title. Spotify captures use
audio streams and exclude music videos. Apple captures use plays. Use `null`
when a value is unavailable; an observed zero remains `0`. Do not infer daily,
territory, release or lifetime values from a period total.

The JSON format is defined by `src/server/native-music-snapshot.ts`: version 1,
provider (`spotify_for_artists` or `apple_music_for_artists`), providerArtistId,
artistName, capturedAt (UTC ISO timestamp), dateFrom/dateThrough (ISO dates),
territory (`worldwide`), metric (`audio_streams` or `plays`), artistTotal,
acquisition (`signed_in_browser_capture`), sourceUrl, and rows containing
recordingId, title, value and sourceUrl. Apple artistTotal may contain a separately
observed native rollup from the identical period and scope; differences from the
song sum remain visible. Spotify artistTotal must be null because its general
artist rollup can include video streams.

Keep browser evidence and prepared captures private. The source file must be
archived in the configured private analytics bucket before the transaction
commits. Duplicate files do not create another run. Captures are immutable and
read as whole runs, so an older upload or removed song cannot contaminate a newer
observation. Preview SHA-256 binds the applied file to the reviewed bytes.

This surface does not populate native mobile analytics, daily trends, geography,
or local release totals. Those surfaces must retain their own source/coverage
limitations. Dashboard access is not proof of unattended access or an analytics
API authorization. Refresh requires another verified capture and import.

For recovery, prefer a reviewed application revert. No migration is introduced;
preserve archived files and immutable imported rows. Do not delete source data
to roll back presentation changes.
