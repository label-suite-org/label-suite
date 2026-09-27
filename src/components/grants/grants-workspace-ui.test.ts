import { describe, expect, it } from "vitest";
import {
  applicationMatchesFilter,
  buildWorkspaceSummary,
  getApplicationReadiness,
  getProjectProgress,
  opportunityMatchesQuery,
  sortCalendarEvents,
  safeWorkspaceHref,
  type GrantsWorkspacePayload,
} from "./grants-workspace-ui";

const workspace: GrantsWorkspacePayload = {
  projects: [
    {
      id: "project-1",
      name: "True Blue — Fountain music video",
      status: "active",
      priority: "high",
      artistName: "True Blue",
      releaseTitle: "Fountain",
      ownerName: "Malthe",
      currency: "DKK",
      totalBudget: 200_000,
      confirmedFunding: 50_000,
      pendingFunding: 75_000,
      remainingGap: 150_000,
      targetDate: "2026-10-01",
      goal: "Complete and release the Fountain music video.",
      nextAction: "Confirm director treatment",
      nextActionDue: "2026-07-20",
      needs: [],
      applicationIds: ["application-1"],
      assetReadiness: { ready: 2, total: 4, missing: 2, stale: 0 },
      topMatch: null,
    },
  ],
  applications: [
    {
      id: "application-1",
      name: "Fountain video — KODA Kultur",
      projectId: "project-1",
      projectName: "True Blue — Fountain music video",
      opportunityId: "opportunity-1",
      opportunityName: "KODA Kultur",
      ownerName: "Malthe",
      workflowStage: "writing",
      outcome: "unknown",
      priority: "high",
      currency: "DKK",
      amountRequested: 75_000,
      amountAwarded: 0,
      nextAction: "Finish project description",
      nextActionDue: "2026-07-18",
      applicationDeadline: "2026-08-01",
      submittedAt: null,
      decisionDate: null,
      reportingDue: null,
      assetReadiness: { ready: 2, total: 4, missing: 1, stale: 1 },
    },
  ],
  opportunities: [
    {
      id: "opportunity-1",
      name: "KODA Kultur",
      funder: "KODA",
      program: "Cultural projects",
      purposes: ["video", "content"],
      applicantType: "Music companies",
      status: "open",
      researchStatus: "verified",
      researchSummary: "Strong fit for audiovisual work.",
      deadline: "2026-08-01",
      opensOn: null,
      maxAmount: 100_000,
      currency: "DKK",
      requirements: "Project description and budget",
      officialUrl: "https://example.com",
      lastVerifiedAt: "2026-07-10",
      matchReasons: ["Video purpose overlap", "Amount fits the programme"],
      matchingProjectIds: ["project-1"],
    },
  ],
  assets: [],
  calendarEvents: [],
};

describe("grants workspace UI model", () => {
  it("keeps pending applications out of confirmed funding progress", () => {
    expect(getProjectProgress(workspace.projects[0])).toEqual({
      confirmedPercent: 25,
      pendingPercent: 38,
    });
  });

  it("reports missing and stale materials as submission blockers", () => {
    expect(getApplicationReadiness(workspace.applications[0])).toEqual({
      label: "2 need attention",
      tone: "attention",
    });
  });

  it("filters applications by workflow stage independently of outcome", () => {
    expect(applicationMatchesFilter(workspace.applications[0], "writing")).toBe(true);
    expect(applicationMatchesFilter(workspace.applications[0], "closed")).toBe(false);
  });

  it("scopes My actions to the signed-in owner name", () => {
    const application = workspace.applications[0];
    expect(applicationMatchesFilter(application, "my_actions", "2026-07-12", "malthe")).toBe(true);
    expect(applicationMatchesFilter(application, "my_actions", "2026-07-12", "Someone else")).toBe(false);
    expect(applicationMatchesFilter(application, "my_actions", "2026-07-12", null)).toBe(false);
  });

  it("finds opportunities by funder, programme, purpose, or project match", () => {
    const opportunity = workspace.opportunities[0];
    expect(opportunityMatchesQuery(opportunity, "koda", workspace.projects)).toBe(true);
    expect(opportunityMatchesQuery(opportunity, "fountain", workspace.projects)).toBe(true);
    expect(opportunityMatchesQuery(opportunity, "tour support", workspace.projects)).toBe(false);
  });

  it("sorts dated work chronologically and places undated work last", () => {
    const sorted = sortCalendarEvents([
      { id: "3", kind: "decision", title: "Decision", context: null, date: null, status: null, href: null },
      { id: "2", kind: "deadline", title: "Later", context: null, date: "2026-08-10", status: null, href: null },
      { id: "1", kind: "action", title: "Sooner", context: null, date: "2026-07-20", status: null, href: null },
    ]);
    expect(sorted.map((event) => event.id)).toEqual(["1", "2", "3"]);
  });

  it("only allows internal paths and https links in workspace anchors", () => {
    expect(safeWorkspaceHref("/documents/doc-1")).toBe("/documents/doc-1");
    expect(safeWorkspaceHref("https://example.com/grant")).toBe("https://example.com/grant");
    expect(safeWorkspaceHref("http://example.com/grant")).toBeNull();
    expect(safeWorkspaceHref("javascript:alert(1)")).toBeNull();
    expect(safeWorkspaceHref("//evil.example/grant")).toBeNull();
  });

  it("summarizes the workspace without mixing currencies", () => {
    const summary = buildWorkspaceSummary(workspace);
    expect(summary.fundingByCurrency).toEqual([
      { currency: "DKK", confirmed: 50_000, pending: 75_000, gap: 150_000 },
    ]);
    expect(summary.activeApplications).toBe(1);
    expect(summary.materialsNeedingAttention).toBe(2);
  });

  it("only counts future grant deadlines in the summary", () => {
    const summary = buildWorkspaceSummary({
      ...workspace,
      calendarEvents: [
        { id: "past", kind: "deadline", title: "Past", context: null, date: "2026-07-01", status: null, href: null },
        { id: "future", kind: "deadline", title: "Future", context: null, date: "2026-08-01", status: null, href: null },
      ],
    }, "2026-07-12");
    expect(summary.upcomingDeadlines).toBe(1);
  });

});
