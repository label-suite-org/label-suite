import { useState } from "react";
import type { CampaignStatusBreakdown, OpsTasksBreakdown, RoyaltiesTimeseriesResult, TopArtistRow, TopReleaseRow } from "../../server/analytics-extra";
import CampaignBreakdown from "./CampaignBreakdown";
import OpsTasksBreakdownView from "./OpsTasksBreakdownView";
import { TopArtistsByNet, TopReleasesByNet } from "./RevenueRankings";
import RoyaltiesTimeseries from "./RoyaltiesTimeseries";

export default function AnalyticsOperations({ royaltiesTimeseries, topArtists, topReleases, campaignBreakdown, opsBreakdown }: {
  royaltiesTimeseries: RoyaltiesTimeseriesResult;
  topArtists: TopArtistRow[];
  topReleases: TopReleaseRow[];
  campaignBreakdown: CampaignStatusBreakdown[];
  opsBreakdown: OpsTasksBreakdown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)} className="group border-t border-[var(--border)] pt-5">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Ops layer</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Royalties, campaigns, and tasks</h2>
            <p className="mt-1 text-sm text-muted-foreground">Review revenue, campaign progress, and open tasks.</p>
          </div>
          <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden rounded-full border border-[var(--border)] px-3 py-1 text-xs text-muted-foreground group-open:inline">Hide</span>
        </div>
      </summary>
      {open && <div className="mt-6 space-y-6">
        <RoyaltiesTimeseries data={royaltiesTimeseries} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TopArtistsByNet rows={topArtists} />
          <TopReleasesByNet rows={topReleases} />
        </div>

        <CampaignBreakdown rows={campaignBreakdown} />

        <OpsTasksBreakdownView data={opsBreakdown} />
      </div>}
    </details>
  );
}
