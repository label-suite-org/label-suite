import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const org = `analytics-${randomUUID()}`, foreign = `analytics-${randomUUID()}`;
const actor = `${org}-user`;
const artist = `${org}-artist`, otherArtist = `${org}-other`, release = `${org}-release`, foreignArtist = `${foreign}-artist`;
let sql: ReturnType<typeof postgres>;
let service: typeof import("./native-analytics");
let scoped: typeof import("../lib/db").runWithDatabaseContext;
describe.skipIf(process.env.NATIVE_ANALYTICS_INTEGRATION !== "1")("native Analytics scope", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_analytics_fixture" || url.search || url.hash) throw new Error("Disposable native_analytics_fixture only");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./native-analytics");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Analytics',${org}),(${foreign},'Foreign',${foreign})`;
    await sql`insert into label_suite."user" (id,name,email) values (${actor},'Analytics fixture',${actor + '@example.test'})`;
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${actor},${org},${actor},'member')`;
    await sql`insert into label_suite.artists (id,org_id,name) values (${artist},${org},'Selected artist'),(${otherArtist},${org},'Other artist'),(${foreignArtist},${foreign},'Private artist')`;
    await sql`insert into label_suite.releases (id,org_id,title,artist_id) values (${release},${org},'Selected release',${artist})`;
    for (const [id, orgId, artistId, releaseId, streams] of [
      ['a',org,artist,release,10], ['b',org,artist,release,0], ['c',org,otherArtist,null,30], ['d',foreign,foreignArtist,null,900],
    ] as const) {
      await sql`insert into label_suite.analytics_metric_rows (id,org_id,source,widget_key,artist_id,release_id,row_key,row_hash,requested_date_range,requested_aggregation,dimensions,metrics,raw_row,last_seen_at)
      values (${`${org}-${id}`},${orgId},'sisense','spotify-streams-source',${artistId},${releaseId},${id},${id},'All Dates','Daily',${sql.json({ date: id === 'b' ? '2026-09-26' : '2026-09-25', source: 'radio' })},${sql.json({ streams })},'{}','2026-09-26')`;
    }
  });
  afterAll(async () => {
    if (!sql) return;
    for (const table of ['analytics_metric_rows','releases','artists','org_memberships','audit_logs']) await sql.unsafe(`delete from label_suite.${table} where org_id in ($1,$2)`, [org, foreign]);
    await sql`delete from label_suite.orgs where id in (${org},${foreign})`;
    await sql`delete from label_suite."user" where id=${actor}`;
    await sql.end();
  });
  const read = (scope: unknown) => scoped({ orgId: org, userId: actor }, () => service.getNativeAnalytics(org, scope, new Date('2026-09-27T00:00:00Z')), { isolationLevel: 'repeatable read' });
  it("keeps workspace, artist and release data scoped while preserving measured zero days", async () => {
    const workspace = await read({});
    expect(workspace.periods.find(p => p.key === 'all')?.streamTotal).toBe(40);
    const selected = await read({ artist_id: artist, release_id: release });
    expect(selected.scope).toMatchObject({ kind: 'release', artist: { id: artist }, release: { id: release } });
    expect(selected.periods.find(p => p.key === 'all')?.dailyTrend.map(p => p.total)).toEqual([10, 0]);
    expect(selected.sources).toMatchObject([{ rows: 2, source: 'sisense' }]);
    expect(selected.workspace_ingestion.scope).toBe('workspace');
    expect(selected.reporting).toMatchObject({ through: '2026-09-26', stale: false });
    expect(JSON.stringify(selected)).not.toContain('Private artist');
    expect(selected.import_handoff.href).toContain(encodeURIComponent(release));
  });
  it("distinguishes missing daily evidence from measured zero and marks older reporting stale", async () => {
    const emptyId = `${org}-empty`;
    await sql`insert into label_suite.artists (id,org_id,name) values (${emptyId},${org},'No reporting yet')`;
    const empty = await read({ artist_id: emptyId });
    expect(empty.reporting).toMatchObject({ through: null, stale: null });
    expect(empty.sources).toEqual([]);
    expect(empty.periods.every(period => period.trendState.kind === 'empty' && period.dailyTrend.length === 0)).toBe(true);
    const stale = await scoped({ orgId: org, userId: actor }, () => service.getNativeAnalytics(org, { release_id: release }, new Date('2026-10-10T00:00:00Z')), { isolationLevel: 'repeatable read' });
    expect(stale.reporting).toMatchObject({ through: '2026-09-26', stale: true });
    expect(stale.periods.find(period => period.key === 'all')?.dailyTrend.map(point => point.total)).toEqual([10, 0]);
  });
  it("rejects foreign and mismatched selections rather than broadening scope", async () => {
    await expect(read({ artist_id: foreignArtist })).rejects.toMatchObject({ status: 404 });
    await expect(read({ release_id: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(read({ artist_id: otherArtist, release_id: release })).rejects.toMatchObject({ status: 400 });
    await expect(read({ import: true })).rejects.toThrow();
  });
});
