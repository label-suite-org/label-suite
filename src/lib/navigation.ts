import { analyticsSectionHref, parseAnalyticsSection } from "./analytics-workspace";

export type AppNavItem = {
  id: string;
  title: string;
  url: string;
  section: AppNavSection;
  parentId?: string;
  mobilePrimary?: boolean;
  keywords?: string[];
};

export type AppNavSection = "primary" | "operations" | "directory" | "contextual";

export const APP_NAV_SECTIONS = [
  { id: "primary", label: "Workspace" },
  { id: "operations", label: "Operations" },
  { id: "directory", label: "Directory" },
  { id: "contextual", label: "Contextual" },
] as const satisfies readonly { id: AppNavSection; label: string }[];

export const APP_NAV_ITEMS = [
  { id: "dashboard", title: "Dashboard", url: "/dashboard", section: "primary", mobilePrimary: true, keywords: ["home", "overview"] },
  { id: "today", title: "Today", url: "/today", section: "primary", mobilePrimary: true, keywords: ["today", "daily"] },
  { id: "events", title: "Events", url: "/events", section: "directory", mobilePrimary: false, keywords: ["events", "schedule", "agenda"] },
  { id: "projects", title: "Projects", url: "/projects", section: "directory", mobilePrimary: false, keywords: ["projects", "portfolio", "work"] },
  { id: "artists", title: "Artists", url: "/artists", section: "primary", mobilePrimary: false, keywords: ["roster", "acts"] },
  { id: "releases", title: "Releases", url: "/releases", section: "primary", mobilePrimary: true, keywords: ["catalog", "albums", "singles"] },
  { id: "analytics", title: "Analytics", url: "/analytics", section: "primary", mobilePrimary: false, keywords: ["stats", "insights", "streams"] },
  { id: "campaigns", title: "Campaigns", url: "/campaigns", section: "primary", mobilePrimary: true, keywords: ["marketing", "promo"] },
  { id: "ops-tasks", title: "Tasks", url: "/ops-tasks", section: "operations", mobilePrimary: true, keywords: ["tasks", "todo", "operations"] },
  { id: "data-quality", title: "Data quality", url: "/data-quality", section: "operations", mobilePrimary: false, keywords: ["integrations", "mismatches", "reconciliation"] },
  { id: "integrations", title: "Integrations", url: "/integrations", section: "operations", mobilePrimary: false, keywords: ["providers", "connections", "sync", "data quality"] },
  { id: "royalties", title: "Royalties", url: "/royalties", section: "operations", mobilePrimary: false, keywords: ["money", "revenue", "statements", "payouts"] },
  { id: "grants", title: "Grants", url: "/grants", section: "operations", mobilePrimary: false, keywords: ["funding", "applications", "funder"] },
  { id: "contacts", title: "Contacts", url: "/contacts", section: "directory", mobilePrimary: false, keywords: ["people", "organizations"] },
  { id: "forecast", title: "Forecast", url: "/analytics?section=forecast", section: "contextual", mobilePrimary: false, parentId: "analytics", keywords: ["analytics", "projection", "planning"] },
  { id: "works", title: "Works", url: "/works", section: "contextual", mobilePrimary: false, parentId: "releases", keywords: ["songs", "compositions", "recordings"] },
  { id: "catalog", title: "Catalog", url: "/catalog", section: "contextual", mobilePrimary: false, parentId: "releases", keywords: ["catalog numbers", "physical", "videos"] },
  { id: "radio-plugging", title: "Radio Plugging", url: "/radio-plugging", section: "contextual", mobilePrimary: false, parentId: "campaigns", keywords: ["radio", "pitching"] },
  { id: "radio-stations", title: "Radio Stations", url: "/radio-stations", section: "contextual", mobilePrimary: false, parentId: "campaigns", keywords: ["radio", "stations"] },
  { id: "media-assets", title: "Media Assets", url: "/media-assets", section: "contextual", mobilePrimary: false, keywords: ["assets", "images", "files"] },
  { id: "documents", title: "Documents", url: "/documents", section: "contextual", mobilePrimary: false, keywords: ["contracts", "files", "paperwork"] },
  { id: "budget", title: "Budget", url: "/budget", section: "contextual", mobilePrimary: false, keywords: ["finance", "spend", "costs"] },
  { id: "help", title: "Help & glossary", url: "/help", section: "contextual", mobilePrimary: false, keywords: ["help", "glossary", "definitions", "terms"] },
] as const satisfies readonly AppNavItem[];

export const APP_NAV_PRIMARY_ITEMS = APP_NAV_ITEMS.filter((item) => item.mobilePrimary);
export const APP_NAV_MORE_ITEMS = APP_NAV_ITEMS.filter((item) => !item.mobilePrimary);
export const APP_NAV_ITEM_BY_ID = APP_NAV_ITEMS.reduce(
  (acc, item) => {
    acc[item.id] = item;
    return acc;
  },
  {} as Record<string, AppNavItem>,
);

const NAV_BASE = "https://label-suite.internal";

function parseNavigationUrl(value: string): URL {
  return new URL(value, NAV_BASE);
}

/** Returns true when the target route is the current route, including meaningful query state. */
export function isCurrentNavPage(currentUrl: string, targetUrl: string): boolean {
  const current = parseNavigationUrl(currentUrl);
  const target = parseNavigationUrl(targetUrl);
  if (current.pathname !== target.pathname) return false;

  if (!target.searchParams.size) {
    if (target.pathname !== "/analytics") return current.searchParams.size === 0;
    return parseAnalyticsSection(current.searchParams.get("section")) === "overview";
  }

  return [...target.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
}

/** Returns true for a route or its child path, while allowing query filters on the current route. */
export function isActiveNavRoute(currentUrl: string, targetUrl: string): boolean {
  const current = parseNavigationUrl(currentUrl);
  const target = parseNavigationUrl(targetUrl);
  if (current.pathname !== target.pathname && !current.pathname.startsWith(`${target.pathname}/`)) return false;
  if (!target.searchParams.size) return true;
  return [...target.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
}

/** Preserves analytics scope filters when entering a contextual child route. */
export function navItemHref(item: AppNavItem, currentUrl: string): string {
  if (item.id !== "forecast") return item.url;
  return analyticsSectionHref("forecast", parseNavigationUrl(currentUrl));
}

export function safeInternalPath(path: unknown, fallback = "/dashboard"): string {
  if (typeof path !== "string" || /[\u0000-\u001f\u007f\\]/.test(path)) {
    return fallback;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return fallback;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return fallback;
  try {
    const trustedBase = new URL("https://label-suite.internal");
    const resolved = new URL(decoded, trustedBase);
    if (!decoded.startsWith("/") || decoded.startsWith("//") || resolved.origin !== trustedBase.origin) return fallback;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}
