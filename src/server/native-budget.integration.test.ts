import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.NATIVE_BUDGET_INTEGRATION === "1";
const orgId = `native-budget-${randomUUID()}`;
const actorId = `${orgId}-actor`;
const otherOrg = `${orgId}-other`;
const projectId = `${orgId}-project`, lineId = `${orgId}-line`;
let sql: Sql;
let service: typeof import("./budget-mutations");

describe.skipIf(!enabled)("native Budget canonical writes", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_fixture")) throw new Error("Disposable local fixture database required");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./budget-mutations");
    await sql`insert into label_suite.user (id,name,email,"emailVerified") values (${actorId},'Budget actor',${`${actorId}@example.test`},true)`;
    await sql`insert into label_suite.orgs (id,name,slug) values (${orgId},'Budget fixture',${orgId}),(${otherOrg},'Other fixture',${otherOrg})`;
    await sql`insert into label_suite.budget_projects (id,org_id,name,currency) values (${projectId},${orgId},'Release budget','DKK')`;
    await sql`insert into label_suite.budget_line_items (id,org_id,project_id,name,amount,planned_amount,updated_at) values (${lineId},${orgId},${projectId},'Mastering',100,100,'2026-09-01 12:00:00.123456')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.audit_events where org_id=${orgId}`;
    await sql`delete from label_suite.budget_line_variance_requests where org_id=${orgId}`;
    await sql`delete from label_suite.budget_line_documents where org_id=${orgId}`;
    await sql`delete from label_suite.documents where org_id=${orgId}`;
    await sql`delete from label_suite.budget_line_items where org_id=${orgId}`;
    await sql`delete from label_suite.budget_projects where org_id=${orgId}`;
    await sql`delete from label_suite.audit_logs where org_id in (${orgId},${otherOrg})`;
    await sql`delete from label_suite.orgs where id in (${orgId},${otherOrg})`;
    await sql`delete from label_suite.user where id=${actorId}`;
    await sql.end();
  });
  it("rejects stale revisions, changed currency and foreign tenants, then audits the canonical edit", async () => {
    const input = { id: lineId, planned_amount: 125.5, expected_revision: '2026-09-01 12:00:00.123456', expected_currency: 'DKK' };
    await expect(service.updateBudgetLineForNative(otherOrg, input, actorId)).rejects.toThrow('not found');
    await expect(service.updateBudgetLineForNative(orgId, { ...input, expected_currency: 'EUR' }, actorId)).rejects.toThrow('currency');
    await expect(service.updateBudgetLineForNative(orgId, { ...input, expected_revision: '2026-09-01 12:00:00.123' }, actorId)).rejects.toThrow('changed');
    expect((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount).toBe(100);
    await expect(service.updateBudgetLineForNative(orgId, input, "missing-audit-actor")).rejects.toThrow();
    expect((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount).toBe(100);
    await service.updateBudgetLineForNative(orgId, input, actorId);
    await expect(service.updateBudgetLineForNative(orgId, input, actorId)).rejects.toThrow('changed');
    expect((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount).toBe(125.5);
    const events = await sql`select actor_user_id,event_type from label_suite.audit_events where org_id=${orgId}`;
    expect(events).toEqual([{ actor_user_id: actorId, event_type: 'budget_line.updated' }]);
  });
  it("preserves the existing locked-line approval gate and rejects native lock overrides", async () => {
    await sql`update label_suite.budget_line_items set lock_status='locked', planned_amount=125.5 where id=${lineId}`;
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.budget_line_items where id=${lineId}`;
    const input = { id: lineId, planned_amount: 200, expected_revision: revision, expected_currency: 'DKK' };
    await expect(service.updateBudgetLineForNative(orgId, input, actorId)).rejects.toThrow('approved variance');
    await expect(service.updateBudgetLineForNative(orgId, { ...input, lock_status: 'open' }, actorId)).rejects.toThrow();
    expect((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount).toBe(125.5);
  });
  it("allows only one concurrent native edit from the same revision", async () => {
    await sql`update label_suite.budget_line_items set lock_status='open' where id=${lineId}`;
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.budget_line_items where id=${lineId}`;
    const input = { id: lineId, expected_revision: revision, expected_currency: 'DKK' };
    const outcomes = await Promise.allSettled([
      service.updateBudgetLineForNative(orgId, { ...input, planned_amount: 300 }, actorId),
      service.updateBudgetLineForNative(orgId, { ...input, planned_amount: 400 }, actorId),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason.message).toContain('changed');
    expect([300, 400]).toContain((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount);
  });

  it("rejects empty patches and versions legacy lines without timestamps", async () => {
    await sql`update label_suite.budget_line_items set updated_at=null, lock_status='open' where id=${lineId}`;
    const input = { id: lineId, expected_revision: 'unversioned', expected_currency: 'DKK' };
    await expect(service.updateBudgetLineForNative(orgId, input, actorId)).rejects.toThrow('At least one');
    await service.updateBudgetLineForNative(orgId, { ...input, planned_amount: 500 }, actorId);
    await expect(service.updateBudgetLineForNative(orgId, { ...input, planned_amount: 600 }, actorId)).rejects.toThrow('changed');
    const [event] = await sql`select "before", "after" from label_suite.audit_events where org_id=${orgId} order by created_at desc limit 1`;
    expect(Object.keys(event.before).sort()).toEqual(Object.keys(event.after).sort());
  });

  it("captures canonical proposal evidence and makes one audited decision under concurrent review", async () => {
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.budget_line_items where id=${lineId}`;
    const proposal = { line_id: lineId, expected_revision: revision, expected_currency: 'DKK', variance_reason: 'Additional mastering pass', requested_action: 'increase_amount', requested_amount: 650, requested_currency: 'DKK' };
    await expect(service.createVarianceRequestForNative(otherOrg, proposal, actorId)).rejects.toThrow('not found');
    await expect(service.createVarianceRequestForNative(orgId, { ...proposal, requested_amount: "foo" }, actorId)).rejects.toThrow();
    await expect(service.createVarianceRequestForNative(orgId, { ...proposal, requested_currency: "EUR" }, actorId)).rejects.toThrow('currency');
    await expect(service.createVarianceRequestForNative(orgId, { ...proposal, requested_amount: -100 }, actorId)).rejects.toThrow();
    const created = await service.createVarianceRequestForNative(orgId, proposal, actorId);
    await expect(service.createVarianceRequestForNative(orgId, proposal, actorId)).rejects.toThrow('changed');
    const request = (await service.listVarianceRequests(orgId, projectId)).find((row) => row.id === created.id)!;
    expect(JSON.parse(request.current_value!)).toMatchObject({ planned_amount: 500, currency: 'DKK' });
    expect(JSON.parse(request.requested_value!)).toEqual({ amount: 650, currency: "DKK" });
    expect(request.requested_by_user_id).toBe(actorId);
    const [{ revision: lineRevision }] = await sql`select updated_at::text as revision from label_suite.budget_line_items where id=${lineId}`;
    const decision = { id: created.id, expected_revision: lineRevision, expected_request_revision: request.revision, expected_currency: 'DKK', decision: 'approved' };
    await expect(service.decideVarianceRequestForNative(orgId, { ...decision, expected_currency: 'EUR' }, actorId)).rejects.toThrow('currency');
    await expect(service.decideVarianceRequestForNative(orgId, { ...decision, expected_request_revision: 'stale' }, actorId)).rejects.toThrow('changed');
    const results = await Promise.allSettled([
      service.decideVarianceRequestForNative(orgId, decision, actorId),
      service.decideVarianceRequestForNative(orgId, { ...decision, decision: 'rejected' }, actorId),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const events = await sql`select event_type from label_suite.audit_events where object_id=${created.id}`;
    expect(events).toHaveLength(2);
    expect(events.map((row) => row.event_type)).toContain('budget_variance.proposed');
    // A decision authorizes the existing workflow; it does not execute a payment or apply the proposed amount.
    expect((await sql`select planned_amount,paid_amount from label_suite.budget_line_items where id=${lineId}`)[0]).toMatchObject({ planned_amount: 500, paid_amount: null });
  });

  it("limits release navigation to linked projects and rejects foreign or unrelated scopes", async () => {
    const release = `${orgId}-release`;
    await sql`insert into label_suite.releases (id,org_id,title) values (${release},${orgId},'Budget release')`;
    await sql`update label_suite.budget_projects set release_id=${release} where id=${projectId}`;
    const read = (await import('./native-budget')).getNativeBudget;
    try {
      expect((await read(orgId, actorId, { release_id: release })).projects.map((project) => project.id)).toEqual([projectId]);
      await expect(read(otherOrg, actorId, { release_id: release })).rejects.toThrow('not found');
      await sql`update label_suite.budget_projects set release_id=null where id=${projectId}`;
      expect((await read(orgId, actorId, { release_id: release })).projects).toEqual([]);
      await sql`update label_suite.budget_line_items set release_id=${release} where id=${lineId}`;
      expect((await read(orgId, actorId, { release_id: release })).projects.map((project) => project.id)).toEqual([projectId]);
      expect((await read(orgId, actorId, { release_id: release, line_id: lineId })).focus?.line.id).toBe(lineId);
      await sql`update label_suite.budget_line_items set project_id=null where id=${lineId}`;
      expect((await read(orgId, actorId, { release_id: release })).unprojected_lines).toEqual([{ id: lineId, name: 'Mastering' }]);
      expect((await read(orgId, actorId, { release_id: release, line_id: lineId })).focus?.line.currency).toBeNull();
      await sql`update label_suite.budget_line_items set project_id=${projectId},release_id=null where id=${lineId}`;
      await expect(read(orgId, actorId, { release_id: release, line_id: lineId })).rejects.toThrow('not found');
      await expect(read(orgId, actorId, { release_id: release, project_id: projectId })).rejects.toThrow('not found');
    } finally {
      await sql`update label_suite.budget_line_items set project_id=${projectId},release_id=null where id=${lineId}`;
      await sql`update label_suite.budget_projects set release_id=null where id=${projectId}`;
      await sql`delete from label_suite.releases where id=${release}`;
    }
  });

  it("reads one consistent snapshot and preserves evidence identity without private URLs", async () => {
    const documentId = `${orgId}-quote`;
    await sql`insert into label_suite.documents (id,org_id,name,file_link) values (${documentId},${orgId},'Mastering quote','https://private.example.test/secret')`;
    await sql`insert into label_suite.budget_line_documents (id,org_id,budget_line_item_id,document_id,link_type) values (${`${orgId}-evidence`},${orgId},${lineId},${documentId},'quote')`;
    const readService = await import('./native-budget');
    const dashboard = await import('./budget-dashboard');
    const original = dashboard.getBudgetProject;
    const observer = vi.spyOn(dashboard, 'getBudgetProject').mockImplementationOnce(async (...args) => {
      const project = await original(...args);
      await sql`update label_suite.budget_line_items set planned_amount=700 where id=${lineId}`;
      return project;
    });
    try {
      const snapshot = await readService.getNativeBudget(orgId, actorId, { project_id: projectId });
      expect(snapshot.detail!.project.currency).toBe('DKK');
      expect(snapshot.detail!.lines[0]).toMatchObject({ id: lineId, planned_amount: 500, currency: 'DKK', evidence: [{ document_id: documentId, link_type: 'quote' }] });
      expect(snapshot.detail!.buckets.find((bucket) => bucket.bucket === 'production')!.planned).toBe(500);
      expect(JSON.stringify(snapshot)).not.toContain('private.example.test');
      expect((await sql`select planned_amount from label_suite.budget_line_items where id=${lineId}`)[0].planned_amount).toBe(700);
      await expect(readService.getNativeBudget(otherOrg, actorId, { project_id: projectId })).rejects.toThrow('not found');
    } finally { observer.mockRestore(); }
  });

  it("keeps legacy proposals visible but rejects native decisions without verified amount and currency", async () => {
    const created = await service.createVarianceRequest(orgId, { line_id: lineId, variance_reason: 'Legacy request', requested_action: 'increase_amount', requested_value: '650 EUR' }, actorId);
    const request = (await service.listVarianceRequests(orgId, projectId)).find((row) => row.id === created.id)!;
    const [{ revision }] = await sql`select updated_at::text as revision from label_suite.budget_line_items where id=${lineId}`;
    await expect(service.decideVarianceRequestForNative(orgId, { id: request.id, expected_revision: revision, expected_currency: 'DKK', expected_request_revision: request.revision, decision: 'approved' }, actorId)).rejects.toThrow('verified amount');
    expect((await sql`select status from label_suite.budget_line_variance_requests where id=${request.id}`)[0].status).toBe('pending');
  });

  it.each([null, "", "   ", " DKK "])("keeps missing currency %j explicit and disables native financial decisions", async (currency) => {
    await sql`update label_suite.budget_projects set currency=${currency} where id=${projectId}`;
    const readService = await import('./native-budget');
    const snapshot = await readService.getNativeBudget(orgId, actorId, { project_id: projectId });
    expect(snapshot.projects.find((project) => project.id === projectId)!.currency).toBeNull();
    expect(snapshot.detail!.project.currency).toBeNull();
    expect(snapshot.detail!.coverage).toBeNull();
    expect(snapshot.detail!.lines[0].currency).toBeNull();
    expect(snapshot.detail!.variances.every((request) => request.native_decision_blocker !== null)).toBe(true);
  });

  it("opens exact expense and variance destinations beyond pagination, including projectless lines", async () => {
    const { getNativeBudget } = await import("./native-budget");
    await sql`update label_suite.budget_projects set currency='DKK' where id=${projectId}`;
    const [variance] = await sql`select id from label_suite.budget_line_variance_requests where org_id=${orgId} and line_id=${lineId} order by id limit 1`;
    expect(variance).toBeDefined();
    try {
      for (let i = 0; i < 51; i++) await sql`insert into label_suite.budget_line_items(id,org_id,project_id,name,amount) values (${`${orgId}-before-${i}`},${orgId},${projectId},'Earlier expense',1)`;
      const focused = await getNativeBudget(orgId, actorId, { line_id: lineId, variance_id: variance.id });
      expect(focused.focus?.line).toMatchObject({ id: lineId, currency: 'DKK' });
      expect(focused.focus?.variance_id).toBe(variance.id);
      expect(focused.detail?.lines.some(line => line.id === lineId)).toBe(true);
      expect(focused.detail?.total_lines).toBe(52);
      await expect(getNativeBudget(otherOrg, actorId, { line_id: lineId })).rejects.toThrow('not found');
      await expect(getNativeBudget(orgId, actorId, { line_id: lineId, project_id: 'wrong-parent' })).rejects.toThrow('not found');
      await expect(getNativeBudget(orgId, actorId, { line_id: lineId, variance_id: 'missing-variance' })).rejects.toThrow('not found');
      await expect(getNativeBudget(orgId, actorId, { variance_id: variance.id })).rejects.toThrow('requires its expense line');
      await sql`update label_suite.budget_line_items set project_id=null where id=${lineId}`;
      const projectless = await getNativeBudget(orgId, actorId, { line_id: lineId, variance_id: variance.id });
      expect(projectless.detail).toBeNull();
      expect(projectless.focus?.line).toMatchObject({ id: lineId, currency: null });
      expect(projectless.focus?.variances.every(row => row.native_decision_blocker !== null)).toBe(true);
      expect(JSON.stringify(projectless)).not.toContain('private.example.test');
    } finally {
      await sql`update label_suite.budget_line_items set project_id=${projectId} where id=${lineId}`;
      await sql`delete from label_suite.budget_line_items where org_id=${orgId} and id like ${`${orgId}-before-%`}`;
    }
  });

});
