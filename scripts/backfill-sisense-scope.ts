import "dotenv/config";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  
  // 1. Backfill artist_id via dimensions->>'primary_artist' matching artists.name
  const artistResult = await client.query(`
    update label_suite.analytics_metric_rows amr
    set artist_id = a.id
    from label_suite.artists a
    where amr.artist_id is null
      and amr.org_id = a.org_id
      and lower(trim(coalesce(
        amr.dimensions->>'primary_artist',
        amr.dimensions->>'artist',
        amr.dimensions->>'artist_name'
      ))) = lower(trim(a.name))
  `);
  console.log(`artist_id backfill: ${artistResult.rowCount} rows updated`);

  // 2. Backfill track_id via dimensions->>'track_title' matching tracks.title
  const trackResult = await client.query(`
    update label_suite.analytics_metric_rows amr
    set track_id = t.id
    from label_suite.tracks t
    where amr.track_id is null
      and amr.org_id = t.org_id
      and lower(trim(amr.dimensions->>'track_title')) = lower(trim(t.title))
  `);
  console.log(`track_id backfill: ${trackResult.rowCount} rows updated`);

  // 3. Backfill release_id via track.release_id where track_id is now set
  const releaseFromTrackResult = await client.query(`
    update label_suite.analytics_metric_rows amr
    set release_id = t.release_id
    from label_suite.tracks t
    where amr.release_id is null
      and amr.track_id is not null
      and amr.track_id = t.id
      and amr.org_id = t.org_id
  `);
  console.log(`release_id (from track) backfill: ${releaseFromTrackResult.rowCount} rows updated`);

  // 4. Backfill release_id directly via dimensions->>'release_title' matching releases.title
  const releaseDirectResult = await client.query(`
    update label_suite.analytics_metric_rows amr
    set release_id = r.id
    from label_suite.releases r
    where amr.release_id is null
      and amr.org_id = r.org_id
      and lower(trim(coalesce(
        amr.dimensions->>'release_title',
        amr.dimensions->>'album_title',
        amr.dimensions->>'release'
      ))) = lower(trim(r.title))
  `);
  console.log(`release_id (direct) backfill: ${releaseDirectResult.rowCount} rows updated`);

  // 5. Stats after backfill
  const { rows: stats } = await client.query(`
    select 
      count(*)::int as total,
      count(artist_id)::int as with_artist,
      count(release_id)::int as with_release,
      count(track_id)::int as with_track,
      count(distinct artist_id)::int as unique_artists,
      count(distinct release_id)::int as unique_releases,
      count(distinct track_id)::int as unique_tracks
    from label_suite.analytics_metric_rows
  `);
  console.log("\nAfter backfill:");
  console.table(stats);

  // 6. Check which releases now have data
  const { rows: withData } = await client.query(`
    select r.title as release, a.name as artist, count(*)::int as rows,
           count(distinct amr.widget_key) as widgets
    from label_suite.analytics_metric_rows amr
    join label_suite.releases r on r.id = amr.release_id and r.org_id = amr.org_id
    left join label_suite.artists a on a.id = amr.artist_id and a.org_id = amr.org_id
    where amr.release_id is not null
    group by 1,2 order by 3 desc limit 10
  `);
  console.log("\nReleases with Sisense data:");
  console.table(withData);

  // 7. Check which artists now have data
  const { rows: artistData } = await client.query(`
    select a.name, count(*)::int as rows,
           count(distinct amr.widget_key) as widgets,
           count(distinct amr.release_id) as releases
    from label_suite.analytics_metric_rows amr
    join label_suite.artists a on a.id = amr.artist_id and a.org_id = amr.org_id
    where amr.artist_id is not null
    group by 1 order by 2 desc
  `);
  console.log("\nArtists with Sisense data:");
  console.table(artistData);

  client.release();
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => pool.end());