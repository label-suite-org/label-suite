import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const ORG_ID = "true-nature";
const DEMO_ARTIST_NAMES = [
  "Fenja",
  "Lykke Strand",
  "Mikkel b2b",
  "The Gentle Noise",
  "Villads Himmel",
  "Airtable Artist recjq0uB989YogZmS",
];

const execute = process.argv.includes("--execute");

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const summarySql = `
with target_artists as (
  select id, name
  from label_suite.artists
  where org_id = $1 and name = any($2::text[])
),
target_releases as (
  select id
  from label_suite.releases
  where org_id = $1 and artist_id in (select id from target_artists)
),
target_tracks as (
  select id, work_id
  from label_suite.tracks
  where org_id = $1 and release_id in (select id from target_releases)
),
target_works as (
  select distinct tt.work_id as id
  from target_tracks tt
  where tt.work_id is not null
    and not exists (
      select 1
      from label_suite.tracks other_tracks
      where other_tracks.work_id = tt.work_id
        and other_tracks.id not in (select id from target_tracks)
    )
),
target_budget_projects as (
  select id
  from label_suite.budget_projects
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
    )
),
target_budget_lines as (
  select id
  from label_suite.budget_line_items
  where org_id = $1
    and (
      release_id in (select id from target_releases)
      or project_id in (select id from target_budget_projects)
    )
),
target_funding_sources as (
  select id
  from label_suite.funding_sources
  where org_id = $1 and project_id in (select id from target_budget_projects)
),
target_campaigns as (
  select id
  from label_suite.campaigns
  where org_id = $1
    and (
      linked_artist_id in (select id from target_artists)
      or linked_release_id in (select id from target_releases)
    )
),
target_media_assets as (
  select id
  from label_suite.media_assets
  where org_id = $1
    and (
      linked_artist_id in (select id from target_artists)
      or linked_release_id in (select id from target_releases)
    )
),
target_documents as (
  select id
  from label_suite.documents
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
    )
),
target_metric_rows as (
  select id
  from label_suite.analytics_metric_rows
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
),
target_import_runs as (
  select id
  from label_suite.analytics_import_runs
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
),
target_dsp_pitches as (
  select distinct dp.id
  from label_suite.dsp_pitches dp
  where dp.org_id = $1 and dp.release_id in (select id from target_releases)
  union
  select distinct dpr.dsp_pitch_id
  from label_suite.dsp_pitch_releases dpr
  where dpr.org_id = $1 and dpr.release_id in (select id from target_releases)
)
select json_build_object(
  'artists', (select coalesce(json_agg(target_artists order by name), '[]'::json) from target_artists),
  'artists_count', (select count(*) from target_artists),
  'releases_count', (select count(*) from target_releases),
  'tracks_count', (select count(*) from target_tracks),
  'works_count', (select count(*) from target_works),
  'roles_count', (select count(*) from label_suite.roles where org_id = $1 and work_id in (select id from target_works)),
  'budget_projects_count', (select count(*) from target_budget_projects),
  'budget_lines_count', (select count(*) from target_budget_lines),
  'funding_sources_count', (select count(*) from target_funding_sources),
  'campaigns_count', (select count(*) from target_campaigns),
  'media_assets_count', (select count(*) from target_media_assets),
  'documents_count', (select count(*) from target_documents),
  'analytics_import_runs_count', (select count(*) from target_import_runs),
  'analytics_metric_rows_count', (select count(*) from target_metric_rows),
  'royalties_count', (
    select count(*)
    from label_suite.royalties_revenue
    where org_id = $1
      and (
        artist_id in (select id from target_artists)
        or release_id in (select id from target_releases)
        or track_id in (select id from target_tracks)
        or work_id in (select id from target_works)
      )
  ),
  'ops_tasks_count', (
    select count(*)
    from label_suite.ops_tasks
    where org_id = $1
      and (
        linked_artist_id in (select id from target_artists)
        or linked_release_id in (select id from target_releases)
      )
  ),
  'dsp_pitches_count', (select count(*) from target_dsp_pitches),
  'dsp_pitch_releases_count', (
    select count(*)
    from label_suite.dsp_pitch_releases
    where org_id = $1 and release_id in (select id from target_releases)
  ),
  'calls_count', (
    select count(*)
    from label_suite.calls
    where org_id = $1 and release_id in (select id from target_releases)
  ),
  'bugs_count', (
    select count(*)
    from label_suite.bugs
    where org_id = $1
      and source_record_id in (
        select id from target_artists
        union select id from target_releases
        union select id from target_tracks
        union select id from target_works
      )
  ),
  'airtable_mappings_count', (
    select count(*)
    from label_suite.airtable_record_mappings
    where org_id = $1
      and postgres_record_id in (
        select id from target_artists
        union select id from target_releases
        union select id from target_tracks
        union select id from target_works
      )
  )
) as summary;
`;

const cleanupSql = `
with target_artists as (
  select id, name
  from label_suite.artists
  where org_id = $1 and name = any($2::text[])
),
target_releases as (
  select id
  from label_suite.releases
  where org_id = $1 and artist_id in (select id from target_artists)
),
target_tracks as (
  select id, work_id
  from label_suite.tracks
  where org_id = $1 and release_id in (select id from target_releases)
),
target_works as (
  select distinct tt.work_id as id
  from target_tracks tt
  where tt.work_id is not null
    and not exists (
      select 1
      from label_suite.tracks other_tracks
      where other_tracks.work_id = tt.work_id
        and other_tracks.id not in (select id from target_tracks)
    )
),
target_budget_projects as (
  select id
  from label_suite.budget_projects
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
    )
),
target_budget_lines as (
  select id
  from label_suite.budget_line_items
  where org_id = $1
    and (
      release_id in (select id from target_releases)
      or project_id in (select id from target_budget_projects)
    )
),
target_funding_sources as (
  select id
  from label_suite.funding_sources
  where org_id = $1 and project_id in (select id from target_budget_projects)
),
target_campaigns as (
  select id
  from label_suite.campaigns
  where org_id = $1
    and (
      linked_artist_id in (select id from target_artists)
      or linked_release_id in (select id from target_releases)
    )
),
target_media_assets as (
  select id
  from label_suite.media_assets
  where org_id = $1
    and (
      linked_artist_id in (select id from target_artists)
      or linked_release_id in (select id from target_releases)
    )
),
target_documents as (
  select id
  from label_suite.documents
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
    )
),
target_metric_rows as (
  select id
  from label_suite.analytics_metric_rows
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
),
target_import_runs as (
  select id
  from label_suite.analytics_import_runs
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
),
target_dsp_pitches as (
  select distinct dp.id
  from label_suite.dsp_pitches dp
  where dp.org_id = $1 and dp.release_id in (select id from target_releases)
  union
  select distinct dpr.dsp_pitch_id
  from label_suite.dsp_pitch_releases dpr
  where dpr.org_id = $1 and dpr.release_id in (select id from target_releases)
),
delete_mapping as (
  delete from label_suite.airtable_record_mappings
  where org_id = $1
    and postgres_record_id in (
      select id from target_artists
      union select id from target_releases
      union select id from target_tracks
      union select id from target_works
    )
  returning id
),
delete_metric_changes as (
  delete from label_suite.analytics_metric_changes
  where org_id = $1
    and (
      metric_row_id in (select id from target_metric_rows)
      or run_id in (select id from target_import_runs)
      or artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
  returning id
),
delete_metric_rows as (
  delete from label_suite.analytics_metric_rows
  where org_id = $1 and id in (select id from target_metric_rows)
  returning id
),
delete_import_files as (
  delete from label_suite.analytics_import_files
  where org_id = $1
    and (
      run_id in (select id from target_import_runs)
      or artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
    )
  returning id
),
delete_import_runs as (
  delete from label_suite.analytics_import_runs
  where org_id = $1 and id in (select id from target_import_runs)
  returning id
),
delete_campaign_stations as (
  delete from label_suite.campaign_stations
  where org_id = $1 and campaign_id in (select id from target_campaigns)
  returning id
),
delete_email_logs as (
  delete from label_suite.email_logs
  where org_id = $1 and campaign_id in (select id from target_campaigns)
  returning id
),
delete_campaigns as (
  delete from label_suite.campaigns
  where org_id = $1 and id in (select id from target_campaigns)
  returning id
),
delete_media_files as (
  delete from label_suite.media_asset_files
  where org_id = $1
    and (
      media_asset_id in (select id from target_media_assets)
      or source_postgres_record_id in (
        select id from target_artists
        union select id from target_releases
        union select id from target_tracks
        union select id from target_works
      )
    )
  returning id
),
delete_media_assets as (
  delete from label_suite.media_assets
  where org_id = $1 and id in (select id from target_media_assets)
  returning id
),
delete_budget_docs as (
  delete from label_suite.budget_line_documents
  where org_id = $1
    and (
      budget_line_item_id in (select id from target_budget_lines)
      or document_id in (select id from target_documents)
    )
  returning id
),
delete_documents as (
  delete from label_suite.documents
  where org_id = $1 and id in (select id from target_documents)
  returning id
),
delete_variance_requests as (
  delete from label_suite.budget_line_variance_requests
  where org_id = $1 and line_id in (select id from target_budget_lines)
  returning id
),
delete_budget_lines as (
  delete from label_suite.budget_line_items
  where org_id = $1 and id in (select id from target_budget_lines)
  returning id
),
delete_funding_events as (
  delete from label_suite.funding_source_events
  where org_id = $1 and funding_source_id in (select id from target_funding_sources)
  returning id
),
delete_funding_sources as (
  delete from label_suite.funding_sources
  where org_id = $1 and id in (select id from target_funding_sources)
  returning id
),
delete_budget_projects as (
  delete from label_suite.budget_projects
  where org_id = $1 and id in (select id from target_budget_projects)
  returning id
),
delete_side_artists as (
  delete from label_suite.side_artists
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
    )
  returning id
),
delete_royalties as (
  delete from label_suite.royalties_revenue
  where org_id = $1
    and (
      artist_id in (select id from target_artists)
      or release_id in (select id from target_releases)
      or track_id in (select id from target_tracks)
      or work_id in (select id from target_works)
    )
  returning id
),
delete_ops_tasks as (
  delete from label_suite.ops_tasks
  where org_id = $1
    and (
      linked_artist_id in (select id from target_artists)
      or linked_release_id in (select id from target_releases)
    )
  returning id
),
delete_calls as (
  delete from label_suite.calls
  where org_id = $1 and release_id in (select id from target_releases)
  returning id
),
delete_dsp_pitch_releases as (
  delete from label_suite.dsp_pitch_releases
  where org_id = $1
    and (
      release_id in (select id from target_releases)
      or dsp_pitch_id in (select id from target_dsp_pitches)
    )
  returning id
),
delete_dsp_pitches as (
  delete from label_suite.dsp_pitches
  where org_id = $1 and id in (select id from target_dsp_pitches)
  returning id
),
delete_bugs as (
  delete from label_suite.bugs
  where org_id = $1
    and source_record_id in (
      select id from target_artists
      union select id from target_releases
      union select id from target_tracks
      union select id from target_works
    )
  returning id
),
delete_roles as (
  delete from label_suite.roles
  where org_id = $1 and work_id in (select id from target_works)
  returning id
),
delete_tracks as (
  delete from label_suite.tracks
  where org_id = $1 and id in (select id from target_tracks)
  returning id
),
delete_releases as (
  delete from label_suite.releases
  where org_id = $1 and id in (select id from target_releases)
  returning id
),
delete_works as (
  delete from label_suite.works
  where org_id = $1 and id in (select id from target_works)
  returning id
),
delete_artists as (
  delete from label_suite.artists
  where org_id = $1 and id in (select id from target_artists)
  returning id
)
select json_build_object(
  'airtable_mappings', (select count(*) from delete_mapping),
  'analytics_metric_changes', (select count(*) from delete_metric_changes),
  'analytics_metric_rows', (select count(*) from delete_metric_rows),
  'analytics_import_files', (select count(*) from delete_import_files),
  'analytics_import_runs', (select count(*) from delete_import_runs),
  'campaign_stations', (select count(*) from delete_campaign_stations),
  'email_logs', (select count(*) from delete_email_logs),
  'campaigns', (select count(*) from delete_campaigns),
  'media_asset_files', (select count(*) from delete_media_files),
  'media_assets', (select count(*) from delete_media_assets),
  'budget_line_documents', (select count(*) from delete_budget_docs),
  'documents', (select count(*) from delete_documents),
  'budget_line_variance_requests', (select count(*) from delete_variance_requests),
  'budget_line_items', (select count(*) from delete_budget_lines),
  'funding_source_events', (select count(*) from delete_funding_events),
  'funding_sources', (select count(*) from delete_funding_sources),
  'budget_projects', (select count(*) from delete_budget_projects),
  'side_artists', (select count(*) from delete_side_artists),
  'royalties_revenue', (select count(*) from delete_royalties),
  'ops_tasks', (select count(*) from delete_ops_tasks),
  'calls', (select count(*) from delete_calls),
  'dsp_pitch_releases', (select count(*) from delete_dsp_pitch_releases),
  'dsp_pitches', (select count(*) from delete_dsp_pitches),
  'bugs', (select count(*) from delete_bugs),
  'roles', (select count(*) from delete_roles),
  'tracks', (select count(*) from delete_tracks),
  'releases', (select count(*) from delete_releases),
  'works', (select count(*) from delete_works),
  'artists', (select count(*) from delete_artists)
) as deleted;
`;

async function main() {
  const client = await pool.connect();
  try {
    const summary = await client.query(summarySql, [ORG_ID, DEMO_ARTIST_NAMES]);
    console.log(JSON.stringify({ mode: execute ? "execute" : "dry-run", summary: summary.rows[0].summary }, null, 2));

    if (!execute) return;

    await client.query("begin");
    const deleted = await client.query(cleanupSql, [ORG_ID, DEMO_ARTIST_NAMES]);
    await client.query("commit");
    console.log(JSON.stringify({ deleted: deleted.rows[0].deleted }, null, 2));
  } catch (error) {
    if (execute) await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
