import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

const org = `statement-review-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let database: typeof import("../lib/db");
let prepare: typeof import("./royalty-statements").prepareRoyaltyStatements;
let review: typeof import("./royalty-statement-review").reviewRoyaltyStatement;

describe.skipIf(process.env.CI !== "true")("statement issuance on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = process.env.DATABASE_URL ?? "";
    assertDisposableReleaseGateTarget({ databaseUrl: target, ci: process.env.CI,
      fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
      userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
      analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
    sql = postgres(target);
    database = await import("../lib/db");
    ({ prepareRoyaltyStatements: prepare } = await import("./royalty-statements"));
    ({ reviewRoyaltyStatement: review } = await import("./royalty-statement-review"));
    await sql`insert into label_suite.orgs (id,name,slug) values (${org},'Synthetic statement review',${org})`;
    await sql`insert into label_suite."user" (id,name,email) values (${org},'Synthetic operator',${org+'@example.test'})`;
    await sql`insert into label_suite.org_memberships (id,org_id,user_id,role) values (${org},${org},${org},'operator')`;
    for (const suffix of ['a','b']) {
      const id = org + suffix;
      await sql`insert into label_suite.contacts (id,org_id,name) values (${id},${org},'Synthetic payee')`;
      await sql`insert into label_suite.works (id,org_id,title) values (${id},${org},'Synthetic work')`;
      await sql`insert into label_suite.roles (id,org_id,contact_id,work_id,scope,ownership_type,percent_share) values (${id},${org},${id},${id},'Master','Rights',100)`;
      await sql`insert into label_suite.royalty_earnings (id,org_id,source,source_row_id,work_id,report_period,currency,net_amount) values (${id},${org},'fixture',${id},${id},'2026-08','USD',1)`;
    }
  });
  // Issued records are append-only; retain synthetic rows in the disposable database.
  afterAll(async () => { await sql?.end(); });
  it("verifies provenance, posts concurrent statements once, and rejects overlapping allocation", async () => {
    const input = { period_start: '2026-08-01', period_end: '2026-08-31', currency: 'USD' };
    const prepared = await prepare(org,input);
    const { royalty_statements } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const read = async (id: string) => (await database.db.select().from(royalty_statements).where(eq(royalty_statements.id,id)))[0]!;
    const scoped = <T>(fn: () => Promise<T>) => database.runWithDatabaseContext({ orgId: org, userId: org },fn);
    const reviewed = await Promise.all(prepared.plans.map(async plan => {
      const statement = await read(plan.id);
      await expect(review('foreign',plan.id,statement.updated_at!.toISOString())).rejects.toMatchObject({ status: 404 });
      return scoped(() => review(org,plan.id,statement.updated_at!.toISOString()));
    }));
    const first = reviewed[0]!;
    const bogusRun = `royalty_calculation_${randomUUID().replaceAll('-','').slice(0,24)}`;
    await sql`insert into label_suite.royalty_calculation_runs (id,org_id,engine_version,idempotency_key) values (${bogusRun},${org},'fixture',${bogusRun})`;
    await sql`update label_suite.royalty_statements set notes=${'Calculation run '+bogusRun} where id=${first.id}`;
    const issuance = { actorId: org, reference: 'fixture://reviewed-source' };
    await expect(scoped(() => review(org,first.id,first.updated_at!.toISOString(),issuance))).rejects.toMatchObject({ status: 409 });
    expect((await sql`select status from label_suite.royalty_calculation_runs where id=${bogusRun}`)[0].status).toBe('draft');
    expect(await sql`select id from label_suite.royalty_ledger_transactions where org_id=${org}`).toHaveLength(0);
    await sql`update label_suite.royalty_statements set notes=${first.notes} where id=${first.id}`;
    const issued = await Promise.all(reviewed.map(statement => scoped(() => review(org,statement.id,statement.updated_at!.toISOString(),issuance))));
    expect(issued.map(statement => statement.status)).toEqual(['issued','issued']);
    await expect(scoped(() => review(org,first.id,first.updated_at!.toISOString(),issuance))).rejects.toMatchObject({ status: 409 });
    const overlap = await prepare(org,{...input,period_start:'2026-08-02'});
    const overlapStatement = await read(overlap.plans[0].id);
    const overlapReviewed = await scoped(() => review(org,overlapStatement.id,overlapStatement.updated_at!.toISOString()));
    await expect(scoped(() => review(org,overlapReviewed.id,overlapReviewed.updated_at!.toISOString(),issuance))).rejects.toMatchObject({ status: 409 });
    expect(await sql`select id from label_suite.royalty_ledger_transactions where org_id=${org} and posting_status='posted'`).toHaveLength(2);
    expect((await sql`select sum(amount)::text as amount from label_suite.royalty_ledger_entries where org_id=${org}`)[0].amount).toBe('2.00000000');
    expect(await sql`select id from label_suite.audit_logs where org_id=${org} and actor_user_id=${org} and entity_type='royalty_statements' and after_data->>'status'='issued'`).toHaveLength(2);
    const { recordPayoutBatch, recordPayoutBatchSchema, reversePayoutBatch, getPayoutBatch } = await import('./royalty-payout-recording');
    const batch = { idempotency_key: randomUUID(), reference:'fixture://external-payment', effective_date:'2026-09-01', lines:[{statement_id:issued[0].id,amount:'0.6'}] };
    expect(recordPayoutBatchSchema.safeParse({...batch,lines:[{statement_id:issued[0].id,amount:'-1'}]}).success).toBe(false);
    await expect(scoped(() => recordPayoutBatch(org,org,{...batch,lines:[...batch.lines,{statement_id:issued[1].id,amount:'2'}]}))).rejects.toMatchObject({status:409});
    expect(await sql`select id from label_suite.royalty_payouts where org_id=${org}`).toHaveLength(0);
    const repeats = await Promise.all([scoped(() => recordPayoutBatch(org,org,batch)),scoped(() => recordPayoutBatch(org,org,batch))]);
    expect(repeats.map(result => result.duplicate).sort()).toEqual([false,true]);
    await expect(scoped(() => recordPayoutBatch(org,org,{...batch,reference:'changed'}))).rejects.toMatchObject({status:409});
    const competing = await Promise.allSettled([1,2].map(() => scoped(() => recordPayoutBatch(org,org,{...batch,idempotency_key:randomUUID(),lines:[{statement_id:issued[0].id,amount:'0.4'}]}))));
    expect(competing.filter(result => result.status==='fulfilled')).toHaveLength(1);
    expect(await sql`select id from label_suite.royalty_payouts where org_id=${org} and status='recorded'`).toHaveLength(2);
    expect((await sql`select sum(amount)::text as amount from label_suite.royalty_ledger_entries where org_id=${org}`)[0].amount).toBe('1.00000000');
    expect(await sql`select id from label_suite.audit_logs where org_id=${org} and actor_user_id=${org} and entity_type='royalty_payouts' and after_data->>'status'='recorded'`).toHaveLength(2);
    const readScoped = <T>(fn: () => Promise<T>) => database.runWithDatabaseContext({orgId:org,userId:org},fn,{isolationLevel:"repeatable read"});
    const savedBatch = await readScoped(() => getPayoutBatch(org,repeats[0].batch_id));
    expect(savedBatch.lines).toHaveLength(1);
    expect(savedBatch.lines[0]).toMatchObject({amount:'-0.60000000',currency:'USD',statement_id:issued[0].id});
    await expect(readScoped(() => getPayoutBatch('foreign',repeats[0].batch_id))).rejects.toMatchObject({status:404});
    const {getNativeRoyaltyStatement} = await import('./native-royalties');
    const beforeReversal = await readScoped(() => getNativeRoyaltyStatement(org,issued[0].id));
    expect(beforeReversal.statement.posted_balance).toBe('0.00000000');
    expect(beforeReversal.payouts.find(payout=>payout.amount==='0.60000000')?.recording_batch_id).toBe(repeats[0].batch_id);
    const reversal = {reference:'fixture://recording-correction',effective_date:'2026-09-02'};
    await expect(scoped(() => reversePayoutBatch('foreign',org,repeats[0].batch_id,reversal))).rejects.toMatchObject({status:404});
    const reversed = await Promise.all([1,2].map(() => scoped(() => reversePayoutBatch(org,org,repeats[0].batch_id,reversal))));
    expect(reversed.map(result=>result.duplicate).sort()).toEqual([false,true]);
    expect((await readScoped(() => getNativeRoyaltyStatement(org,issued[0].id))).statement.posted_balance).toBe('0.60000000');
    expect((await sql`select sum(amount)::text as amount from label_suite.royalty_ledger_entries where org_id=${org}`)[0].amount).toBe('1.60000000');
    expect(await sql`select id from label_suite.royalty_payouts where org_id=${org} and status='reversed'`).toHaveLength(1);
    await expect(scoped(() => recordPayoutBatch(org,org,batch))).rejects.toMatchObject({status:409});
    await expect(scoped(() => reversePayoutBatch(org,org,repeats[0].batch_id,{...reversal,reference:'different'}))).rejects.toMatchObject({status:409});


  });
});
