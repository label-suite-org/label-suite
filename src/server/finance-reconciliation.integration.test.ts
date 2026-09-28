import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertDisposableReleaseGateTarget } from "../../scripts/release-gate-fixture-safety";

const org = `finance-${randomUUID()}`;
let sql: ReturnType<typeof postgres>;
let finance: typeof import("./finance-reconciliation");

describe.skipIf(process.env.CI !== "true")("finance reconciliation on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const target = process.env.DATABASE_URL ?? "";
    assertDisposableReleaseGateTarget({ databaseUrl: target, ci: process.env.CI,
      fixtureDisposable: process.env.RELEASE_GATE_FIXTURE_DISPOSABLE,
      userEmail: process.env.E2E_USER_EMAIL, userPassword: process.env.E2E_USER_PASSWORD,
      analyticsFixtureDb: process.env.ANALYTICS_FIXTURE_DB, analyticsFixtureDisposable: process.env.ANALYTICS_FIXTURE_DISPOSABLE });
    sql = postgres(target);
    finance = await import("./finance-reconciliation");
    for (const id of [org,org+'foreign']) {
      await sql`insert into label_suite.orgs (id,name,slug) values (${id},'Synthetic finance',${id})`;
      await sql`insert into label_suite.budget_projects (id,org_id,name,currency) values (${id},${id},'Synthetic budget','USD')`;
      await sql`insert into label_suite.budget_line_items (id,org_id,project_id,name,amount) values (${id},${id},${id},'Synthetic spend',100)`;
    }
    await sql`insert into label_suite."user" (id,name,email) values (${org},'Synthetic operator',${org+'@example.test'})`;
    await sql`insert into label_suite.budget_projects (id,org_id,name,currency) values (${org+'eur'},${org},'Synthetic EUR budget','EUR')`;
    await sql`insert into label_suite.budget_line_items (id,org_id,project_id,name,amount) values (${org+'eur'},${org},${org+'eur'},'Synthetic EUR spend',100)`;
  });
  afterAll(async () => { await sql?.end(); });

  it("preserves import evidence, serializes allocations and restores the exception on reversal", async () => {
    const input = { source_provider:'fixture',account_label:'Operating',occurred_at:'2026-09-01T00:00:00Z',amount:'100',currency:'USD',direction:'debit' as const,raw_evidence:{amount:'100'},idempotency_key:'source-1' };
    const first = await finance.importFinanceTransaction(org,input,org);
    expect(first.amount).toBe('100.00000000');
    expect(first.raw_evidence).toEqual(input.raw_evidence);
    expect((await finance.importFinanceTransaction(org,input,org)).id).toBe(first.id);
    expect((await finance.importFinanceTransaction(org,{...input,account_label:'Other'},org)).id).not.toBe(first.id);
    await expect(finance.importFinanceTransaction(org,{...input,amount:'99'},org)).rejects.toMatchObject({status:409});
    const match = {match_type:'budget_spend' as const,target_id:org,allocated_amount:'60',rationale:'Synthetic invoice evidence'};
    await expect(finance.matchFinanceTransaction(org,first.id,{...match,target_id:org+'foreign'},org)).rejects.toMatchObject({status:404});
    await expect(finance.matchFinanceTransaction(org,first.id,{...match,target_id:org+'eur'},org)).rejects.toMatchObject({status:409});
    const results = await Promise.allSettled([1,2].map(()=>finance.matchFinanceTransaction(org,first.id,match,org)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    const saved = results.find(result=>result.status==='fulfilled');
    if (!saved || saved.status !== 'fulfilled') throw new Error('Expected one recorded match');
    expect(saved.value).toMatchObject({actor_user_id:org,rationale:match.rationale,status:'active'});
    expect(saved.value.created_at).toBeInstanceOf(Date);
    expect((await finance.listFinanceExceptions(org)).find(row=>row.label_suite_object_id===first.id)?.status).toBe('triaged');
    expect((await sql`select status from label_suite.finance_transactions where id=${first.id}`)[0].status).toBe('partially_matched');
    await expect(finance.reverseFinanceMatch(org+'foreign',{id:saved.value.id,reversal_reason:'No authority'},org)).rejects.toMatchObject({status:404});
    await expect(finance.reverseFinanceMatch(org,{id:saved.value.id,reversal_reason:'Wrong transaction'},org,'different-transaction')).rejects.toMatchObject({status:404});
    const reversed = await finance.reverseFinanceMatch(org,{id:saved.value.id,reversal_reason:'Synthetic correction'},org);
    expect(reversed).toMatchObject({status:'reversed',reversed_by:org,reversal_reason:'Synthetic correction'});
    expect((await finance.listFinanceExceptions(org)).find(row=>row.label_suite_object_id===first.id)?.status).toBe('open');
    expect((await sql`select status from label_suite.finance_transactions where id=${first.id}`)[0].status).toBe('unmatched');
    const full = await finance.matchFinanceTransaction(org,first.id,{...match,allocated_amount:'100'},org);
    expect((await finance.listFinanceExceptions(org)).some(row=>row.label_suite_object_id===first.id)).toBe(false);
    expect((await sql`select status from label_suite.finance_transactions where id=${first.id}`)[0].status).toBe('matched');
    expect(full.allocated_amount).toBe('100.00000000');
  });
});
