import { describe, expect, it } from "vitest";
import {
  buildMasterPayoutPreview,
  buildRoyaltiesDashboard,
  formatRoyaltiesPayoutCsv,
  MASTER_PAYOUT_CAVEAT,
  type RoyaltiesDashboardRevenueRow,
  type RoyaltiesDashboardRoleRow,
} from "./royalties-dashboard-core";

function revenueRow(overrides: Partial<RoyaltiesDashboardRevenueRow> = {}): RoyaltiesDashboardRevenueRow {
  return {
    id: crypto.randomUUID(),
    recordName: "Safe Track [Main] (EPAY)",
    statementId: "stem-1",
    statementPeriod: "2026-01",
    source: "STEM",
    netRevenue: 100,
    paidOut: "unpaid",
    revenueType: "streaming",
    workId: "work-safe",
    trackId: null,
    workTitle: "Safe Track [Main]",
    ...overrides,
  };
}

function roleRow(overrides: Partial<RoyaltiesDashboardRoleRow> = {}): RoyaltiesDashboardRoleRow {
  return {
    workId: "work-safe",
    contactId: "contact-a",
    contactName: "Alice",
    ownershipType: "Rights",
    scope: "Master",
    role: "Producer",
    percentShare: 100,
    ...overrides,
  };
}

describe("royalties dashboard core", () => {
  it("rounds only final totals instead of rounding each ledger row before summing", () => {
    const revenueRows = [
      revenueRow({ netRevenue: 0.335 }),
      revenueRow({
        id: "row-2",
        recordName: "Second Track [Main] (EPAY)",
        workTitle: "Second Track [Main]",
        workId: "work-second",
        netRevenue: 0.335,
      }),
      revenueRow({
        id: "row-3",
        recordName: "Mechanical Track (MPAY)",
        workTitle: "Mechanical Track",
        workId: "work-mechanical",
        netRevenue: 0.335,
        revenueType: "mechanical",
      }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", percentShare: 100 }),
      roleRow({ workId: "work-second", contactId: "contact-b", contactName: "Bob", percentShare: 100 }),
      roleRow({ workId: "work-mechanical", contactId: "contact-c", contactName: "Carol", percentShare: 100 }),
    ];

    const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);

    expect(dashboard.summary).toMatchObject({
      totalNet: 1.01,
      unpaidNet: 1.01,
      payablePreviewNet: 0.67,
      blockedNet: 0,
      mechanicalRows: 1,
      mechanicalNet: 0.34,
      readyToPay: true,
    });

    expect(dashboard.statementRuns).toEqual([
      expect.objectContaining({
        statementId: "stem-1",
        net: 1.01,
        payablePreviewNet: 0.67,
        streamingNet: 0.67,
        mechanicalNet: 0.34,
        status: "ready",
      }),
    ]);
  });

  it("derives payability, statement runs, top tracks, and split blockers from ledger rows", () => {
    const revenueRows = [
      revenueRow(),
      revenueRow({
        recordName: "Over Track [Main] (EPAY)",
        workTitle: "Over Track [Main]",
        workId: "work-over",
        statementPeriod: "2026-02",
        netRevenue: 50,
      }),
      revenueRow({
        recordName: "No Master [Main] (EPAY)",
        workTitle: "No Master [Main]",
        workId: "work-missing",
        statementPeriod: "2026-02",
        netRevenue: 25,
      }),
      revenueRow({
        recordName: "Mechanical Track (MPAY)",
        workTitle: "Mechanical Track",
        workId: "work-mechanical",
        statementPeriod: "2026-03",
        netRevenue: 5,
        revenueType: "mechanical",
      }),
      revenueRow({
        recordName: "Already Paid (EPAY)",
        workTitle: "Already Paid",
        workId: "work-paid",
        statementPeriod: "2026-01",
        netRevenue: 10,
        paidOut: "paid",
      }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", percentShare: 60 }),
      roleRow({ workId: "work-safe", contactId: "bob", contactName: "Bob", role: "Artist", percentShare: 40 }),
      roleRow({ workId: "work-over", contactId: "carol", contactName: "Carol", percentShare: 150 }),
      roleRow({ workId: "work-mechanical", contactId: "dave", contactName: "Dave", percentShare: 100 }),
      roleRow({ workId: "work-paid", contactId: "erin", contactName: "Erin", percentShare: 100 }),
    ];

    const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);

    expect(dashboard.summary).toMatchObject({
      totalNet: 190,
      unpaidNet: 180,
      payablePreviewNet: 100,
      blockedNet: 75,
      mechanicalNet: 5,
      mechanicalRows: 1,
      rowCount: 5,
      statementCount: 1,
      workMatchedRows: 5,
      trackMatchedRows: 0,
      splitIssueCount: 2,
      readyToPay: false,
    });

    expect(dashboard.statementRuns).toEqual([
      expect.objectContaining({
        statementId: "stem-1",
        firstPeriod: "2026-01",
        lastPeriod: "2026-03",
        rows: 5,
        net: 190,
        payablePreviewNet: 100,
        blockedNet: 75,
        mechanicalNet: 5,
        splitIssueCount: 2,
        status: "blocked",
      }),
    ]);

    expect(dashboard.splitIssues).toEqual([
      expect.objectContaining({
        title: "Over Track [Main]",
        unpaidNet: 50,
        masterRoleCount: 1,
        masterPct: 150,
        issueType: "over_allocated",
      }),
      expect.objectContaining({
        title: "No Master [Main]",
        unpaidNet: 25,
        masterRoleCount: 0,
        masterPct: 0,
        issueType: "no_master_roles",
      }),
    ]);

    expect(dashboard.topTracks.slice(0, 3)).toEqual([
      expect.objectContaining({ title: "Safe Track [Main]", net: 100, percentOfTotal: 52.63 }),
      expect.objectContaining({ title: "Over Track [Main]", net: 50, percentOfTotal: 26.32 }),
      expect.objectContaining({ title: "No Master [Main]", net: 25, percentOfTotal: 13.16 }),
    ]);
  });

  it("builds a master-only payout preview from valid rows and ignores publishing, credit, blocked, and mechanical lines", () => {
    const revenueRows = [
      revenueRow(),
      revenueRow({
        recordName: "Over Track [Main] (EPAY)",
        workTitle: "Over Track [Main]",
        workId: "work-over",
        netRevenue: 50,
      }),
      revenueRow({
        recordName: "Mechanical Track (MPAY)",
        workTitle: "Mechanical Track",
        workId: "work-mechanical",
        netRevenue: 5,
        revenueType: "mechanical",
      }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", percentShare: 60, role: "Producer" }),
      roleRow({ workId: "work-safe", contactId: "bob", contactName: "Bob", percentShare: 40, role: "Artist" }),
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", scope: "Publishing", percentShare: 50, role: "Writer" }),
      roleRow({ workId: "work-safe", contactId: "ghost", contactName: "Ghost", ownershipType: "Credit", percentShare: 50, role: "Video" }),
      roleRow({ workId: "work-over", contactId: "carol", contactName: "Carol", percentShare: 150, role: "Artist" }),
      roleRow({ workId: "work-mechanical", contactId: "dave", contactName: "Dave", percentShare: 100, role: "Producer" }),
    ];

    const preview = buildMasterPayoutPreview(revenueRows, roleRows);

    expect(preview.caveat).toBe(MASTER_PAYOUT_CAVEAT);
    expect(preview.readyToPay).toBe(false);
    expect(preview.blockedNet).toBe(50);
    expect(preview.mechanicalNet).toBe(5);
    expect(preview.totalOwed).toBe(100);
    expect(preview.contacts).toEqual([
      expect.objectContaining({
        contact_id: "alice",
        contact_name: "Alice",
        master_owed: 60,
        total_owed: 60,
        line_count: 1,
      }),
      expect.objectContaining({
        contact_id: "bob",
        contact_name: "Bob",
        master_owed: 40,
        total_owed: 40,
        line_count: 1,
      }),
    ]);
    expect(preview.contacts.flatMap((contact) => contact.lines)).toEqual([
      expect.objectContaining({
        contact_id: "alice",
        work_title: "Safe Track [Main]",
        statement_period: "2026-01",
        role: "Producer",
        percent_share: 60,
        amount_owed: 60,
      }),
      expect.objectContaining({
        contact_id: "bob",
        work_title: "Safe Track [Main]",
        statement_period: "2026-01",
        role: "Artist",
        percent_share: 40,
        amount_owed: 40,
      }),
    ]);
  });

  it("blocks rows with missing payee contacts so payout preview reconciles with payable preview", () => {
    const revenueRows = [
      revenueRow(),
      revenueRow({
        id: "row-missing-payee",
        recordName: "Split Missing Contact [Main] (EPAY)",
        workTitle: "Split Missing Contact [Main]",
        workId: "work-missing-payee",
        netRevenue: 80,
      }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", percentShare: 60 }),
      roleRow({ workId: "work-safe", contactId: "bob", contactName: "Bob", role: "Artist", percentShare: 40 }),
      roleRow({ workId: "work-missing-payee", contactId: "carol", contactName: "Carol", percentShare: 75 }),
      roleRow({ workId: "work-missing-payee", contactId: null, contactName: null, role: "Producer", percentShare: 25 }),
    ];

    const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);
    const preview = buildMasterPayoutPreview(revenueRows, roleRows);

    expect(dashboard.summary).toMatchObject({
      totalNet: 180,
      unpaidNet: 180,
      payablePreviewNet: 100,
      blockedNet: 80,
      splitIssueCount: 1,
      readyToPay: false,
    });

    expect(dashboard.splitIssues).toEqual([
      expect.objectContaining({
        title: "Split Missing Contact [Main]",
        unpaidNet: 80,
        masterRoleCount: 2,
        masterPct: 100,
        issueType: "missing_payee_contact",
      }),
    ]);

    expect(preview.blockedNet).toBe(80);
    expect(preview.totalOwed).toBe(100);
    expect(preview.contacts).toEqual([
      expect.objectContaining({ contact_id: "alice", total_owed: 60 }),
      expect.objectContaining({ contact_id: "bob", total_owed: 40 }),
    ]);
  });

  it("reconciles per-row payout rounding so preview totals equal payable net", () => {
    const revenueRows = [
      revenueRow({ netRevenue: 0.05 }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", percentShare: 50, role: "Producer" }),
      roleRow({ workId: "work-safe", contactId: "bob", contactName: "Bob", percentShare: 50, role: "Artist" }),
    ];

    const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);
    const preview = buildMasterPayoutPreview(revenueRows, roleRows);

    expect(dashboard.summary.payablePreviewNet).toBe(0.05);
    expect(preview.totalOwed).toBe(0.05);
    expect(preview.contacts).toEqual([
      expect.objectContaining({ contact_id: "alice", total_owed: 0.03 }),
      expect.objectContaining({ contact_id: "bob", total_owed: 0.02 }),
    ]);
  });

  it("reconciles payable + blocked + mechanical totals from raw fractional-cent accumulators", () => {
    const revenueRows = [
      revenueRow({ netRevenue: 0.33 }),
      revenueRow({
        id: "row-blocked-over",
        recordName: "Blocked Over [Main] (EPAY)",
        workTitle: "Blocked Over [Main]",
        workId: "work-over",
        netRevenue: 0.335,
      }),
      revenueRow({
        id: "row-blocked-missing",
        recordName: "Blocked Missing [Main] (EPAY)",
        workTitle: "Blocked Missing [Main]",
        workId: "work-missing",
        netRevenue: 0.335,
      }),
      revenueRow({
        id: "row-mechanical",
        recordName: "Mechanical Track (MPAY)",
        workTitle: "Mechanical Track",
        workId: "work-mechanical",
        netRevenue: 0.01,
        revenueType: "mechanical",
      }),
    ];

    const roleRows = [
      roleRow({ workId: "work-safe", contactId: "alice", contactName: "Alice", percentShare: 100 }),
      roleRow({ workId: "work-over", contactId: "bob", contactName: "Bob", percentShare: 150 }),
      roleRow({ workId: "work-mechanical", contactId: "carol", contactName: "Carol", percentShare: 100 }),
    ];

    const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);
    const preview = buildMasterPayoutPreview(revenueRows, roleRows);

    expect(dashboard.summary).toMatchObject({
      totalNet: 1.01,
      payablePreviewNet: 0.33,
      blockedNet: 0.67,
      mechanicalNet: 0.01,
    });
    expect(dashboard.statementRuns).toEqual([
      expect.objectContaining({
        statementId: "stem-1",
        net: 1.01,
        payablePreviewNet: 0.33,
        blockedNet: 0.67,
        mechanicalNet: 0.01,
      }),
    ]);
    expect(preview.blockedNet).toBe(0.67);

    expect(round2ForTest(dashboard.summary.payablePreviewNet + dashboard.summary.blockedNet + dashboard.summary.mechanicalNet)).toBe(dashboard.summary.totalNet);
    expect(round2ForTest(dashboard.statementRuns[0].payablePreviewNet + dashboard.statementRuns[0].blockedNet + dashboard.statementRuns[0].mechanicalNet)).toBe(dashboard.statementRuns[0].net);
  });

  it("exports payout preview CSV with the accountant-facing columns", () => {
    const csv = formatRoyaltiesPayoutCsv([
      {
        contact_id: "alice",
        contact_name: "Alice, Inc.",
        work_id: "work-safe",
        work_title: "Safe \"Track\"",
        statement_period: "2026-01",
        source: "STEM",
        net_revenue: 100,
        role: "Producer",
        percent_share: 60,
        amount_owed: 60,
        payment_status: "preview",
      },
    ]);

    expect(csv).toContain("contact_id,contact_name,work_id,work_title,statement_period,source,net_revenue,role,percent_share,amount_owed,payment_status");
    expect(csv).toContain('alice,"Alice, Inc.",work-safe,"Safe ""Track""",2026-01,STEM,100,Producer,60,60,preview');
  });
});

function round2ForTest(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
