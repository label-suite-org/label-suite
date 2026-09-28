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
