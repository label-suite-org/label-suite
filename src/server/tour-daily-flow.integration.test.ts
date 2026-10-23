import { createHash, randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const enabled = process.env.TOUR_DAILY_INTEGRATION === "1";
const org = `tour-daily-${randomUUID()}`, actor = `${org}-actor`;
const project = `${org}-project`, show = `${org}-show`, allowance = `${org}-allowance`;
let sql: Sql;
let service: typeof import("./tour-daily-flow");
let dashboard: typeof import("./native-tour-dashboard");
const expense = (extra = {}) => ({ action: "expense", request_id: randomUUID(), name: "Fuel", amount: 1234, currency: "USD", date: "2026-10-19", show_id: show, person: "Tour member", paid: true, category: "Fuel", budget_line_id: allowance, note: "", ...extra });

describe.skipIf(!enabled)("tour daily flow on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (url.hostname !== "127.0.0.1" || !url.pathname.endsWith("_fixture")) throw Error("Disposable local fixture required");
    sql = postgres(url.toString(), { max: 1 });
    service = await import("./tour-daily-flow");
    dashboard = await import("./native-tour-dashboard");
    await sql`insert into label_suite.user(id,name,email,"emailVerified") values (${actor},'Tour member',${`${actor}@example.test`},true)`;
    await sql`insert into label_suite.orgs(id,name,slug) values (${org},'Disposable tour',${org})`;
    await sql`insert into label_suite.budget_projects(id,org_id,name,project_type,currency,start_date,end_date) values (${project},${org},'Road fixture','tour','USD','2026-10-18','2026-10-22')`;
    await sql`insert into label_suite.project_events(id,org_id,project_id,title,event_type,start_date,timezone) values (${show},${org},${project},'Fixture show','concert','2026-10-19','America/Los_Angeles')`;
    await sql`insert into label_suite.tour_show_details(id,org_id,event_id,guarantee,currency) values (${`${show}-details`},${org},${show},500,'USD')`;
    await sql`insert into label_suite.budget_line_items(id,org_id,project_id,name,amount,planned_amount,forecast_amount,paid_amount,committed_amount,lock_status) values (${allowance},${org},${project},'Fuel allowance',100,100,100,0,0,'open')`;
  });
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from label_suite.tour_receipts where org_id=${org}`;
    await sql`delete from label_suite.tour_money_entries where org_id=${org}`;
    await sql`delete from label_suite.tour_show_details where org_id=${org}`;
    await sql`delete from label_suite.project_events where org_id=${org}`;
    await sql`delete from label_suite.budget_line_items where org_id=${org}`;
    await sql`delete from label_suite.budget_projects where org_id=${org}`;
    await sql`delete from label_suite.audit_logs where org_id=${org}`;
    await sql`delete from label_suite.orgs where id=${org}`;
    await sql`delete from label_suite.user where id=${actor}`;
    await sql.end();
    await (await import("../lib/db")).pool.end();
  });
  const read = () => dashboard.getNativeTourDashboard(org, project, new Date("2026-10-19T20:00:00Z"));

  it("saves concurrent retries once across the ledger, allowance and audit", async () => {
    const input = expense();
    const receipts = await Promise.all([service.saveTourDailyEntry(org, project, actor, input), service.saveTourDailyEntry(org, project, actor, input)]);
    expect(receipts.map(r => r.repeated).sort()).toEqual([false, true]);
    expect(receipts[0].entry_id).toBe(receipts[1].entry_id);
    const [line] = await sql`select paid_amount,forecast_amount from label_suite.budget_line_items where id=${allowance}`;
    expect(line).toMatchObject({ paid_amount: 12.34, forecast_amount: 100 });
    expect((await sql`select count(*)::int as n from label_suite.audit_logs where request_id=${input.request_id}`)[0].n).toBe(1);
    await expect(service.saveTourDailyEntry(org, project, actor, { ...input, amount: 999 })).rejects.toThrow("different values");
    const view = (await read())!;
    expect(view.daily).toHaveLength(5);
    expect(view.shows[0]).toMatchObject({ id: show, cash: null, received: null, expenses: 1234 });
    expect(view.money.forecast_cost).toBe(10000);
    expect(view.allowances[0].remaining).toBe(8766);
    expect(view.spending).toEqual({ paid: 1234, due: 0, unknown: 0 });
  });

  it("adds unbudgeted costs while keeping foreign currency separate", async () => {
    await service.saveTourDailyEntry(org, project, actor, expense({ budget_line_id: "", paid: false, amount: 2000 }));
    await service.saveTourDailyEntry(org, project, actor, expense({ budget_line_id: "", currency: "CAD", amount: 4500 }));
    const view = (await read())!;
    expect(view.money.forecast_cost).toBe(12000);
    expect(view.spending).toEqual({ paid: 1234, due: 2000, unknown: 0 });
    expect(view.money.attention).toContain("Other-currency entries are kept separately and excluded from this forecast.");
    await expect(service.saveTourDailyEntry(org, project, actor, expense({ currency: "CAD" }))).rejects.toThrow("allowance");
    await expect(service.saveTourDailyEntry(org, project, actor, expense({ show_id: "other-tour-show" }))).rejects.toThrow("outside this tour");
    await expect(service.saveTourDailyEntry("other-org", project, actor, expense())).rejects.toThrow("not found");
  });

  it("preserves unknowns, accepts confirmed zero, and rejects stale show totals", async () => {
    const initial = (await read())!.shows[0];
    const close = { action: "close_show", request_id: randomUUID(), show_id: show, expected_revision: initial.revision, cash_total: 0, payment_total: null, note: "Counted cash" };
    const receipt = await service.saveTourDailyEntry(org, project, actor, close);
    expect(await service.saveTourDailyEntry(org, project, actor, close)).toMatchObject({ entry_id: receipt.entry_id, repeated: true });
    let current = (await read())!.shows[0];
    expect(current).toMatchObject({ cash: 0, received: null });
    expect(current.closed_at).not.toBeNull();
    await expect(service.saveTourDailyEntry(org, project, actor, { ...close, request_id: randomUUID(), cash_total: 10000 })).rejects.toThrow("changed");
    expect((await read())!.shows[0].cash).toBe(0);
    // A pre-existing imported cash sale is part of the full total, never added twice.
    const source = `${org}-imported-cash`;
    await sql`insert into label_suite.tour_money_entries(id,org_id,project_id,source_key,data) values (${source},${org},${project},${source},${sql.json({kind:"merch_cash",source,amount:2500,currency:"USD",date:"2026-10-19",show:""})})`;
    current = (await read())!.shows[0];
    expect(current.cash).toBe(2500);
    const update = { ...close, request_id: randomUUID(), expected_revision: current.revision, cash_total: 10000, payment_total: 50000 };
    await service.saveTourDailyEntry(org, project, actor, update);
    expect((await read())!.shows[0]).toMatchObject({ cash: 10000, received: 50000 });
    current = (await read())!.shows[0];
    await service.saveTourDailyEntry(org, project, actor, { ...update, request_id: randomUUID(), expected_revision: current.revision, cash_total: 4000, payment_total: 30000 });
    expect((await read())!.shows[0]).toMatchObject({ cash: 4000, received: 30000 });
    current = (await read())!.shows[0];
    await expect(service.saveTourDailyEntry(org, project, actor, { ...update, request_id: randomUUID(), expected_revision: current.revision, cash_total: 2000 })).rejects.toThrow("below other recorded income");
    expect((await read())!.shows[0]).toMatchObject({ cash: 4000, received: 30000 });
  });

  it("rolls back locked allowances and refuses to resurrect voided retries", async () => {
    await sql`update label_suite.budget_line_items set lock_status='locked' where id=${allowance}`;
    const input = expense();
    await expect(service.saveTourDailyEntry(org, project, actor, input)).rejects.toThrow("requires budget approval");
    expect((await sql`select count(*)::int as n from label_suite.audit_logs where request_id=${input.request_id}`)[0].n).toBe(0);
    const saved = await service.saveTourDailyEntry(org, project, actor, expense({ budget_line_id: "" }));
    await sql`update label_suite.tour_money_entries set voided=true where id=${saved.entry_id}`;
    const [row] = await sql`select after_data from label_suite.audit_logs where request_id=${saved.request_id}`;
    await expect(service.saveTourDailyEntry(org, project, actor, row.after_data)).rejects.toThrow("voided");
  });
  it("links receipt retries once and attaches rescans without changing the budget", async () => {
    const receipt = randomUUID(), rescan = randomUUID();
    await sql`insert into label_suite.tour_receipts(id,org_id,project_id,sha256,document_id,status) values (${receipt},${org},${project},${receipt},1234,'review'),(${rescan},${org},${project},${rescan},1235,'review')`;
    const input = expense({receipt_id:receipt,budget_line_id:"",amount:7777,distinct_purchase:true});
    const results = await Promise.all([service.saveTourDailyEntry(org,project,actor,input),service.saveTourDailyEntry(org,project,actor,{...input,request_id:randomUUID()})]);
    expect(results[0].entry_id).toBe(results[1].entry_id);
    const before = (await read())!.money.forecast_cost;
    await expect(service.saveTourDailyEntry(org,project,actor,{...input,receipt_id:rescan,request_id:randomUUID(),distinct_purchase:false})).rejects.toThrow("recorded expense");
    const attach = {...input,receipt_id:rescan,request_id:randomUUID(),existing_entry_id:results[0].entry_id,distinct_purchase:false};
    const linked = await service.saveTourDailyEntry(org,project,actor,attach);
    expect(linked.entry_id).toBe(results[0].entry_id);
    expect((await read())!.money.forecast_cost).toBe(before);
    expect((await sql`select count(*)::int n from label_suite.tour_receipts where entry_id=${linked.entry_id}`)[0].n).toBe(2);
    await expect(service.saveTourDailyEntry('other-org',project,actor,input)).rejects.toThrow("not found");
    await expect(service.saveTourDailyEntry(org,project,actor,{...input,receipt_id:randomUUID(),request_id:randomUUID()})).rejects.toThrow("not ready");
  });

  it("returns current expense matches when an uploaded PDF resumes a ready receipt", async () => {
    const entry = await service.saveTourDailyEntry(org,project,actor,expense({amount:5432,budget_line_id:""}));
    const id=randomUUID(),pdf=new TextEncoder().encode('%PDF-fixture-duplicate');
    const hash=createHash('sha256').update(pdf).digest('hex');
    await sql`insert into label_suite.tour_receipts(id,org_id,project_id,sha256,document_id,status,content) values (${id},${org},${project},${hash},54321,'review','TOTAL USD 54.32')`;
    const before={org:process.env.PAPERLESS_ORG_ID,url:process.env.PAPERLESS_URL,token:process.env.PAPERLESS_TOKEN};
    Object.assign(process.env,{PAPERLESS_ORG_ID:org,PAPERLESS_URL:'https://archive.example.invalid',PAPERLESS_TOKEN:'fixture'});
    try {
      const {uploadTourReceipt}=await import('./tour-receipts');
      const resumed=await uploadTourReceipt(org,project,randomUUID(),pdf);
      expect(resumed.id).toBe(id);
      expect(resumed.matches.map(m=>m.id)).toContain(entry.entry_id);
    } finally {
      for (const [key,value] of Object.entries({PAPERLESS_ORG_ID:before.org,PAPERLESS_URL:before.url,PAPERLESS_TOKEN:before.token})) {
        if(value===undefined) delete process.env[key]; else process.env[key]=value;
      }
    }
  });

  it("keeps a saved receipt saved when an older OCR request finishes", async () => {
    const id=randomUUID(), task=randomUUID();
    await sql`insert into label_suite.tour_receipts(id,org_id,project_id,sha256,task_id,status) values (${id},${org},${project},${id},${task},'processing')`;
    const before={org:process.env.PAPERLESS_ORG_ID,url:process.env.PAPERLESS_URL,token:process.env.PAPERLESS_TOKEN};
    Object.assign(process.env,{PAPERLESS_ORG_ID:org,PAPERLESS_URL:'https://archive.example.invalid',PAPERLESS_TOKEN:'fixture'});
    let entry: string | undefined;
    vi.stubGlobal('fetch',vi.fn(async (url: string) => {
      if (url.includes('/api/tasks/')) return Response.json([{task_id:task,status:'SUCCESS',related_document:55667}]);
      // Another request finishes OCR and the user saves while this document read is outstanding.
      await sql`update label_suite.tour_receipts set status='review',document_id=55667 where id=${id}`;
      const result=await service.saveTourDailyEntry(org,project,actor,expense({receipt_id:id,amount:7654,budget_line_id:'',distinct_purchase:true}));
      entry=result.entry_id;
      return Response.json({content:'TOTAL USD 76.54'});
    }));
    try {
      const {getTourReceipt}=await import('./tour-receipts');
      expect(await getTourReceipt(org,project,id)).toMatchObject({status:'saved'});
      expect((await sql`select entry_id,status from label_suite.tour_receipts where id=${id}`)[0]).toEqual({entry_id:entry,status:'saved'});
    } finally {
      vi.unstubAllGlobals();
      for (const [key,value] of Object.entries({PAPERLESS_ORG_ID:before.org,PAPERLESS_URL:before.url,PAPERLESS_TOKEN:before.token})) {
        if(value===undefined) delete process.env[key]; else process.env[key]=value;
      }
    }
  });

});
