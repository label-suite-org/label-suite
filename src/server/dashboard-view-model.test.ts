import { describe, expect, it } from "vitest";
import { defaultDashboardPreferences } from "../lib/dashboard-preferences";
import type { DashboardPreferences } from "../lib/dashboard-preferences";
import { buildPersonalDashboardModel } from "./dashboard-view-model";

const input = {
  artistCount: 1,
  analyticsHasData: true,
  releaseRows: [{ id: "r1", title: "Fountain", artist_name: "True Blue", release_date: "2026-09-01", status: "scheduled", release_missing: "Cover art" }],
  attentionBugs: [{ id: "b1", title: "Track missing audio", description: 'Track "Fountain [Main]" has no audio file.', priority: "P0", source_table: "tracks", updated_at: "2026-08-12" }],
  attentionTasks: [
    { id: "t1", task_name: "Approve distributor delivery", priority: "P1", owner: "Malthe", due_date: "2026-08-11", next_action: null, is_overdue: true, artist_name: "True Blue", release_title: "Fountain" },
    { id: "t2", task_name: "Prepare release notes", priority: "P2", owner: null, due_date: "2026-08-15", next_action: null, is_overdue: false, artist_name: null, release_title: "Fountain" },
  ],
  unpaidRows: [{ id: "u1", record_name: "January statement", statement_period: "2026-01", source: "Stem", net_revenue: 120, artist_name: "True Blue", release_title: "Fountain" }],
  fundingRows: [{ currency: "USD", confirmed: "231500", gap: "0", pipelineWeighted: "30000", confirmedRecordCount: 2, projectCount: 1 }],
  analyticsRows: [{ key: "overnight-change", title: "Streams increased", detail: "Up 8%", metric: "+8%", linkUrl: "/analytics", tone: "good" }],
  readyReleaseCount: 2,
  releaseCount: 15,
  openBugCount: 125,
  totalNetRevenue: "6799.67",
  unpaidStatements: 140,
  openTaskCount: 23,
  analyticsHealthy: true,
  analyticsLastSeenAt: "2026-08-29T12:00:00.000Z",
};

describe("personal dashboard view model", () => {
  it("ranks specific actions and never returns more than five", () => {
    const model = buildPersonalDashboardModel(input, defaultDashboardPreferences());
    expect(model.attention).toHaveLength(5);
    expect(model.attention[0]).toMatchObject({ title: "Approve distributor delivery", domain: "Task" });
    expect(model.attention[1]).toMatchObject({ title: "Audio file missing", subject: "Fountain [Main]" });
    expect(model.attention[2]).toMatchObject({ title: "Fountain", domain: "Release" });
  });

  it("surfaces degraded analytics with data age and an explicit next action", () => {
    const model = buildPersonalDashboardModel({
      ...input,
      analyticsHealthy: false,
      analyticsRows: [{ key: "analytics-data-health", title: "Analytics data health needs attention", detail: "Sisense evidence is stale.", metric: null, linkUrl: "/analytics#analytics-data-health" }],
    }, defaultDashboardPreferences());
    const analytics = model.attention.find((row) => row.domain === "Analytics");

    expect(analytics).toMatchObject({ action: "Review analytics data health", urgency: "warning", href: "/analytics?section=data-health#analytics-data-health" });
    expect(analytics?.meta).toContain("Analytics updated");
  });

  it("keeps distinct action categories visible when one queue is crowded", () => {
    const crowdedTasks = Array.from({ length: 8 }, (_, index) => ({
      ...input.attentionTasks[0],
      id: `crowded-task-${index}`,
      task_name: `Overdue task ${index + 1}`,
    }));
    const model = buildPersonalDashboardModel(
      { ...input, attentionTasks: crowdedTasks },
      defaultDashboardPreferences(),
    );

    expect(model.attention).toHaveLength(5);
    expect(new Set(model.attention.map((item) => item.domain))).toEqual(
      new Set(["Task", "Release", "Catalog", "Royalty"]),
    );
  });

  it("returns only selected indicators in personal order", () => {
    const preferences: DashboardPreferences = { ...defaultDashboardPreferences(), pinnedIndicatorIds: ["net_revenue", "release_readiness"] };
    expect(buildPersonalDashboardModel(input, preferences).indicators.map((item) => item.id)).toEqual(["net_revenue", "release_readiness"]);
  });

  it("returns visible sections in personal order and caps rows at three", () => {
    const preferences: DashboardPreferences = {
      ...defaultDashboardPreferences(),
      sectionOrder: ["funding", "analytics", "tasks", "catalog", "releases", "royalties"],
      hiddenSectionIds: ["catalog", "royalties"],
    };
    const model = buildPersonalDashboardModel(input, preferences);
    expect(model.sections.map((section) => section.id)).toEqual(["funding", "analytics", "tasks", "releases"]);
    expect(model.sections.every((section) => section.rows.length <= 3)).toBe(true);
  });

  it("uses consistent item context in attention and section rows", () => {
    const model = buildPersonalDashboardModel(
      input,
      { ...defaultDashboardPreferences(), hiddenSectionIds: [] },
    );
    const taskAttention = model.attention.find((row) => row.id === "task:t1");
    const taskSection = model.sections.find((section) => section.id === "tasks")?.rows[0];
    const royaltyAttention = model.attention.find((row) => row.id === "royalty:u1");
    const royaltySection = model.sections.find((section) => section.id === "royalties")?.rows[0];

    expect(taskAttention?.detail).toBe(taskSection?.detail);
    expect(royaltyAttention?.detail).toBe(royaltySection?.detail);
  });

  it("keeps the funding section renderable when stored currency metadata is unsupported", () => {
    const model = buildPersonalDashboardModel(
      {
        ...input,
        fundingRows: [{ ...input.fundingRows[0], currency: "NOT_A_CURRENCY" }],
      },
      { ...defaultDashboardPreferences(), hiddenSectionIds: [] },
    );
    const funding = model.sections.find((section) => section.id === "funding");

    expect(funding?.summary).toBe("1 currencies");
    expect(funding?.rows[0]).toMatchObject({
      title: "NOT_A_CURRENCY",
      detail: expect.stringContaining("NOT_A_CURRENCY"),
    });
  });
});

it("guides an empty workspace without inventing readiness and graduates when work exists", () => {
  const empty = { ...input, artistCount: 0, analyticsHasData: false, analyticsHealthy: false, releaseRows: [], releaseCount: 0, readyReleaseCount: 0, attentionBugs: [], openBugCount: 0, attentionTasks: [], openTaskCount: 0, unpaidRows: [], unpaidStatements: 0, totalNetRevenue: 0, fundingRows: [], analyticsRows: [] };
  const model = buildPersonalDashboardModel(empty, defaultDashboardPreferences());
  expect(model.setup).toEqual({ hasArtists: false });
  expect(model.indicators.find((item) => item.id === "release_readiness")).toMatchObject({ value: "—", detail: "No releases yet" });
  expect(buildPersonalDashboardModel({ ...empty, artistCount: 1 }, defaultDashboardPreferences()).setup).toEqual({ hasArtists: true });
  expect(buildPersonalDashboardModel({ ...empty, releaseCount: 1 }, defaultDashboardPreferences()).setup).toBeNull();
  expect(buildPersonalDashboardModel({ ...empty, openTaskCount: 1 }, defaultDashboardPreferences()).setup).toBeNull();
  expect(buildPersonalDashboardModel({ ...empty, analyticsRows: input.analyticsRows }, defaultDashboardPreferences()).setup).toBeNull();
});
