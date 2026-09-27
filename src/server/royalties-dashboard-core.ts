export const MASTER_PAYOUT_CAVEAT = "STEM payouts use Master rights only. Publishing/KODA is separate.";

export type SplitIssueType = "no_work_match" | "no_master_roles" | "missing_payee_contact" | "under_allocated" | "over_allocated";
export type StatementRunStatus = "blocked" | "ready" | "paid";

export interface RoyaltiesDashboardRevenueRow {
  id: string;
  recordName: string;
  statementId: string | null;
  statementPeriod: string | null;
  source: string | null;
  netRevenue: number | null;
  paidOut: string | null;
  revenueType: string | null;
  workId: string | null;
  trackId: string | null;
  workTitle: string | null;
}

export interface RoyaltiesDashboardRoleRow {
  workId: string;
  contactId: string | null;
  contactName: string | null;
  ownershipType: string | null;
  scope: string | null;
  role: string | null;
  percentShare: number | null;
}

export interface RoyaltiesDashboardSummary {
  totalNet: number;
  unpaidNet: number;
  payablePreviewNet: number;
  blockedNet: number;
  rowCount: number;
  statementCount: number;
  workMatchedRows: number;
  trackMatchedRows: number;
  mechanicalRows: number;
  mechanicalNet: number;
  splitIssueCount: number;
  readyToPay: boolean;
}

export interface RoyaltiesStatementRun {
  statementId: string;
  source: string;
  firstPeriod: string | null;
  lastPeriod: string | null;
  rows: number;
  net: number;
  payablePreviewNet: number;
  blockedNet: number;
  workMatchedRows: number;
  trackMatchedRows: number;
  streamingRows: number;
  streamingNet: number;
  mechanicalRows: number;
  mechanicalNet: number;
  splitIssueCount: number;
  status: StatementRunStatus;
}

export interface RoyaltiesSplitIssue {
  workId: string | null;
  title: string;
  unpaidNet: number;
  masterRoleCount: number;
  masterPct: number;
  issueType: SplitIssueType;
}

export interface RoyaltiesTopTrack {
  workId: string | null;
  title: string;
  rows: number;
  net: number;
  percentOfTotal: number;
}

export interface RoyaltiesDashboard {
  summary: RoyaltiesDashboardSummary;
  statementRuns: RoyaltiesStatementRun[];
  splitIssues: RoyaltiesSplitIssue[];
  topTracks: RoyaltiesTopTrack[];
}

export interface RoyaltiesPayoutLine {
  contact_id: string;
  contact_name: string;
  work_id: string | null;
  work_title: string;
  statement_period: string | null;
  source: string | null;
  net_revenue: number;
  role: string;
  percent_share: number;
  amount_owed: number;
  payment_status: string;
}

export interface ContactPayout {
  contact_id: string;
  contact_name: string;
  master_owed: number;
  total_owed: number;
  line_count: number;
  lines: RoyaltiesPayoutLine[];
}

export interface MasterPayoutPreview {
  caveat: string;
  readyToPay: boolean;
  blockedNet: number;
  mechanicalNet: number;
  totalOwed: number;
  contacts: ContactPayout[];
  lines: RoyaltiesPayoutLine[];
}

interface MasterRoleSummary {
  count: number;
  pct: number;
  hasMissingPayeeContact: boolean;
}

interface SplitIssueAccumulator {
  key: string;
  workId: string | null;
  title: string;
  unpaidNet: number;
  masterRoleCount: number;
  masterPct: number;
  issueType: SplitIssueType;
  statementIds: Set<string>;
}

interface StatementRunAccumulator {
  statementId: string;
  sourceSet: Set<string>;
  firstPeriod: string | null;
  lastPeriod: string | null;
  rows: number;
  net: number;
  payablePreviewNet: number;
  blockedNet: number;
  workMatchedRows: number;
  trackMatchedRows: number;
  streamingRows: number;
  streamingNet: number;
  mechanicalRows: number;
  mechanicalNet: number;
  hasUnpaidRows: boolean;
}

export function buildRoyaltiesDashboard(
  revenueRows: RoyaltiesDashboardRevenueRow[],
  roleRows: RoyaltiesDashboardRoleRow[],
): RoyaltiesDashboard {
  const masterRoleMap = buildMasterRoleMap(roleRows);
  const splitIssueMap = new Map<string, SplitIssueAccumulator>();
  const statementRunMap = new Map<string, StatementRunAccumulator>();
  const topTrackMap = new Map<string, RoyaltiesTopTrack>();

  let totalNet = 0;
  let unpaidNet = 0;
  let payablePreviewNet = 0;
  let blockedNet = 0;
  let workMatchedRows = 0;
  let trackMatchedRows = 0;
  let mechanicalRows = 0;
  let mechanicalNet = 0;

  for (const row of revenueRows) {
    const netRevenue = row.netRevenue ?? 0;
    const statementId = row.statementId ?? "unassigned";
    const title = preferTitle(row);
    const workKey = row.workId ?? `unmatched:${title}`;
    const isUnpaid = row.paidOut !== "paid";
    const isMechanical = isMechanicalRevenue(row);
    const roleSummary = row.workId ? masterRoleMap.get(row.workId) : undefined;
    const issue = isUnpaid && !isMechanical ? getSplitIssue(row, roleSummary) : null;
    const isValidPayableRow = isUnpaid && !isMechanical && !issue;

    totalNet += netRevenue;
    if (isUnpaid) unpaidNet += netRevenue;
    if (row.workId) workMatchedRows += 1;
    if (row.trackId) trackMatchedRows += 1;
    if (isMechanical) {
      mechanicalRows += 1;
      if (isUnpaid) mechanicalNet += netRevenue;
    }
    if (isValidPayableRow) payablePreviewNet += netRevenue;

    const statementRun = ensureStatementRun(statementRunMap, statementId);
    statementRun.sourceSet.add(row.source ?? "Unknown");
    statementRun.firstPeriod = minPeriod(statementRun.firstPeriod, row.statementPeriod);
    statementRun.lastPeriod = maxPeriod(statementRun.lastPeriod, row.statementPeriod);
    statementRun.rows += 1;
    statementRun.net += netRevenue;
    statementRun.workMatchedRows += row.workId ? 1 : 0;
    statementRun.trackMatchedRows += row.trackId ? 1 : 0;
    statementRun.hasUnpaidRows = statementRun.hasUnpaidRows || isUnpaid;
    if (isMechanical) {
      statementRun.mechanicalRows += 1;
      if (isUnpaid) statementRun.mechanicalNet += netRevenue;
    } else {
      statementRun.streamingRows += 1;
      statementRun.streamingNet += netRevenue;
    }
    if (isValidPayableRow) {
      statementRun.payablePreviewNet += netRevenue;
    }
    if (issue) {
      blockedNet += netRevenue;
      statementRun.blockedNet += netRevenue;
    }

    const existingTrack = topTrackMap.get(workKey);
    if (existingTrack) {
      existingTrack.rows += 1;
      existingTrack.net += netRevenue;
    } else {
      topTrackMap.set(workKey, {
        workId: row.workId,
        title,
        rows: 1,
        net: netRevenue,
        percentOfTotal: 0,
      });
    }

    if (!issue) continue;

    const issueKey = row.workId ?? `unmatched:${title}`;
    const existingIssue = splitIssueMap.get(issueKey);
    if (existingIssue) {
      existingIssue.unpaidNet += netRevenue;
      existingIssue.statementIds.add(statementId);
    } else {
      splitIssueMap.set(issueKey, {
        key: issueKey,
        workId: row.workId,
        title,
        unpaidNet: netRevenue,
        masterRoleCount: issue.masterRoleCount,
        masterPct: issue.masterPct,
        issueType: issue.issueType,
        statementIds: new Set([statementId]),
      });
    }
  }

  const splitIssues = Array.from(splitIssueMap.values())
    .map((issue) => ({
      workId: issue.workId,
      title: issue.title,
      unpaidNet: round2(issue.unpaidNet),
      masterRoleCount: issue.masterRoleCount,
      masterPct: round2(issue.masterPct),
      issueType: issue.issueType,
    }))
    .sort((a, b) => b.unpaidNet - a.unpaidNet || a.title.localeCompare(b.title));

  const roundedBlockedNet = round2(blockedNet);
  const summary: RoyaltiesDashboardSummary = {
    totalNet: round2(totalNet),
    unpaidNet: round2(unpaidNet),
    payablePreviewNet: round2(payablePreviewNet),
    blockedNet: roundedBlockedNet,
    rowCount: revenueRows.length,
    statementCount: statementRunMap.size,
    workMatchedRows,
    trackMatchedRows,
    mechanicalRows,
    mechanicalNet: round2(mechanicalNet),
    splitIssueCount: splitIssues.length,
    readyToPay: splitIssues.length === 0,
  };

  const statementRuns = Array.from(statementRunMap.values())
    .map((run) => {
      const runSplitIssueCount = Array.from(splitIssueMap.values()).filter((issue) => issue.statementIds.has(run.statementId)).length;
      const status: StatementRunStatus = !run.hasUnpaidRows ? "paid" : runSplitIssueCount > 0 ? "blocked" : "ready";
      return {
        statementId: run.statementId,
        source: formatSource(run.sourceSet),
        firstPeriod: run.firstPeriod,
        lastPeriod: run.lastPeriod,
        rows: run.rows,
        net: round2(run.net),
        payablePreviewNet: round2(run.payablePreviewNet),
        blockedNet: round2(run.blockedNet),
        workMatchedRows: run.workMatchedRows,
        trackMatchedRows: run.trackMatchedRows,
        streamingRows: run.streamingRows,
        streamingNet: round2(run.streamingNet),
        mechanicalRows: run.mechanicalRows,
        mechanicalNet: round2(run.mechanicalNet),
        splitIssueCount: runSplitIssueCount,
        status,
      } satisfies RoyaltiesStatementRun;
    })
    .sort((a, b) => (b.lastPeriod ?? "").localeCompare(a.lastPeriod ?? "") || a.statementId.localeCompare(b.statementId));

  const topTracks = Array.from(topTrackMap.values())
    .map((track) => ({
      ...track,
      net: round2(track.net),
      percentOfTotal: totalNet > 0 ? round2((track.net / totalNet) * 100) : 0,
    }))
    .sort((a, b) => b.net - a.net || a.title.localeCompare(b.title));

  return { summary, statementRuns, splitIssues, topTracks };
}

export function buildMasterPayoutPreview(
  revenueRows: RoyaltiesDashboardRevenueRow[],
  roleRows: RoyaltiesDashboardRoleRow[],
): MasterPayoutPreview {
  const dashboard = buildRoyaltiesDashboard(revenueRows, roleRows);
  const blockedWorkIds = new Set(
    dashboard.splitIssues
      .map((issue) => issue.workId)
      .filter((workId): workId is string => Boolean(workId)),
  );

  const validRoleRows = roleRows.filter((row) => row.ownershipType !== "Credit" && row.scope === "Master" && row.percentShare != null && row.contactId && row.contactName);
  const contactMap = new Map<string, ContactPayout>();
  const lines: RoyaltiesPayoutLine[] = [];

  for (const revenueRow of revenueRows) {
    if (revenueRow.paidOut === "paid" || isMechanicalRevenue(revenueRow) || !revenueRow.workId || blockedWorkIds.has(revenueRow.workId)) {
      continue;
    }

    const matchingRoles = validRoleRows.filter((roleRow) => roleRow.workId === revenueRow.workId);
    if (!matchingRoles.length) continue;

    const workTitle = preferTitle(revenueRow);

    for (const line of buildPayoutLinesForRevenueRow(revenueRow, matchingRoles, workTitle)) {
      lines.push(line);

      const existing = contactMap.get(line.contact_id);
      if (existing) {
        existing.master_owed = round2(existing.master_owed + line.amount_owed);
        existing.total_owed = round2(existing.total_owed + line.amount_owed);
        existing.line_count += 1;
        existing.lines.push(line);
      } else {
        contactMap.set(line.contact_id, {
          contact_id: line.contact_id,
          contact_name: line.contact_name,
          master_owed: line.amount_owed,
          total_owed: line.amount_owed,
          line_count: 1,
          lines: [line],
        });
      }
    }
  }

  const contacts = Array.from(contactMap.values())
    .map((contact) => ({
      ...contact,
      master_owed: round2(contact.master_owed),
      total_owed: round2(contact.total_owed),
      lines: contact.lines.sort((a, b) => b.amount_owed - a.amount_owed || a.work_title.localeCompare(b.work_title)),
    }))
    .sort((a, b) => b.total_owed - a.total_owed || a.contact_name.localeCompare(b.contact_name));

  return {
    caveat: MASTER_PAYOUT_CAVEAT,
    readyToPay: dashboard.summary.readyToPay,
    blockedNet: dashboard.summary.blockedNet,
    mechanicalNet: dashboard.summary.mechanicalNet,
    totalOwed: round2(lines.reduce((sum, line) => sum + line.amount_owed, 0)),
    contacts,
    lines: lines.sort((a, b) => b.amount_owed - a.amount_owed || a.contact_name.localeCompare(b.contact_name)),
  };
}

export function formatRoyaltiesPayoutCsv(lines: RoyaltiesPayoutLine[]): string {
  const headers = [
    "contact_id",
    "contact_name",
    "work_id",
    "work_title",
    "statement_period",
    "source",
    "net_revenue",
    "role",
    "percent_share",
    "amount_owed",
    "payment_status",
  ];

  const rows = [headers.join(",")];
  for (const line of lines) {
    rows.push(headers.map((header) => csvEscape(line[header as keyof RoyaltiesPayoutLine])).join(","));
  }
  return rows.join("\r\n");
}

function ensureStatementRun(map: Map<string, StatementRunAccumulator>, statementId: string): StatementRunAccumulator {
  const existing = map.get(statementId);
  if (existing) return existing;

  const created: StatementRunAccumulator = {
    statementId,
    sourceSet: new Set<string>(),
    firstPeriod: null,
    lastPeriod: null,
    rows: 0,
    net: 0,
    payablePreviewNet: 0,
    blockedNet: 0,
    workMatchedRows: 0,
    trackMatchedRows: 0,
    streamingRows: 0,
    streamingNet: 0,
    mechanicalRows: 0,
    mechanicalNet: 0,
    hasUnpaidRows: false,
  };
  map.set(statementId, created);
  return created;
}

function buildMasterRoleMap(roleRows: RoyaltiesDashboardRoleRow[]): Map<string, MasterRoleSummary> {
  const map = new Map<string, MasterRoleSummary>();

  for (const row of roleRows) {
    if (row.ownershipType === "Credit" || row.scope !== "Master" || row.percentShare == null) continue;
    const hasMissingPayeeContact = !row.contactId || !row.contactName;
    const existing = map.get(row.workId);
    if (existing) {
      existing.count += 1;
      existing.pct += row.percentShare;
      existing.hasMissingPayeeContact = existing.hasMissingPayeeContact || hasMissingPayeeContact;
    } else {
      map.set(row.workId, { count: 1, pct: row.percentShare, hasMissingPayeeContact });
    }
  }

  return map;
}

function buildPayoutLinesForRevenueRow(
  revenueRow: RoyaltiesDashboardRevenueRow,
  matchingRoles: RoyaltiesDashboardRoleRow[],
  workTitle: string,
): RoyaltiesPayoutLine[] {
  const netRevenue = round2(revenueRow.netRevenue ?? 0);
  const lines = matchingRoles.map((roleRow) => ({
    contact_id: roleRow.contactId!,
    contact_name: roleRow.contactName!,
    work_id: revenueRow.workId,
    work_title: workTitle,
    statement_period: revenueRow.statementPeriod,
    source: revenueRow.source,
    net_revenue: netRevenue,
    role: roleRow.role ?? "Unknown",
    percent_share: round2(roleRow.percentShare ?? 0),
    amount_owed: round2(netRevenue * ((roleRow.percentShare ?? 0) / 100)),
    payment_status: "preview",
  } satisfies RoyaltiesPayoutLine));

  const roundedSum = round2(lines.reduce((sum, line) => sum + line.amount_owed, 0));
  const delta = round2(netRevenue - roundedSum);
  if (delta !== 0 && lines.length > 0) {
    lines[lines.length - 1].amount_owed = round2(lines[lines.length - 1].amount_owed + delta);
  }

  return lines;
}

function getSplitIssue(
  row: RoyaltiesDashboardRevenueRow,
  masterRoleSummary: MasterRoleSummary | undefined,
): { issueType: SplitIssueType; masterRoleCount: number; masterPct: number } | null {
  if (!row.workId) {
    return { issueType: "no_work_match", masterRoleCount: 0, masterPct: 0 };
  }

  const masterRoleCount = masterRoleSummary?.count ?? 0;
  const masterPct = round2(masterRoleSummary?.pct ?? 0);

  if (masterRoleCount === 0) {
    return { issueType: "no_master_roles", masterRoleCount, masterPct };
  }
  if (masterRoleSummary?.hasMissingPayeeContact) {
    return { issueType: "missing_payee_contact", masterRoleCount, masterPct };
  }
  if (masterPct < 100) {
    return { issueType: "under_allocated", masterRoleCount, masterPct };
  }
  if (masterPct > 100) {
    return { issueType: "over_allocated", masterRoleCount, masterPct };
  }
  return null;
}

function preferTitle(row: Pick<RoyaltiesDashboardRevenueRow, "workTitle" | "recordName">): string {
  return cleanRecordName(row.workTitle || row.recordName || "Unknown record");
}

function cleanRecordName(recordName: string): string {
  return recordName.replace(/\s*\((EPAY|MPAY)\)$/i, "").trim();
}

function isMechanicalRevenue(row: Pick<RoyaltiesDashboardRevenueRow, "recordName" | "revenueType">): boolean {
  const revenueType = row.revenueType?.trim().toLowerCase();
  if (revenueType === "mechanical") return true;
  return /\(MPAY\)$/i.test(row.recordName);
}

function formatSource(sourceSet: Set<string>): string {
  const sources = Array.from(sourceSet).filter(Boolean).sort();
  if (!sources.length) return "Unknown";
  return sources.length === 1 ? sources[0] : sources.join(", ");
}

function minPeriod(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a.localeCompare(b) <= 0 ? a : b;
}

function maxPeriod(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a.localeCompare(b) >= 0 ? a : b;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n") || stringValue.includes("\r")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}
