import type { AnalyticsProviderIntegrity } from "../../server/analytics-data-quality";

export default function ProviderIntegrityNotice({ integrity }: { integrity: AnalyticsProviderIntegrity }) {
  return <aside className="space-y-2 border border-amber-500/40 bg-amber-500/10 p-4 text-sm" aria-label="Provider scope and reconciliation">
    <p className="font-semibold">{integrity.status === "conflicting" ? "Provider totals conflict" : "Provider recording coverage is unverified"}</p>
    <p>These are shared distributor exports. Missing songs, versions and collaborator credits can make artist totals incomplete. Complete export acquisition does not verify complete artist coverage. Artist totals and recommendations are withheld until reconciled with the native providers.</p>
    <p>Catalogue rows: provider-selected reporting period {integrity.dateRange ?? "unknown"}, {integrity.aggregation ?? "unknown aggregation"}. These are not lifetime counts. The page’s trend buttons do not change this export window. Catalogue rows retain combined-platform counts when a platform is selected. Retained catalogue and audience rows may include earlier imports; relative range labels do not prove a common date window.</p>
    <p>Daily streams, playlists and Shazams: {integrity.track ?? "unknown recording"} · {integrity.artist ?? "unknown artist"}. Audience: provider-selected artist. City and playlist exports cover reported rows only; their sums are not worldwide totals. Source categories, playlist counts, audience ratios and genre benchmarks have not been independently reconciled. Listener counts are not stream counts. Import timestamps do not establish provider freshness; use the provider coverage dates below.</p>
    <p>{integrity.unmatchedCatalogueRows.toLocaleString()} catalogue rows lack a local recording link. Display titles are not proof of recording identity.</p>
    {integrity.reporting.map(row => <p key={row.widgetKey}>{row.widgetKey.startsWith("apple") ? "Apple" : "Spotify"} daily coverage: {row.from ?? "unknown"} through {row.through ?? "unknown"}.</p>)}
    {integrity.conflicts.map(conflict => <p key={conflict.platform}>{conflict.platform === "apple" ? "Apple" : "Spotify"}: reported catalogue sum {conflict.reportedCatalogueSum.toLocaleString()}, selected-track daily sum {conflict.dailyTrackSum.toLocaleString()} (daily exceeds catalogue by {conflict.difference.toLocaleString()}). The exports do not reconcile. Neither value has been substituted for the other.</p>)}
    <p>Shared dashboard access does not expose the query or recording IDs needed to repair upstream counts. Blank metrics remain unknown (—); provider-reported zeroes are not proof that a missing recording had no plays.</p>
  </aside>;
}
