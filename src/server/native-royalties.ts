import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { alias } from "drizzle-orm/pg-core";
import { artists, contacts, releases, tracks, royalty_calculation_runs, royalty_earnings, royalty_imports, royalty_import_currency_totals, royalty_ledger_entries, royalty_ledger_transactions, royalty_payouts, royalty_split_lines, royalty_split_snapshots, royalty_statement_lines, royalty_statements } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { addMoney, compareMoney, fromDatabaseString, subtractMoney } from "./royalty-engine/money";

export const nativeRoyaltyPageSchema = z.object({
  section: z.enum(["balances", "statements", "earnings", "imports", "payouts"]).default("statements"),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
}).strict();
const pageSize = 50;
const postedStatementBalance = sql<string>`(select coalesce(sum(entry.amount),0)::text
  from label_suite.royalty_ledger_entries entry
  join label_suite.royalty_ledger_transactions transaction on transaction.id=entry.transaction_id and transaction.org_id=entry.org_id
  where entry.org_id=${royalty_statements.org_id} and entry.statement_id=${royalty_statements.id}
    and entry.contact_id=${royalty_statements.contact_id} and entry.currency=${royalty_statements.currency}
    and transaction.posting_status in ('posted','reversed'))`;

const splitContact = alias(contacts, "native_royalty_split_contact");
const trackRelease = alias(releases, "native_royalty_track_release");

function validMoney(amount: string, currency: string): boolean {
  try { fromDatabaseString(amount, { currency, scale: 8, roundingMode: "ROUND_HALF_EVEN" }); return true; }
  catch { return false; }
}

export async function getNativeRoyaltyPage(orgId: string, input: unknown) {
  const { section, offset } = nativeRoyaltyPageSchema.parse(input);
  return db.transaction(async tx => {
    let rows: Record<string, unknown>[];
    switch (section) {
      case "balances": {
        rows = await tx.select({
          contact_id: royalty_ledger_entries.contact_id, contact_name: contacts.name, currency: royalty_ledger_entries.currency,
          posted_balance: sql<string>`coalesce(sum(${royalty_ledger_entries.amount}) filter (where ${royalty_ledger_transactions.posting_status} in ('posted', 'reversed')), 0)`,
          recorded_total: sql<string>`sum(${royalty_ledger_entries.amount})`,
          unposted_entries: sql<number>`count(*) filter (where ${royalty_ledger_transactions.posting_status} is null or ${royalty_ledger_transactions.posting_status} = 'draft')::int`,
          last_effective_date: sql<string>`max(${royalty_ledger_entries.effective_date})`,
        }).from(royalty_ledger_entries)
          .leftJoin(contacts, and(eq(contacts.id, royalty_ledger_entries.contact_id), eq(contacts.org_id, orgId)))
          .leftJoin(royalty_ledger_transactions, and(eq(royalty_ledger_transactions.id, royalty_ledger_entries.transaction_id), eq(royalty_ledger_transactions.org_id, orgId)))
          .where(eq(royalty_ledger_entries.org_id, orgId))
          .groupBy(royalty_ledger_entries.contact_id, contacts.name, royalty_ledger_entries.currency)
          .orderBy(royalty_ledger_entries.contact_id, royalty_ledger_entries.currency).limit(pageSize + 1).offset(offset);
        rows = rows.map(row => ({ ...row, valid_money: validMoney(String(row.posted_balance), String(row.currency)) && validMoney(String(row.recorded_total), String(row.currency)) }));
        break;
      }
      case "statements": {
        const statements = await tx.select({
          id: royalty_statements.id, contact_id: royalty_statements.contact_id, contact_name: contacts.name,
          period_start: royalty_statements.period_start, period_end: royalty_statements.period_end,
          currency: royalty_statements.currency, status: royalty_statements.status,
          posted_balance: postedStatementBalance, closing_balance: royalty_statements.closing_balance, updated_at: royalty_statements.updated_at,
        }).from(royalty_statements).leftJoin(contacts, and(eq(contacts.id, royalty_statements.contact_id), eq(contacts.org_id, orgId)))
          .where(eq(royalty_statements.org_id, orgId)).orderBy(desc(royalty_statements.period_end), royalty_statements.id).limit(pageSize + 1).offset(offset);
        rows = statements.map(row => ({ ...row, valid_money: validMoney(row.closing_balance, row.currency) }));
        break;
      }
      case "earnings": {
        const earnings = await tx.select({
          id: royalty_earnings.id, source: royalty_earnings.source, source_row_id: royalty_earnings.source_row_id,
          import_id: royalty_imports.id, import_status: royalty_imports.status, import_file_name: royalty_imports.file_name, import_sha256: royalty_imports.sha256, import_started_at: royalty_imports.started_at, import_completed_at: royalty_imports.completed_at,
          platform: royalty_earnings.platform, revenue_stream: royalty_earnings.revenue_stream, report_period: royalty_earnings.report_period,
          currency: royalty_earnings.currency, net_amount: royalty_earnings.net_amount, match_status: royalty_earnings.match_status,
          reported_track: royalty_earnings.track_title, reported_artist: royalty_earnings.artist_name,
          track_id: tracks.id, track_title: tracks.title, track_release_id: trackRelease.id, release_id: releases.id, release_title: releases.title,
          artist_id: artists.id, artist_name: artists.name, updated_at: royalty_earnings.updated_at,
        }).from(royalty_earnings)
          .leftJoin(royalty_imports, and(eq(royalty_imports.id, royalty_earnings.import_id), eq(royalty_imports.org_id, orgId)))
          .leftJoin(tracks, and(eq(tracks.id, royalty_earnings.track_id), eq(tracks.org_id, orgId)))
          .leftJoin(trackRelease, and(eq(trackRelease.id, tracks.release_id), eq(trackRelease.org_id, orgId)))
          .leftJoin(releases, and(eq(releases.id, royalty_earnings.release_id), eq(releases.org_id, orgId)))
          .leftJoin(artists, and(eq(artists.id, royalty_earnings.artist_id), eq(artists.org_id, orgId)))
          .where(eq(royalty_earnings.org_id, orgId)).orderBy(desc(royalty_earnings.created_at), royalty_earnings.id).limit(pageSize + 1).offset(offset);
        rows = earnings.map(row => ({ ...row, valid_money: validMoney(row.net_amount, row.currency) }));
        break;
      }
      case "imports": {
        const imports = await tx.select({
          id: royalty_imports.id, source: royalty_imports.source, status: royalty_imports.status,
          file_name: royalty_imports.file_name, sha256: royalty_imports.sha256,
          period_start: royalty_imports.period_start, period_end: royalty_imports.period_end,
          row_count: royalty_imports.row_count, matched_count: royalty_imports.matched_count,
          unmatched_count: royalty_imports.unmatched_count, error_count: royalty_imports.error_count,
          started_at: royalty_imports.started_at, completed_at: royalty_imports.completed_at,
        }).from(royalty_imports).where(eq(royalty_imports.org_id, orgId)).orderBy(desc(royalty_imports.started_at), royalty_imports.id).limit(pageSize + 1).offset(offset);
        const currencies = imports.length ? await tx.select({
          import_id: royalty_import_currency_totals.import_id, currency: royalty_import_currency_totals.currency,
          row_count: royalty_import_currency_totals.row_count, gross_total: royalty_import_currency_totals.gross_total,
          fees_total: royalty_import_currency_totals.fees_total, net_total: royalty_import_currency_totals.net_total,
        }).from(royalty_import_currency_totals).where(and(eq(royalty_import_currency_totals.org_id, orgId), inArray(royalty_import_currency_totals.import_id, imports.map(row => row.id)))) : [];
        rows = imports.map(row => ({ ...row, currencies: currencies.filter(total => total.import_id === row.id).map(total => ({ ...total, valid_money: validMoney(total.net_total, total.currency) && validMoney(total.gross_total, total.currency) && validMoney(total.fees_total, total.currency) })) }));
        break;
      }
      case "payouts": {
        const payouts = await tx.select({
          id: royalty_payouts.id, contact_id: royalty_payouts.contact_id, contact_name: contacts.name,
          statement_id: royalty_statements.id, statement_status: royalty_statements.status, statement_currency: royalty_statements.currency,
          period_start: royalty_statements.period_start, period_end: royalty_statements.period_end,
          amount: royalty_payouts.amount, currency: royalty_payouts.currency, status: royalty_payouts.status,
          scheduled_for: royalty_payouts.scheduled_for, paid_at: royalty_payouts.paid_at, updated_at: royalty_payouts.updated_at,
        }).from(royalty_payouts)
          .leftJoin(contacts, and(eq(contacts.id, royalty_payouts.contact_id), eq(contacts.org_id, orgId)))
          .leftJoin(royalty_statements, and(eq(royalty_statements.id, royalty_payouts.statement_id), eq(royalty_statements.org_id, orgId)))
          .where(eq(royalty_payouts.org_id, orgId)).orderBy(desc(royalty_payouts.created_at), royalty_payouts.id).limit(pageSize + 1).offset(offset);
        rows = payouts.map(row => ({ ...row, valid_money: validMoney(row.amount, row.currency), currency_matches_statement: row.statement_currency === row.currency }));
        break;
      }
    }
    return { section, rows: rows.slice(0, pageSize), next_offset: rows.length > pageSize ? offset + pageSize : null, fetched_at: new Date().toISOString(), payment_execution: false };
  }, { isolationLevel: "repeatable read" });
}

export async function getNativeRoyaltyStatement(orgId: string, id: string, rawOffset: unknown = 0) {
  const { offset } = nativeRoyaltyPageSchema.parse({ offset: rawOffset });
  return db.transaction(async tx => {
    const [statement] = await tx.select({
      id: royalty_statements.id, contact_id: royalty_statements.contact_id, contact_name: contacts.name,
      period_start: royalty_statements.period_start, period_end: royalty_statements.period_end,
      currency: royalty_statements.currency, status: royalty_statements.status,
      opening_balance: royalty_statements.opening_balance, earnings_amount: royalty_statements.earnings_amount,
      adjustments_amount: royalty_statements.adjustments_amount, payout_amount: royalty_statements.payout_amount,
      posted_balance: postedStatementBalance, closing_balance: royalty_statements.closing_balance, updated_at: royalty_statements.updated_at, notes: royalty_statements.notes,
    }).from(royalty_statements).leftJoin(contacts, and(eq(contacts.id, royalty_statements.contact_id), eq(contacts.org_id, orgId)))
      .where(and(eq(royalty_statements.org_id, orgId), eq(royalty_statements.id, id)));
    if (!statement) throw new NotFoundError("Statement not found in this workspace");
    const runId = /^Calculation run (royalty_calculation_[a-f0-9]{24})$/.exec(statement.notes ?? "")?.[1];
    const [calculationRun] = runId ? await tx.select({
      id: royalty_calculation_runs.id, status: royalty_calculation_runs.status,
      engine_version: royalty_calculation_runs.engine_version, approved_at: royalty_calculation_runs.approved_at,
      updated_at: royalty_calculation_runs.updated_at,
    }).from(royalty_calculation_runs).where(and(eq(royalty_calculation_runs.org_id, orgId), eq(royalty_calculation_runs.id, runId))) : [];
    const [totals] = await tx.select({
      line_count: sql<number>`count(*)::int`,
      earnings_amount: sql<string>`coalesce(sum(${royalty_statement_lines.amount}) filter (where ${royalty_statement_lines.line_type} = 'earning'), 0)`,
      missing_sources: sql<number>`count(*) filter (where ${royalty_statement_lines.line_type} = 'earning' and (${royalty_earnings.id} is null or ${royalty_statement_lines.split_line_id} is null))::int`,
      currency_mismatches: sql<number>`count(*) filter (where ${royalty_statement_lines.line_type} = 'earning' and ${royalty_earnings.currency} is distinct from ${statement.currency})::int`,
      unresolved_payees: sql<number>`count(*) filter (where ${royalty_statement_lines.line_type} = 'earning' and ${splitContact.id} is null)::int`,
      changed_sources: sql<number>`count(*) filter (where ${royalty_earnings.updated_at} > ${royalty_statement_lines.created_at})::int`,
    }).from(royalty_statement_lines)
      .leftJoin(royalty_earnings, and(eq(royalty_earnings.id, royalty_statement_lines.earning_id), eq(royalty_earnings.org_id, orgId)))
      .leftJoin(royalty_split_lines, and(eq(royalty_split_lines.id, royalty_statement_lines.split_line_id), eq(royalty_split_lines.org_id, orgId)))
      .leftJoin(splitContact, and(eq(splitContact.id, royalty_split_lines.contact_id), eq(splitContact.org_id, orgId)))
      .where(and(eq(royalty_statement_lines.org_id, orgId), eq(royalty_statement_lines.statement_id, id)));
    const lines = await tx.select({
      id: royalty_statement_lines.id, line_type: royalty_statement_lines.line_type, amount: royalty_statement_lines.amount,
      description: royalty_statement_lines.description, share_percent: royalty_statement_lines.share_percent, earning_id: royalty_earnings.id,
      source: royalty_earnings.source, source_row_id: royalty_earnings.source_row_id,
      platform: royalty_earnings.platform, revenue_stream: royalty_earnings.revenue_stream,
      import_file_name: royalty_imports.file_name, import_sha256: royalty_imports.sha256, import_started_at: royalty_imports.started_at, import_completed_at: royalty_imports.completed_at,
      report_period: royalty_earnings.report_period, currency: royalty_earnings.currency,
      source_amount: royalty_earnings.net_amount, match_status: royalty_earnings.match_status,
      track_id: tracks.id, track_title: tracks.title, track_release_id: trackRelease.id, release_id: releases.id, release_title: releases.title,
      artist_id: artists.id, artist_name: artists.name, import_id: royalty_imports.id, import_status: royalty_imports.status,
      split_line_id: royalty_split_lines.id, snapshot_id: royalty_split_snapshots.id,
      snapshot_status: royalty_split_snapshots.status, effective_from: royalty_split_snapshots.effective_from,
      payee_name: royalty_split_lines.payee_name, payee_contact_id: splitContact.id, payee_contact_name: splitContact.name,
      source_changed: sql<boolean>`coalesce(${royalty_earnings.updated_at} > ${royalty_statement_lines.created_at}, false)`,
    }).from(royalty_statement_lines)
      .leftJoin(royalty_earnings, and(eq(royalty_earnings.id, royalty_statement_lines.earning_id), eq(royalty_earnings.org_id, orgId)))
      .leftJoin(royalty_imports, and(eq(royalty_imports.id, royalty_earnings.import_id), eq(royalty_imports.org_id, orgId)))
      .leftJoin(tracks, and(eq(tracks.id, royalty_earnings.track_id), eq(tracks.org_id, orgId)))
      .leftJoin(trackRelease, and(eq(trackRelease.id, tracks.release_id), eq(trackRelease.org_id, orgId)))
          .leftJoin(releases, and(eq(releases.id, royalty_earnings.release_id), eq(releases.org_id, orgId)))
      .leftJoin(artists, and(eq(artists.id, royalty_earnings.artist_id), eq(artists.org_id, orgId)))
      .leftJoin(royalty_split_lines, and(eq(royalty_split_lines.id, royalty_statement_lines.split_line_id), eq(royalty_split_lines.org_id, orgId)))
      .leftJoin(splitContact, and(eq(splitContact.id, royalty_split_lines.contact_id), eq(splitContact.org_id, orgId)))
      .leftJoin(royalty_split_snapshots, and(eq(royalty_split_snapshots.id, royalty_split_lines.snapshot_id), eq(royalty_split_snapshots.org_id, orgId)))
      .where(and(eq(royalty_statement_lines.org_id, orgId), eq(royalty_statement_lines.statement_id, id)))
      .orderBy(royalty_statement_lines.id).limit(pageSize + 1).offset(offset);
    let earningsMatch: boolean | null = null, balanceMatch: boolean | null = null;
    try {
      const money = (amount: string) => fromDatabaseString(amount, { currency: statement.currency, scale: 8, roundingMode: "ROUND_HALF_EVEN" });
      earningsMatch = compareMoney(money(totals.earnings_amount), money(statement.earnings_amount)) === 0;
      balanceMatch = compareMoney(subtractMoney(addMoney(addMoney(money(statement.opening_balance), money(statement.earnings_amount)), money(statement.adjustments_amount)), money(statement.payout_amount)), money(statement.closing_balance)) === 0;
    } catch { /* Invalid stored money remains an explicit unknown reconciliation. */ }
    const payouts = await tx.select({
      recording_batch_id: sql<string | null>`(select entry.transaction_id from label_suite.royalty_ledger_entries entry
        where entry.org_id=${royalty_payouts.org_id} and entry.payout_id=${royalty_payouts.id}
          and entry.amount < 0 and entry.entry_type='payout' and entry.transaction_id like 'payout-batch:%'
        order by entry.transaction_id limit 1)`,
      id: royalty_payouts.id, contact_id: royalty_payouts.contact_id, contact_name: contacts.name,
      amount: royalty_payouts.amount, currency: royalty_payouts.currency, status: royalty_payouts.status,
      scheduled_for: royalty_payouts.scheduled_for, paid_at: royalty_payouts.paid_at, updated_at: royalty_payouts.updated_at,
    }).from(royalty_payouts)
      .leftJoin(contacts, and(eq(contacts.id, royalty_payouts.contact_id), eq(contacts.org_id, orgId)))
      .where(and(eq(royalty_payouts.org_id, orgId), eq(royalty_payouts.statement_id, id)))
      .orderBy(desc(royalty_payouts.created_at), royalty_payouts.id).limit(pageSize + 1);
    const { notes: _notes, ...record } = statement;
    return {
      // Notes are editable; this is not a canonical statement-to-run relation.
      statement: record, calculation_run_note_reference: calculationRun ? { ...calculationRun, verified_provenance: false } : null,
      payouts: payouts.slice(0, pageSize).map(payout => ({ ...payout, statement_id: id, statement_status: statement.status, statement_currency: statement.currency,
        period_start: statement.period_start, period_end: statement.period_end, valid_money: validMoney(payout.amount, payout.currency), currency_matches_statement: payout.currency === statement.currency })),
      payouts_truncated: payouts.length > pageSize,
      reconciliation: { earnings_match: earningsMatch, balance_match: balanceMatch, ...totals },
      lines: lines.slice(0, pageSize).map(line => ({ ...line, valid_money: validMoney(line.amount, statement.currency) && (line.source_amount === null || validMoney(line.source_amount, line.currency ?? "")), currency_matches_statement: line.currency === statement.currency })), next_offset: lines.length > pageSize ? offset + pageSize : null,
      fetched_at: new Date().toISOString(), payment_execution: false,
    };
  }, { isolationLevel: "repeatable read" });
}
