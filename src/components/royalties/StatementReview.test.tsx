/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StatementReview } from "./StatementReview";

const statement = { id:"statement-a",contact_name:"Test payee",period_start:"2026-08-01",period_end:"2026-08-31",currency:"EUR",closing_balance:"1.00000000",status:"calculated",updated_at:"2026-09-28T00:00:00.000Z" };
const detail = { statement,lines:[],next_offset:null,reconciliation:{earnings_match:true,balance_match:true,missing_sources:0,changed_sources:0,unresolved_payees:0} };
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML=""; });
it("keeps a stale review visible, refreshes its version, and exposes no mutations to read-only users", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const fetch = vi.fn(async (_url: string, options?: RequestInit) => options?.method === "POST"
    ? new Response(JSON.stringify({error:"Statement changed. Refresh first."}),{status:409})
    : new Response(JSON.stringify(_url.includes("statement-a") ? detail : {rows:[statement],next_offset:null})));
  vi.stubGlobal("fetch",fetch);
  const element=document.createElement("div"); document.body.append(element); const root=createRoot(element);
  const button=(text:string) => [...element.querySelectorAll("button")].find(item=>item.textContent===text)!;
  try {
    await act(async()=>root.render(<StatementReview canMutate />));
    await act(async()=>button("Inspect statement").click());
    await act(async()=>button("Mark reviewed").click());
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("Refresh first");
    const call=fetch.mock.calls.find(([,options])=>options?.method==="POST")!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({expected_updated_at:statement.updated_at});
    expect(button("Mark reviewed")).toBeTruthy();
    await act(async()=>button("Refresh").click());
    expect(element.querySelector('[role="alert"]')).toBeNull();
    await act(async()=>root.render(<StatementReview canMutate={false} />));
    expect(button("Mark reviewed")).toBeUndefined();
    expect(button("Calculate statements")).toBeUndefined();
    expect(element.textContent).toContain("Test payee");
  } finally { await act(async()=>root.unmount()); }
});

it("records multiple selected statements with one stable key when a response is lost",async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  const rows=[{...statement,status:"issued",posted_balance:"1.00000000"},{...statement,id:"statement-b",contact_name:"Second payee",status:"issued",posted_balance:"1.00000000"}];
  let attempts=0;
  const fetch=vi.fn(async(url:string,options?:RequestInit)=>{
    if(options?.method==="POST") {
      if(++attempts===1) throw new TypeError("Network response lost");
      return new Response(JSON.stringify({batch_id:"payout-batch:test"}));
    }
    return new Response(JSON.stringify(url.includes("/payouts/") ? {batch:{id:"payout-batch:test",status:"posted",reference:"Test receipt",effective_date:"2026-09-28"},lines:[]} : {rows,next_offset:null}));
  });
  vi.stubGlobal("fetch",fetch);
  const element=document.createElement("div");document.body.append(element);const root=createRoot(element);
  const input=(field:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(field,value);field.dispatchEvent(new Event("input",{bubbles:true}));};
  try {
    await act(async()=>root.render(<StatementReview canMutate />));
    await act(async()=>{element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(field=>field.click());});
    const form=[...element.querySelectorAll("form")].find(item=>item.textContent?.includes("Record completed payments"))!;
    await act(async()=>{
      form.querySelectorAll<HTMLInputElement>('input[inputmode="decimal"]').forEach(field=>input(field,"0.25"));
      input(form.querySelector('[name="reference"]')!,"Test receipt");input(form.querySelector('[name="effective_date"]')!,"2026-09-28");
      form.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    });
    expect(form.checkValidity()).toBe(true);
    await act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(element.querySelector('[role="alert"]')?.textContent).toContain("Network response lost");
    await act(async()=>form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    const requests=fetch.mock.calls.filter(([,options])=>options?.method==="POST").map(([,options])=>JSON.parse(String(options?.body)));
    expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
    expect(requests[0].lines).toEqual([{statement_id:"statement-a",amount:"0.25"},{statement_id:"statement-b",amount:"0.25"}]);
    expect(element.textContent).toContain("Payout batch recorded. No money was sent.");
  } finally { await act(async()=>root.unmount()); }
});
