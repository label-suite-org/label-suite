import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { analytics_metric_rows, artists, releases } from "../db/schema";
import { db } from "../lib/db";
import { listAnalyticsCommandCenter } from "./analytics";
import { listAnalyticsDataQuality } from "./analytics-data-quality";
import { HttpError, NotFoundError } from "./errors";
import { ANALYTICS_IMPORT_STALE_AFTER_HOURS } from "../lib/analytics-workspace";

export const nativeAnalyticsScopeSchema = z.object({
  artist_id: z.string().trim().min(1).optional(),
  release_id: z.string().trim().min(1).optional(),
}).strict();

export async function getNativeAnalytics(orgId: string, raw: unknown, now = new Date()) {
  const scope = nativeAnalyticsScopeSchema.parse(raw);
  return db.transaction(async tx => {
    let artist: { id: string; name: string } | null = null;
    let release: { id: string; title: string; artist_id: string | null } | null = null;
    if (scope.artist_id) {
      [artist] = await tx.select({ id: artists.id, name: artists.name }).from(artists).where(and(eq(artists.org_id, orgId), eq(artists.id, scope.artist_id))).limit(1);
      if (!artist) throw new NotFoundError("Artist not found in this workspace");
    }
    if (scope.release_id) {
      [release] = await tx.select({ id: releases.id, title: releases.title, artist_id: releases.artist_id }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, scope.release_id))).limit(1);
      if (!release) throw new NotFoundError("Release not found in this workspace");
      if (artist && release.artist_id !== artist.id) throw new HttpError("Release does not belong to the selected artist", 400);
    }
    const filter = { artistId: artist?.id, releaseId: release?.id };
    const [command, quality, sources] = await Promise.all([
      listAnalyticsCommandCenter(orgId, filter),
      listAnalyticsDataQuality(orgId, now),
      tx.select({ source: analytics_metric_rows.source, widget: analytics_metric_rows.widget_key,
        rows: sql<number>`count(*)::int`, linked_tracks: sql<number>`count(distinct ${analytics_metric_rows.track_id})::int`,
        observed_at: sql<Date | null>`max(${analytics_metric_rows.last_seen_at})`,
      }).from(analytics_metric_rows).where(and(eq(analytics_metric_rows.org_id, orgId),
        artist ? eq(analytics_metric_rows.artist_id, artist.id) : undefined,
        release ? eq(analytics_metric_rows.release_id, release.id) : undefined,
      )).groupBy(analytics_metric_rows.source, analytics_metric_rows.widget_key),
    ]);
    const reportingThrough = command.dataWindow.to;
    const reportingAgeHours = reportingThrough ? (now.getTime() - new Date(`${reportingThrough}T00:00:00Z`).getTime()) / 3_600_000 : null;
    const query = new URLSearchParams({ section: "data-health" });
    if (artist) query.set("artist", artist.id);
    if (release) query.set("release", release.id);
    return {
      scope: { kind: release ? "release" : artist ? "artist" : "workspace", artist, release },
      fetched_at: now.toISOString(),
      reporting: { through: reportingThrough, stale: reportingAgeHours === null ? null : reportingAgeHours > ANALYTICS_IMPORT_STALE_AFTER_HOURS, basis: "latest_scoped_daily_reporting_date" },
      periods: command.periods.map(({ insights: _insights, ...period }) => period),
      catalog: { ...command.catalog, completeness: "Top 100 track snapshot rows; not a complete catalog total" },
      sources,
      workspace_ingestion: { scope: "workspace", source: "sisense", ...quality.health },
      available_artists: command.availableArtists, available_releases: command.availableReleases,
      import_handoff: { href: `/analytics?${query}`, label: "Open in Label Suite Web", explanation: "Complex imports and source reconciliation require the web workspace. No native import is performed." },
    };
  }, { isolationLevel: "repeatable read" });
}
