import type { DashboardIndicatorId, DashboardPreferences, DashboardSectionId } from "../lib/dashboard-preferences";
import type { TodayHubCard } from "./analytics";
import { presentCatalogIssue, summarizeReleaseBlockers } from "./dashboard-presentation";

type ReleaseDashboardInput = {
  id: string;
  title: string;
  release_missing: string | null;
  artist_name: string | null;
};

type CatalogDashboardInput = {
  id: string;
  title: string;
  description: string | null;
  source_table: string | null;
  priority: string | null;
};

type TaskDashboardInput = {
  id: string;
  task_name: string;
  next_action: string | null;
  release_title: string | null;
  artist_name: string | null;
  due_date: Date | string | null;
  is_overdue: boolean;
};

type RoyaltyDashboardInput = {
  id: string;
  record_name: string;
  source: string | null;
  net_revenue: number | string | null;
  artist_name: string | null;
  release_title: string | null;
};

type FundingDashboardInput = {
  currency: string;
  confirmed: number | string;
  gap: number | string;
  pipelineWeighted: number | string;
  confirmedRecordCount: number;
  projectCount: number;
};

type AnalyticsDashboardInput = Pick<TodayHubCard, "key" | "title" | "detail" | "metric" | "linkUrl">;

export interface DashboardRow {
  id: string;
  title: string;
  detail: string;
  meta?: string;
  href: string;
}

export interface DashboardAttention extends DashboardRow {
  action: string;
  domain: string;
  subject?: string | null;
  urgency: "critical" | "warning" | "normal";
}

export interface DashboardIndicator {
  id: DashboardIndicatorId;
  label: string;
  value: string;
  detail: string;
  href: string;
}

export interface DashboardSection {
  id: DashboardSectionId;
  title: string;
  summary: string;
  href: string;
  rows: DashboardRow[];
}

export interface PersonalDashboardModel {
  setup: { hasArtists: boolean } | null;
  attention: DashboardAttention[];
  indicators: DashboardIndicator[];
  sections: DashboardSection[];
  allIndicators: DashboardIndicator[];
  allSections: DashboardSection[];
}

export interface PersonalDashboardInput {
  artistCount: number;
  analyticsHasData: boolean;
  releaseRows: ReleaseDashboardInput[];
  attentionBugs: CatalogDashboardInput[];
  attentionTasks: TaskDashboardInput[];
  unpaidRows: RoyaltyDashboardInput[];
  fundingRows: FundingDashboardInput[];
  analyticsRows: AnalyticsDashboardInput[];
  readyReleaseCount: number;
  releaseCount: number;
  openBugCount: number;
  totalNetRevenue: number | string;
  unpaidStatements: number;
  openTaskCount: number;
  analyticsHealthy: boolean;
  analyticsLastSeenAt: Date | string | null;
}

export function buildPersonalDashboardModel(
  input: PersonalDashboardInput,
  preferences: DashboardPreferences,
): PersonalDashboardModel {
  const indicators = indicatorRegistry(input);
  const sections = sectionRegistry(input);
  return {
    setup: input.releaseCount === 0 && input.openTaskCount === 0 && input.openBugCount === 0
      && input.unpaidStatements === 0 && Number(input.totalNetRevenue) === 0
      && input.fundingRows.length === 0 && !input.analyticsHasData && input.analyticsRows.length === 0
      ? { hasArtists: input.artistCount > 0 } : null,
    attention: selectAttentionRows(attentionRows(input)),
    indicators: preferences.pinnedIndicatorIds.map((id) => indicators[id]),
    sections: preferences.sectionOrder
      .filter((id) => !preferences.hiddenSectionIds.includes(id))
      .map((id) => sections[id]),
    allIndicators: Object.values(indicators),
    allSections: Object.values(sections),
  };
}

function selectAttentionRows(rows: Array<DashboardAttention & { rank: number }>): DashboardAttention[] {
  const ranked = [...rows].sort((a, b) => a.rank - b.rank);
  const firstByDomain: Array<DashboardAttention & { rank: number }> = [];
  const remaining: Array<DashboardAttention & { rank: number }> = [];
  const representedDomains = new Set<string>();

  for (const row of ranked) {
    if (representedDomains.has(row.domain)) {
      remaining.push(row);
    } else {
      representedDomains.add(row.domain);
      firstByDomain.push(row);
    }
  }

  return [...firstByDomain, ...remaining]
    .slice(0, 5)
    .map(({ rank: _, ...row }) => row);
}

function attentionRows(input: PersonalDashboardInput): Array<DashboardAttention & { rank: number }> {
  const tasks = input.attentionTasks.map((task) => ({
    ...presentTaskRow(task),
    id: `task:${task.id}`,
    action: task.next_action ?? "Open the task and set its next action",
    detail: [task.artist_name, task.release_title].filter(Boolean).join(" · ") || "Operational task",
    meta: task.due_date ? `${task.is_overdue ? "Overdue" : "Due"} ${formatDate(task.due_date)}` : "No due date",
    domain: "Task",
    urgency: task.is_overdue ? "critical" as const : "normal" as const,
    rank: task.is_overdue ? 0 : 4,
  }));
  const releases = input.releaseRows.map((release) => {
    const { row, attentionMeta } = presentReleaseRow(release);
    return {
      ...row,
      id: `release:${row.id}`,
      action: "Review readiness and resolve the missing items",
      meta: attentionMeta,
      domain: "Release",
      urgency: "warning" as const,
      rank: 1,
    };
  });
  const catalog = input.attentionBugs.map((bug) => {
    const { row, subject } = presentCatalogRow(bug);
    return {
      ...row,
      id: `catalog:${row.id}`,
      action: "Review the catalog issue and confirm the correction",
      subject,
      meta: bug.priority ?? "P2",
      domain: "Catalog",
      urgency: bug.priority === "P0" ? "critical" as const : "warning" as const,
      rank: bug.priority === "P0" ? 0 : bug.priority === "P1" ? 2 : 5,
    };
  });
  const royalties = input.unpaidRows.map((royalty) => {
    const row = presentRoyaltyRow(royalty);
    return {
      ...row,
      id: `royalty:${row.id}`,
      action: "Review the statement and confirm its payment status",
      meta: `${formatMoney(royalty.net_revenue)} unpaid`,
      domain: "Royalty",
      urgency: "warning" as const,
      rank: 3,
    };
  });
  const analyticsHealth = input.analyticsRows.find((row) => row.key === "analytics-data-health");
  const analytics = !input.analyticsHealthy ? [{
    id: "analytics:data-health",
    title: analyticsHealth?.title ?? "Analytics data needs attention",
    detail: analyticsHealth?.detail ?? "Analytics evidence is missing or incomplete.",
    action: "Review analytics data health",
    meta: formatDataAge(input.analyticsLastSeenAt),
    href: "/analytics?section=data-health#analytics-data-health",
    domain: "Analytics",
    urgency: "warning" as const,
    rank: 1,
  }] : [];
  return [...tasks, ...releases, ...catalog, ...royalties, ...analytics];
}

function indicatorRegistry(input: PersonalDashboardInput): Record<DashboardIndicatorId, DashboardIndicator> {
  const readiness = input.releaseCount ? Math.round((input.readyReleaseCount / input.releaseCount) * 100) : 0;
  return {
    release_readiness: { id: "release_readiness", label: "Release readiness", value: input.releaseCount ? `${readiness}%` : "—", detail: input.releaseCount ? `${input.readyReleaseCount}/${input.releaseCount} ready` : "No releases yet", href: "/releases" },
    catalog_issues: { id: "catalog_issues", label: "Catalog issues", value: String(input.openBugCount), detail: "need attention", href: "/today" },
    net_revenue: { id: "net_revenue", label: "Net revenue", value: formatMoney(input.totalNetRevenue), detail: "imported royalty rows", href: "/royalties" },
    unpaid_statements: { id: "unpaid_statements", label: "Unpaid statements", value: String(input.unpaidStatements), detail: "awaiting review", href: "/royalties" },
    due_tasks: { id: "due_tasks", label: "Open tasks", value: String(input.openTaskCount), detail: "sorted by urgency", href: "/ops-tasks" },
    analytics_health: { id: "analytics_health", label: "Analytics", value: !input.analyticsHasData && !input.analyticsRows.length ? "Not set up" : input.analyticsHealthy ? "Current" : "Check data", detail: !input.analyticsHasData ? "No imported data" : formatDataAge(input.analyticsLastSeenAt), href: "/analytics?section=data-health" },
  };
}

function sectionRegistry(input: PersonalDashboardInput): Record<DashboardSectionId, DashboardSection> {
  return {
    releases: {
      id: "releases", title: "Releases", summary: input.releaseCount ? `${input.readyReleaseCount}/${input.releaseCount} ready` : "No releases yet", href: "/releases",
      rows: input.releaseRows.slice(0, 3).map((release) => presentReleaseRow(release).row),
    },
    tasks: {
      id: "tasks", title: "Tasks", summary: `${input.openTaskCount} open`, href: "/ops-tasks",
      rows: input.attentionTasks.slice(0, 3).map(presentTaskRow),
    },
    catalog: {
      id: "catalog", title: "Catalog", summary: `${input.openBugCount} issues`, href: "/today",
      rows: input.attentionBugs.slice(0, 3).map((bug) => presentCatalogRow(bug).row),
    },
    analytics: {
      id: "analytics", title: "Analytics", summary: input.analyticsHealthy ? "Sources current" : "Data needs attention", href: "/analytics",
      rows: input.analyticsRows.slice(0, 3).map((row, index) => ({ id: `analytics-${index}`, title: row.title, detail: row.detail, meta: row.metric ?? undefined, href: row.linkUrl ?? "/analytics" })),
    },
    royalties: {
      id: "royalties", title: "Royalties", summary: `${input.unpaidStatements} unpaid`, href: "/royalties",
      rows: input.unpaidRows.slice(0, 3).map(presentRoyaltyRow),
    },
    funding: {
      id: "funding", title: "Funding", summary: input.fundingRows.length ? `${input.fundingRows.length} currencies` : "No coverage yet", href: "/budget",
      rows: input.fundingRows.slice(0, 3).map((row) => ({ id: row.currency, title: row.currency, detail: `${formatMoney(row.confirmed, row.currency)} confirmed`, meta: `${formatMoney(row.gap, row.currency)} gap`, href: "/budget" })),
    },
  };
}

function presentReleaseRow(release: ReleaseDashboardInput): { row: DashboardRow; attentionMeta: string } {
  const blocker = summarizeReleaseBlockers(release.release_missing);
  return {
    row: {
      id: release.id,
      title: release.title,
      detail: blocker.label,
      meta: release.artist_name ?? undefined,
      href: `/releases/${release.id}`,
    },
    attentionMeta: [release.artist_name, blocker.detail].filter(Boolean).join(" · "),
  };
}

function presentTaskRow(task: TaskDashboardInput): DashboardRow {
  return {
    id: task.id,
    title: task.task_name,
    detail: task.next_action ?? ([task.artist_name, task.release_title].filter(Boolean).join(" · ") || "Open task"),
    meta: task.due_date ? formatDate(task.due_date) : undefined,
    href: "/ops-tasks",
  };
}

function presentCatalogRow(bug: CatalogDashboardInput): { row: DashboardRow; subject: string | null } {
  const issue = presentCatalogIssue({ title: bug.title, description: bug.description, sourceTable: bug.source_table });
  return {
    row: {
      id: bug.id,
      title: issue.label,
      detail: issue.subject ? `${issue.kind}: ${issue.subject}` : issue.kind,
      meta: bug.priority ?? undefined,
      href: "/today",
    },
    subject: issue.subject,
  };
}

function presentRoyaltyRow(royalty: RoyaltyDashboardInput): DashboardRow {
  return {
    id: royalty.id,
    title: royalty.record_name,
    detail: [royalty.artist_name, royalty.release_title, royalty.source].filter(Boolean).join(" · ") || "Unlinked statement",
    meta: formatMoney(royalty.net_revenue),
    href: "/royalties",
  };
}

function formatMoney(value: number | string | null, currency = "USD"): string {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  try {
    return safeAmount.toLocaleString("en-US", { style: "currency", currency, maximumFractionDigits: 2 });
  } catch {
    return `${safeAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`;
  }
}

function formatDate(value: Date | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDataAge(value: Date | string | null): string {
  if (!value) return "No analytics data received";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Analytics date unavailable";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
  if (days === 0) return "Analytics updated today";
  return `Analytics updated ${days} day${days === 1 ? "" : "s"} ago`;
}
