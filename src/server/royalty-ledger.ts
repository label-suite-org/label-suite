import { and, desc, eq, sql } from "drizzle-orm";
import {
  contacts,
  royalty_earnings,
  royalty_imports,
  royalty_ledger_entries,
  royalty_ledger_transactions,
  royalty_payouts,
  royalty_statements,
} from "../db/schema";
import { db } from "../lib/db";

export async function getRoyaltyPipelineSummary(orgId: string) {
  const [earningRows, importRows, statementRows, payoutRows, balances, earningTotals, postedTotals] = await Promise.all([
    db
      .select({
        rowCount: sql<number>`count(*)::int`,
        matchedCount: sql<number>`count(*) filter (where ${royalty_earnings.match_status} <> 'unmatched')::int`,
        unmatchedCount: sql<number>`count(*) filter (where ${royalty_earnings.match_status} = 'unmatched')::int`,
        netAmount: sql<string>`coalesce(sum(${royalty_earnings.net_amount}), 0)`,
      })
      .from(royalty_earnings)
      .where(eq(royalty_earnings.org_id, orgId)),
    db
      .select({
        id: royalty_imports.id,
        source: royalty_imports.source,
        status: royalty_imports.status,
        rowCount: royalty_imports.row_count,
        matchedCount: royalty_imports.matched_count,
        unmatchedCount: royalty_imports.unmatched_count,
        completedAt: royalty_imports.completed_at,
      })
      .from(royalty_imports)
      .where(eq(royalty_imports.org_id, orgId))
      .orderBy(desc(royalty_imports.started_at))
      .limit(5),
    db
      .select({
        count: sql<number>`count(*)::int`,
        openCount: sql<number>`count(*) filter (where ${royalty_statements.status} not in ('closed', 'paid'))::int`,
        closingBalance: sql<string>`coalesce(sum(${royalty_statements.closing_balance}), 0)`,
      })
      .from(royalty_statements)
      .where(eq(royalty_statements.org_id, orgId)),
    db
      .select({
        count: sql<number>`count(*)::int`,
        recordedAmount: sql<string>`coalesce(sum(${royalty_payouts.amount}) filter (where ${royalty_payouts.status} = 'recorded'), 0)`,
        outstandingAmount: sql<string>`coalesce(sum(${royalty_payouts.amount}) filter (where ${royalty_payouts.status} in ('draft', 'approved')), 0)`,
      })
      .from(royalty_payouts)
      .where(eq(royalty_payouts.org_id, orgId)),
    db
      .select({
        contactId: royalty_ledger_entries.contact_id,
        contactName: contacts.name,
        currency: royalty_ledger_entries.currency,
        balance: sql<string>`coalesce(sum(${royalty_ledger_entries.amount}), 0)`,
      })
      .from(royalty_ledger_entries)
      .innerJoin(royalty_ledger_transactions, and(eq(royalty_ledger_transactions.id, royalty_ledger_entries.transaction_id), eq(royalty_ledger_transactions.org_id, orgId)))
      .leftJoin(contacts, and(eq(royalty_ledger_entries.contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .where(and(eq(royalty_ledger_entries.org_id, orgId), sql`${royalty_ledger_transactions.posting_status} in ('posted', 'reversed')`))
      .groupBy(royalty_ledger_entries.contact_id, contacts.name, royalty_ledger_entries.currency)
      .orderBy(desc(sql`sum(${royalty_ledger_entries.amount})`)),
    db.select({ currency: royalty_earnings.currency, amount: sql<string>`sum(${royalty_earnings.net_amount})` })
      .from(royalty_earnings).where(eq(royalty_earnings.org_id, orgId))
      .groupBy(royalty_earnings.currency).orderBy(royalty_earnings.currency),
    db.select({ currency: royalty_ledger_entries.currency, amount: sql<string>`sum(${royalty_ledger_entries.amount})` })
      .from(royalty_ledger_entries)
      .innerJoin(royalty_ledger_transactions, and(eq(royalty_ledger_transactions.id, royalty_ledger_entries.transaction_id), eq(royalty_ledger_transactions.org_id, orgId)))
      .where(and(eq(royalty_ledger_entries.org_id, orgId), sql`${royalty_ledger_transactions.posting_status} in ('posted', 'reversed')`))
      .groupBy(royalty_ledger_entries.currency).orderBy(royalty_ledger_entries.currency),
  ]);

  const earnings = earningRows[0] ?? { rowCount: 0, matchedCount: 0, unmatchedCount: 0, netAmount: "0" };
  const statements = statementRows[0] ?? { count: 0, openCount: 0, closingBalance: "0" };
  const payouts = payoutRows[0] ?? { count: 0, recordedAmount: "0", outstandingAmount: "0" };

  return { earnings, imports: importRows, statements, payouts, balances, earningTotals, postedTotals };
}

export async function listUnmatchedRoyaltyEarnings(orgId: string, limit = 100) {
  return db
    .select({
      id: royalty_earnings.id,
      sourceRowId: royalty_earnings.source_row_id,
      reportPeriod: royalty_earnings.report_period,
      platform: royalty_earnings.platform,
      isrc: royalty_earnings.isrc,
      upc: royalty_earnings.upc,
      trackTitle: royalty_earnings.track_title,
      artistName: royalty_earnings.artist_name,
      netAmount: royalty_earnings.net_amount,
      currency: royalty_earnings.currency,
    })
    .from(royalty_earnings)
    .where(and(eq(royalty_earnings.org_id, orgId), eq(royalty_earnings.match_status, "unmatched")))
    .orderBy(desc(royalty_earnings.net_amount))
    .limit(Math.min(Math.max(limit, 1), 500));
}
