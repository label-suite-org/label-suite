import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  contacts,
  releases,
  royalty_earnings,
  royalty_ledger_entries,
  royalty_ledger_transactions,
  royalty_payouts,
  royalty_statement_lines,
  royalty_statements,
} from "../db/schema";
import { db } from "../lib/db";
import { findPayeeContact, normalizePayeeEmail, PUBLISHED_STATEMENT_STATUSES, PAYEE_VISIBLE_PAYOUT_STATUSES } from "./payee-portal-core";

export interface PayeePortalData {
  contact: { id: string; name: string; email: string | null };
  balances: Array<{ currency: string; balance: string | number }>;
  statements: Array<{
    id: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
    status: string;
    earningsAmount: string | number;
    adjustmentsAmount: string | number;
    payoutAmount: string | number;
    closingBalance: string | number;
    issuedAt: Date | null;
    dueDate: string | null;
    lines: Array<{
      id: string;
      description: string | null;
      amount: string | number;
      sharePercent: string | number | null;
    }>;
  }>;
  reports: Array<{
    releaseId: string | null;
    releaseTitle: string | null;
    periodStart: string;
    periodEnd: string;
    currency: string;
    amount: string;
  }>;
  payouts: Array<{
    id: string;
    statementId: string | null;
    amount: string | number;
    currency: string;
    status: string;
    reference: string | null;
    scheduledFor: string | null;
    paidAt: Date | null;
  }>;
}

/** Load only published financial records belonging to the authenticated payee contact. */
export async function getPayeePortalData(
  orgId: string,
  userEmail: string,
): Promise<PayeePortalData | null> {
  const contactCandidates = await db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email })
    .from(contacts)
    .where(and(
      eq(contacts.org_id, orgId),
      sql`lower(btrim(${contacts.email})) = ${normalizePayeeEmail(userEmail)}`,
    ))
    .limit(2);
  const contact = findPayeeContact(contactCandidates, userEmail);
  if (!contact) return null;

  const statementRows = await db
    .select({
      id: royalty_statements.id,
      periodStart: royalty_statements.period_start,
      periodEnd: royalty_statements.period_end,
      currency: royalty_statements.currency,
      status: royalty_statements.status,
      earningsAmount: royalty_statements.earnings_amount,
      adjustmentsAmount: royalty_statements.adjustments_amount,
      payoutAmount: royalty_statements.payout_amount,
      closingBalance: royalty_statements.closing_balance,
      issuedAt: royalty_statements.issued_at,
      dueDate: royalty_statements.due_date,
    })
    .from(royalty_statements)
    .where(and(
      eq(royalty_statements.org_id, orgId),
      eq(royalty_statements.contact_id, contact.id),
      inArray(royalty_statements.status, [...PUBLISHED_STATEMENT_STATUSES]),
    ))
    .orderBy(desc(royalty_statements.period_start), desc(royalty_statements.id));

  const statementIds = statementRows.map((statement) => statement.id);
  const lineRows = statementIds.length
    ? await db
      .select({
        id: royalty_statement_lines.id,
        statementId: royalty_statement_lines.statement_id,
        description: royalty_statement_lines.description,
        amount: royalty_statement_lines.amount,
        sharePercent: royalty_statement_lines.share_percent,
      })
      .from(royalty_statement_lines)
      .where(and(
        eq(royalty_statement_lines.org_id, orgId),
        inArray(royalty_statement_lines.statement_id, statementIds),
      ))
      .orderBy(desc(royalty_statement_lines.id))
    : [];
  const linesByStatement = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const lines = linesByStatement.get(line.statementId) ?? [];
    lines.push(line);
    linesByStatement.set(line.statementId, lines);
  }

  const reports = statementIds.length ? await db
    .select({
      releaseId: releases.id,
      releaseTitle: releases.title,
      periodStart: royalty_statements.period_start,
      periodEnd: royalty_statements.period_end,
      currency: royalty_statements.currency,
      amount: sql<string>`sum(${royalty_statement_lines.amount})`,
    })
    .from(royalty_statement_lines)
    .innerJoin(royalty_statements, and(
      eq(royalty_statements.id, royalty_statement_lines.statement_id),
      eq(royalty_statements.org_id, orgId),
      eq(royalty_statements.contact_id, contact.id),
      inArray(royalty_statements.status, [...PUBLISHED_STATEMENT_STATUSES]),
    ))
    .leftJoin(royalty_earnings, and(
      eq(royalty_earnings.id, royalty_statement_lines.earning_id),
      eq(royalty_earnings.org_id, orgId),
    ))
    .leftJoin(releases, and(eq(releases.id, royalty_earnings.release_id), eq(releases.org_id, orgId)))
    .where(and(
      eq(royalty_statement_lines.org_id, orgId),
      inArray(royalty_statement_lines.statement_id, statementIds),
      eq(royalty_statement_lines.line_type, "earning"),
    ))
    .groupBy(releases.id, releases.title, royalty_statements.period_start, royalty_statements.period_end, royalty_statements.currency)
    .orderBy(desc(royalty_statements.period_start), releases.title, royalty_statements.currency) : [];

  const payoutRows = await db
    .select({
      id: royalty_payouts.id,
      statementId: royalty_payouts.statement_id,
      amount: royalty_payouts.amount,
      currency: royalty_payouts.currency,
      status: royalty_payouts.status,
      reference: royalty_payouts.reference,
      scheduledFor: royalty_payouts.scheduled_for,
      paidAt: royalty_payouts.paid_at,
    })
    .from(royalty_payouts)
    .where(and(
      eq(royalty_payouts.org_id, orgId),
      eq(royalty_payouts.contact_id, contact.id),
      inArray(royalty_payouts.status, [...PAYEE_VISIBLE_PAYOUT_STATUSES]),
    ))
    .orderBy(desc(royalty_payouts.paid_at), desc(royalty_payouts.id));

  const balanceRows = await db
    .select({
      currency: royalty_ledger_entries.currency,
      balance: sql<string>`coalesce(sum(${royalty_ledger_entries.amount}), 0)`,
    })
    .from(royalty_ledger_entries)
    .innerJoin(royalty_ledger_transactions, and(
      eq(royalty_ledger_entries.transaction_id, royalty_ledger_transactions.id),
      eq(royalty_ledger_transactions.org_id, orgId),
      inArray(royalty_ledger_transactions.posting_status, ["posted", "reversed"]),
    ))
    .where(and(
      eq(royalty_ledger_entries.org_id, orgId),
      eq(royalty_ledger_entries.contact_id, contact.id),
    ))
    .groupBy(royalty_ledger_entries.currency)
    .orderBy(royalty_ledger_entries.currency);

  return {
    contact,
    balances: balanceRows,
    statements: statementRows.map((statement) => ({
      ...statement,
      lines: (linesByStatement.get(statement.id) ?? []).map((line) => ({
        id: line.id,
        description: line.description,
        amount: line.amount,
        sharePercent: line.sharePercent,
      })),
    })),
    payouts: payoutRows,
    reports,
  };
}

export async function getPayeeStatementDownload(
  orgId: string,
  userEmail: string,
  statementId: string,
) {
  const data = await getPayeePortalData(orgId, userEmail);
  return data?.statements.find((statement) => statement.id === statementId) ?? null;
}
