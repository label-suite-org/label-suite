export const ANALYTICS_SECTIONS = [
  { id: "overview", label: "Overview", description: "Key movement and decisions" },
  { id: "trends", label: "Trends", description: "Daily movement and catalogue momentum" },
  { id: "audience", label: "Audience", description: "Markets and listener composition" },
  { id: "discovery", label: "Discovery", description: "Sources, playlists, and demand signals" },
  { id: "forecast", label: "Forecast", description: "Scenario planning and projections" },
  { id: "data-health", label: "Data Health", description: "Coverage, freshness, and duplicate review" },
] as const;

export type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number]["id"];

/** A Sisense import is current for the same 48-hour window used by Data Health. */
export const ANALYTICS_IMPORT_STALE_AFTER_HOURS = 48;

const SECTION_IDS = new Set<string>(ANALYTICS_SECTIONS.map((section) => section.id));

export function parseAnalyticsSection(value: string | null | undefined): AnalyticsSection {
  return value && SECTION_IDS.has(value) ? value as AnalyticsSection : "overview";
}

export function analyticsSectionHref(section: AnalyticsSection, currentUrl: URL): string {
  const params = new URLSearchParams(currentUrl.search);
  params.set("section", section);
  return `/analytics?${params.toString()}`;
}

/** Canonical remediation target for freshness warnings, retaining the active scope. */
export function analyticsSyncRunsHref(currentUrl: URL): string {
  return `${analyticsSectionHref("data-health", currentUrl)}#analytics-sync-runs`;
}
