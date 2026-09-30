import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.NATIVE_ROYALTIES_INTEGRATION === "1";
const suffix = randomUUID();
const org = `royalty-org-${suffix}`, foreign = `royalty-foreign-${suffix}`, actor = `royalty-actor-${suffix}`;
const contact = `royalty-contact-${suffix}`, statement = `royalty-statement-${suffix}`;
let sql: ReturnType<typeof postgres>;
let service: typeof import("./native-royalties");
let scoped: typeof import("../lib/db").runWithDatabaseContext;

describe.skipIf(!enabled)("native royalty evidence on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/native_royalty_fixture") throw new Error("Disposable fixture required");
    sql = postgres(url.href, { max: 1 });
    service = await import("./native-royalties");
    ({ runWithDatabaseContext: scoped } = await import("../lib/db"));
    await sql`insert into label_suite.orgs (id, name, slug) values (${org}, 'Fixture', ${org}), (${foreign}, 'Foreign fixture', ${foreign})`;
    await sql`insert into label_suite."user" (id, name, email, "emailVerified") values (${actor}, 'Fixture', ${`${actor}@example.test`}, true)`;
    await sql`insert into label_suite.org_memberships (id, org_id, user_id, role) values (${suffix}, ${org}, ${actor}, 'operator')`;
    await sql`insert into label_suite.contacts (id, org_id, name) values (${contact}, ${org}, 'Fixture payee')`;
    await sql`insert into label_suite.royalty_imports (id, org_id, source, file_name, sha256, period_start, period_end, row_count, unmatched_count) values (${`${suffix}-import`}, ${org}, 'fixture', 'fictional-report.csv', ${'a'.repeat(64)}, '2026-08-01', '2026-08-31', 2, 2)`;
    for (const [currency, amount] of [["USD", "10.00000001"], ["EUR", "20.00000002"]]) {
      await sql`insert into label_suite.royalty_earnings (id, org_id, import_id, source_row_id, source, platform, revenue_stream, report_period, net_amount, currency) values (${`${suffix}-${currency}`}, ${org}, ${`${suffix}-import`}, ${`${suffix}-${currency}`}, 'fixture', 'Fixture platform', 'streaming', '2026-08', ${amount}, ${currency})`;
      await sql`insert into label_suite.royalty_import_currency_totals (id, org_id, import_id, currency, row_count, gross_total, fees_total, net_total) values (${`${suffix}-total-${currency}`}, ${org}, ${`${suffix}-import`}, ${currency}, 1, ${amount}, '0', ${amount})`;
    }
    await sql`insert into label_suite.royalty_earnings (id, org_id, source_row_id, source, net_amount, currency) values (${`${suffix}-foreign`}, ${foreign}, ${`${suffix}-foreign`}, 'fixture', '9000', 'USD')`;
    await sql`insert into label_suite.royalty_statements (id, org_id, contact_id, period_start, period_end, currency, earnings_amount, closing_balance) values (${statement}, ${org}, ${contact}, '2026-08-01', '2026-08-31', 'USD', '10.00000001', '10.00000001')`;
    await sql`insert into label_suite.royalty_statement_lines (id, org_id, statement_id, earning_id, line_type, amount) values (${suffix}, ${org}, ${statement}, ${`${suffix}-USD`}, 'earning', '8.00000000')`;
  });
  afterAll(async () => { if (sql) await sql.end(); });

  it("limits release earnings to canonical release or track links and rejects foreign scope", async () => {
    const release = `${suffix}-release`, track = `${suffix}-track`;
    await sql`insert into label_suite.releases (id,org_id,title) values (${release},${org},'Royalty release')`;
    await sql`insert into label_suite.tracks (id,org_id,title,release_id) values (${track},${org},'Royalty track',${release})`;
    const run = (input: unknown) => scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyPage(org, input), { isolationLevel: "repeatable read" });
    try {
      await sql`update label_suite.royalty_earnings set release_id=${release} where id=${`${suffix}-USD`}`;
      expect((await run({ section: "earnings", release_id: release })).rows.map((row) => row.id)).toEqual([`${suffix}-USD`]);
      await sql`update label_suite.royalty_earnings set track_id=${track} where id=${`${suffix}-EUR`}`;
      expect((await run({ section: "earnings", release_id: release })).rows).toHaveLength(2);
      await expect(run({ section: "balances", release_id: release })).rejects.toThrow('requires earnings');
      await expect(scoped({ userId: actor, orgId: foreign }, () => service.getNativeRoyaltyPage(foreign, { section: "earnings", release_id: release }), { isolationLevel: "repeatable read" })).rejects.toThrow('not found');
    } finally {
      await sql`update label_suite.royalty_earnings set release_id=null,track_id=null where org_id=${org}`;
      await sql`delete from label_suite.tracks where id=${track}`;
      await sql`delete from label_suite.releases where id=${release}`;
    }
  });

  it("keeps currencies, exact amounts and unmatched identities distinct without foreign evidence", async () => {
    const result = await scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyPage(org, { section: "earnings" }), { isolationLevel: "repeatable read" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: "USD", net_amount: "10.00000001", match_status: "unmatched", track_id: null, track_release_id: null, import_file_name: "fictional-report.csv", import_sha256: "a".repeat(64), platform: "Fixture platform", revenue_stream: "streaming" }),
      expect.objectContaining({ currency: "EUR", net_amount: "20.00000002", match_status: "unmatched", release_id: null }),
    ]));
    expect(JSON.stringify(result)).not.toContain("9000");
    expect(result.payment_execution).toBe(false);
    const imports = await scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyPage(org, { section: "imports" }), { isolationLevel: "repeatable read" });
    expect(imports.rows[0]).toMatchObject({ status: "received", file_name: "fictional-report.csv", sha256: "a".repeat(64), unmatched_count: 2, currencies: expect.arrayContaining([
      expect.objectContaining({ currency: "USD", net_total: "10.00000001" }),
      expect.objectContaining({ currency: "EUR", net_total: "20.00000002" }),
    ]) });
  });

  it("exposes stored allocation disagreement and rejects a foreign statement request", async () => {
    const run = <T>(operation: () => Promise<T>) => scoped({ userId: actor, orgId: org }, operation, { isolationLevel: "repeatable read" });
    const result = await run(() => service.getNativeRoyaltyStatement(org, statement, 0));
    expect(result.statement.id).toBe(statement);
    expect(result.reconciliation.earnings_match).toBe(false);
    expect(result.reconciliation.balance_match).toBe(true);
    expect(result.reconciliation.missing_sources).toBe(1);
    expect(result.reconciliation.unresolved_payees).toBe(1);
    expect(result.reconciliation.currency_mismatches).toBe(0);
    expect(result.lines[0]).toMatchObject({ amount: "8.00000000", earning_id: `${suffix}-USD`, source: "fixture", currency: "USD", import_file_name: "fictional-report.csv", platform: "Fixture platform", revenue_stream: "streaming" });
    expect(result.calculation_run_note_reference).toBeNull();
    await expect(run(() => service.getNativeRoyaltyStatement(foreign, statement, 0))).rejects.toMatchObject({ status: 404 });
  });


  it("keeps the earning release distinct from the linked track parent in list and statement evidence", async () => {
    const parent = `${suffix}-track-parent`, reported = `${suffix}-earning-release`, track = `${suffix}-track`;
    await sql`insert into label_suite.releases (id, org_id, title) values (${parent}, ${org}, 'Track parent'), (${reported}, ${org}, 'Earning release')`;
    await sql`insert into label_suite.tracks (id, org_id, release_id, title) values (${track}, ${org}, ${parent}, 'Canonical track')`;
    try {
      await sql`update label_suite.royalty_earnings set track_id = ${track}, release_id = ${reported} where id = ${`${suffix}-USD`}`;
      const run = <T>(operation: () => Promise<T>) => scoped({ userId: actor, orgId: org }, operation, { isolationLevel: "repeatable read" });
      const page = await run(() => service.getNativeRoyaltyPage(org, { section: 'earnings' }));
      expect(page.rows.find(row => row.id === `${suffix}-USD`)).toMatchObject({ track_id: track, track_release_id: parent, release_id: reported });
      const detail = await run(() => service.getNativeRoyaltyStatement(org, statement));
      expect(detail.lines[0]).toMatchObject({ track_id: track, track_release_id: parent, release_id: reported });
      await sql`update label_suite.tracks set release_id = null where id = ${track} and org_id = ${org}`;
      const standalone = await run(() => service.getNativeRoyaltyPage(org, { section: 'earnings' }));
      expect(standalone.rows.find(row => row.id === `${suffix}-USD`)).toMatchObject({ track_id: track, track_release_id: null, release_id: reported });
      expect((await run(() => service.getNativeRoyaltyStatement(org, statement))).lines[0]).toMatchObject({ track_id: track, track_release_id: null, release_id: reported });
      const { getNativeTrack } = await import('./native-tracks');
      expect((await run(() => getNativeTrack(org, null, track))).track.id).toBe(track);
    } finally {
      await sql`update label_suite.royalty_earnings set track_id = null, release_id = null where id = ${`${suffix}-USD`}`;
    }
  });

  it("labels editable calculation-run references unverified and never resolves a foreign run", async () => {
    const ownRun = `royalty_calculation_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const foreignRun = `royalty_calculation_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    await sql`insert into label_suite.royalty_calculation_runs (id, org_id, engine_version, idempotency_key) values (${ownRun}, ${org}, 'fixture-v1', ${ownRun}), (${foreignRun}, ${foreign}, 'foreign-v1', ${foreignRun})`;
    const read = () => scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyStatement(org, statement), { isolationLevel: "repeatable read" });
    try {
      await sql`update label_suite.royalty_statements set notes = ${`Calculation run ${ownRun}`} where id = ${statement}`;
      expect((await read()).calculation_run_note_reference).toMatchObject({ id: ownRun, engine_version: 'fixture-v1', verified_provenance: false });
      await sql`update label_suite.royalty_statements set notes = ${`Calculation run ${foreignRun}`} where id = ${statement}`;
      expect((await read()).calculation_run_note_reference).toBeNull();
    } finally {
      await sql`update label_suite.royalty_statements set notes = null where id = ${statement}`;
    }
  });

  it("distinguishes a named but unresolved split payee from a canonical scoped contact", async () => {
    const work = `${suffix}-work`, snapshot = `${suffix}-snapshot`, split = `${suffix}-split`, foreignContact = `${suffix}-foreign-contact`;
    await sql`insert into label_suite.works (id, org_id, title) values (${work}, ${org}, 'Fixture work')`;
    await sql`insert into label_suite.contacts (id, org_id, name) values (${foreignContact}, ${foreign}, 'Foreign payee')`;
    await sql`insert into label_suite.royalty_split_snapshots (id, org_id, work_id, effective_from) values (${snapshot}, ${org}, ${work}, '2026-08-01')`;
    await sql`insert into label_suite.royalty_split_lines (id, org_id, snapshot_id, payee_name, share_percent) values (${split}, ${org}, ${snapshot}, 'Reported payee', '100')`;
    await sql`update label_suite.royalty_statement_lines set split_line_id = ${split} where id = ${suffix}`;
    const read = () => scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyStatement(org, statement), { isolationLevel: "repeatable read" });
    try {
      const unmatched = await read();
      expect(unmatched.lines[0]).toMatchObject({ payee_name: 'Reported payee', payee_contact_id: null, payee_contact_name: null });
      expect(unmatched.reconciliation.unresolved_payees).toBe(1);
      await sql`update label_suite.royalty_split_lines set contact_id = ${contact} where id = ${split}`;
      const matched = await read();
      expect(matched.lines[0]).toMatchObject({ payee_contact_id: contact, payee_contact_name: 'Fixture payee' });
      expect(matched.reconciliation.unresolved_payees).toBe(0);
      await expect(sql`update label_suite.royalty_split_lines set contact_id = ${foreignContact} where id = ${split}`).rejects.toThrow("Cross-organization reference");
      const excluded = await read();
      expect(excluded.lines[0].payee_contact_id).toBe(contact);
      expect(excluded.reconciliation.unresolved_payees).toBe(0);
      expect(JSON.stringify(excluded)).not.toContain('Foreign payee');
    } finally {
      await sql`update label_suite.royalty_statement_lines set split_line_id = null where id = ${suffix}`;
    }
  });

  it("nets posted reversals while keeping legacy entries and stored payout proposals explicit", async () => {
    await sql.begin(async tx => {
      await tx`select set_config('app.current_user_id', ${actor}, true), set_config('app.current_org_id', ${org}, true)`;
      await tx`insert into label_suite.royalty_ledger_transactions (id, org_id, idempotency_key, actor_user_id, evidence_reference, effective_date) values (${`${suffix}-original`}, ${org}, ${`${suffix}-original`}, ${actor}, 'fictional test evidence', '2026-08-31')`;
      await tx`insert into label_suite.royalty_ledger_entries (id, org_id, contact_id, transaction_id, entry_type, amount, currency, effective_date) values (${`${suffix}-entry`}, ${org}, ${contact}, ${`${suffix}-original`}, 'earning', '10', 'USD', '2026-08-31')`;
      await tx`select label_suite.establish_royalty_lifecycle_context(${org}, ${actor})`;
      await tx`update label_suite.royalty_ledger_transactions set posting_status = 'posted' where id = ${`${suffix}-original`}`;
      await tx`insert into label_suite.royalty_ledger_transactions (id, org_id, idempotency_key, actor_user_id, evidence_reference, effective_date, reversal_of_transaction_id) values (${`${suffix}-reversal`}, ${org}, ${`${suffix}-reversal`}, ${actor}, 'fictional reversal evidence', '2026-08-31', ${`${suffix}-original`})`;
      await tx`insert into label_suite.royalty_ledger_entries (id, org_id, contact_id, transaction_id, entry_type, amount, currency, effective_date) values (${`${suffix}-reverse-entry`}, ${org}, ${contact}, ${`${suffix}-reversal`}, 'earning', '-10', 'USD', '2026-08-31')`;
      await tx`select label_suite.establish_royalty_lifecycle_context(${org}, ${actor})`;
      await tx`update label_suite.royalty_ledger_transactions set posting_status = 'posted' where id = ${`${suffix}-reversal`}`;
      await tx`select label_suite.establish_royalty_lifecycle_context(${org}, ${actor})`;
      await tx`update label_suite.royalty_ledger_transactions set posting_status = 'reversed' where id = ${`${suffix}-original`}`;
      await tx`insert into label_suite.royalty_ledger_entries (id, org_id, contact_id, entry_type, amount, currency, effective_date) values (${`${suffix}-legacy`}, ${org}, ${contact}, 'earning', '3', 'USD', '2026-08-31')`;
      await tx`insert into label_suite.royalty_payouts (id, org_id, contact_id, statement_id, amount, currency) values (${`${suffix}-payout`}, ${org}, ${contact}, ${statement}, '10.00000001', 'USD')`;
    });
    const run = (section: string) => scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyPage(org, { section }), { isolationLevel: "repeatable read" });
    const balances = await run("balances");
    expect(balances.rows[0]).toMatchObject({ currency: "USD", posted_balance: "0.00000000", recorded_total: "3.00000000", unposted_entries: 1 });
    const payouts = await run("payouts");
    expect(payouts.rows[0]).toMatchObject({ status: "draft", amount: "10.00000001", statement_id: statement, currency_matches_statement: true });
    expect(payouts.payment_execution).toBe(false);
    const preview = await scoped({ userId: actor, orgId: org }, () => service.getNativeRoyaltyStatement(org, statement), { isolationLevel: "repeatable read" });
    expect(preview.payouts[0]).toMatchObject({ amount: "10.00000001", currency: "USD", status: "draft", statement_id: statement });
    expect(preview.payouts_truncated).toBe(false);
    expect(preview.reconciliation.earnings_match).toBe(false);
    expect(preview.lines[0].earning_id).toBe(`${suffix}-USD`);
  });
});
