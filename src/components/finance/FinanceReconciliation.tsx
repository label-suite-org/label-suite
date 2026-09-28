import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { getFinanceReconciliationView } from "../../server/finance-reconciliation";

type View = Awaited<ReturnType<typeof getFinanceReconciliationView>>;
const matchNames = {royalty_receipt:"Royalty import",payout_batch:"Payout batch",budget_spend:"Budget line"};
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString() : "—";
function residual(amount: string, allocated: string) {
  if (!/^\d{1,12}(?:\.\d{1,8})?$/.test(allocated)) return null;
  const units = (value: string) => { const [whole,fraction=""] = value.split("."); return BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,"0")); };
  const left = units(amount)-units(allocated);
  return left < 0n ? null : `${left/100000000n}.${String(left%100000000n).padStart(8,"0")}`;
}

export default function FinanceReconciliation({canMutate}:{canMutate:boolean}) {
  const workbench = useRef<HTMLElement>(null);
  const queue = useRef<HTMLElement>(null);
  const focusSelection = useRef<"detail"|"queue"|null>(null);
  const [filter,setFilter] = useState("unmatched");
  const [offset,setOffset] = useState(0);
  const [selected,setSelected] = useState("");
  const [search,setSearch] = useState("");
  const [revision,setRevision] = useState(0);
  const [data,setData] = useState<View|null>(null);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const [target,setTarget] = useState("");
  const [amount,setAmount] = useState("");
  useEffect(()=>{
    const controller = new AbortController();
    setData(null);setError("");setTarget("");setAmount("");
    const query = new URLSearchParams({status:filter,offset:String(offset),search});
    if(selected) query.set("transaction",selected);
    fetch(`/api/finance/reconciliation?${query}`,{signal:controller.signal}).then(async response=>{
      const body = await response.json();if(!response.ok) throw new Error(body.error ?? "Could not load reconciliation");
      if(!controller.signal.aborted) setData(body);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Could not load reconciliation");});
    return ()=>controller.abort();
  },[filter,offset,selected,search,revision]);
  useEffect(()=>{
    if(data && focusSelection.current) {
      (focusSelection.current==="detail"?workbench:queue).current?.focus();
      focusSelection.current=null;
    }
  },[data]);
  async function submit(path:string,body:unknown,message:string) {
    setBusy(true);setError("");setNotice("");
    try {
      const response=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error??"Could not save. Your input is unchanged.");
      setNotice(message);focusSelection.current=selected?"detail":"queue";setRevision(value=>value+1);return true;
    } catch(reason) {setError(reason instanceof Error?reason.message:"Could not save");return false;}
    finally {setBusy(false);}
  }
  async function importEntry(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();const form=event.currentTarget;const fields=Object.fromEntries(new FormData(form));
    const {reference,...input}=fields;
    if(await submit("/api/finance/reconciliation",{...input,idempotency_key:fields.external_transaction_id,raw_evidence:{...fields,entry_method:"manual"}},"Transaction imported. No bank or bookkeeping entry was changed.")) form.reset();
  }
  const detail=data?.detail;
  const candidate=data?.candidates.find(row=>`${row.type}:${row.id}`===target);
  const after=detail&&amount?residual(detail.remaining,amount):null;
  return <section className="space-y-5" aria-label="Finance reconciliation">
    <header><h1 className="text-2xl font-semibold">Money &amp; budgets</h1><p className="mt-1 text-sm text-muted-foreground">Match imported transactions to the work they paid for. No payments or bookkeeping entries are made here.</p></header>
    {error&&<p role="alert" className="text-sm text-destructive">{error} {!data&&<Button variant="outline" size="sm" onClick={()=>setRevision(value=>value+1)} disabled={busy}>Retry loading</Button>}</p>}
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    {canMutate&&<details className="border-b pb-4"><summary className="cursor-pointer text-sm font-medium">Import a transaction manually</summary>
      <p className="my-3 text-sm text-muted-foreground">Copy one transaction from your bank or accounting export. Keep its original reference; the entered fields are retained as source evidence.</p>
      <form onSubmit={importEntry} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Source<Input name="source_provider" required placeholder="Bank or accounting export" /></label>
        <label className="text-sm">Account<Input name="account_label" required /></label>
        <label className="text-sm">Transaction reference<Input name="external_transaction_id" required /></label>
        <label className="text-sm">Date<Input name="occurred_at" type="date" required /></label>
        <label className="text-sm">Amount<Input name="amount" inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,8})?" required /></label>
        <label className="text-sm">Currency<Input name="currency" placeholder="DKK" pattern="[A-Za-z]{3}" required /></label>
        <label className="text-sm">Direction<select name="direction" className="mt-1 block w-full rounded-md border bg-background p-2"><option value="debit">Outgoing</option><option value="credit">Incoming</option></select></label>
        <label className="text-sm">Description<Input name="description" /></label>
        <label className="text-sm sm:col-span-2">Evidence reference<Input name="reference" required placeholder="Export filename or source reference" /></label>
        <Button type="submit" disabled={busy} className="sm:col-span-2">Import transaction</Button>
      </form>
    </details>}
    <div className="flex flex-wrap gap-2" role="group" aria-label="Transaction filters">{[["unmatched","Unmatched"],["partially_matched","Partial"],["matched","Matched"],["all","All"]].map(([value,label])=><Button key={value} variant={filter===value?"default":"outline"} size="sm" aria-pressed={filter===value} disabled={busy} onClick={()=>{setFilter(value);setOffset(0);setSelected("");setSearch("");}}>{label}</Button>)}</div>
    {!data&&!error&&<p role="status" className="text-sm text-muted-foreground">Loading transactions…</p>}
    {data&&<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(16rem,1fr)_minmax(0,2fr)]">
      <section ref={queue} tabIndex={-1} aria-label="Transactions" className={`min-w-0 ${detail?"hidden lg:block":""}`}><h2 className="sr-only">Transactions</h2>
        {!data.transactions.length&&<p className="py-6 text-sm text-muted-foreground">No transactions in this view.</p>}
        <ul className="divide-y">{data.transactions.map(row=><li key={row.id}><button disabled={busy} aria-pressed={selected===row.id} className={`w-full min-w-0 py-4 text-left ${selected===row.id?"border-l-2 border-primary pl-3":""}`} onClick={()=>{focusSelection.current="detail";setSelected(row.id);setSearch("");setNotice("");}}>
          <span className="block text-xs text-muted-foreground">{date(row.occurredAt)} · {row.account}</span><span className="block break-words font-medium">{row.description||"Transaction"}</span>
          <span className="block text-sm">{row.direction==="credit"?"Incoming":"Outgoing"} · {row.currency} {row.amount}</span><span className="text-xs text-muted-foreground">Remaining {row.currency} {row.remaining}</span>
        </button></li>)}</ul>
        <div className="mt-3 flex justify-between"><Button variant="outline" size="sm" disabled={offset===0||busy} onClick={()=>setOffset(value=>Math.max(0,value-50))}>Previous</Button><Button variant="outline" size="sm" disabled={!data.hasMore||busy} onClick={()=>setOffset(value=>value+50)}>Next</Button></div>
      </section>
      <section ref={workbench} tabIndex={-1} className="min-w-0 space-y-5" aria-label="Selected transaction">
        {detail&&<Button variant="outline" className="lg:hidden" onClick={()=>{focusSelection.current="queue";setSelected("");setSearch("");}}>Back to transactions</Button>}
        {!detail?<p className="py-6 text-sm text-muted-foreground">Select a transaction to inspect its evidence and matches.</p>:<>
          <header><h2 className="break-words text-lg font-semibold">{detail.description||"Transaction details"}</h2><p className="text-sm">{detail.source_provider} · {detail.account_label} · {date(detail.occurred_at)}</p><p className="mt-2 font-medium">Remaining {detail.currency} {detail.remaining}</p></header>
          <details className="border-y py-3"><summary className="cursor-pointer text-sm font-medium">Source evidence</summary><dl className="mt-3 space-y-2 break-all text-xs"><dt>Reference</dt><dd>{detail.external_transaction_id||"—"}</dd><dt>Source hash</dt><dd>{detail.raw_source_hash}</dd></dl><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(detail.raw_evidence,null,2)}</pre></details>
          {canMutate&&detail.status!=="matched"&&<section aria-label="Record match"><h3 className="font-medium">Record match</h3>
            <form className="my-3 flex gap-2" onSubmit={event=>{event.preventDefault();setSearch(String(new FormData(event.currentTarget).get("search")||""));}}><Input aria-label="Find matching records" name="search" defaultValue={search} placeholder="Find an import, batch or budget line" /><Button variant="outline" disabled={busy}>Search</Button></form>
            <form className="space-y-3" onSubmit={async event=>{event.preventDefault();if(!candidate)return;const fields=new FormData(event.currentTarget);await submit(`/api/finance/reconciliation/${encodeURIComponent(detail.id)}/match`,{match_type:candidate.type,target_id:candidate.id,allocated_amount:amount,rationale:fields.get("rationale")},"Match recorded.");}}>
              <label className="block text-sm">Match to<select required className="mt-1 w-full min-w-0 rounded-md border bg-background p-2" value={target} onChange={event=>setTarget(event.target.value)}><option value="">Choose a record</option>{Object.entries(matchNames).map(([type,label])=><optgroup key={type} label={label}>{data.candidates.filter(row=>row.type===type).map(row=><option key={row.id} value={`${row.type}:${row.id}`}>{row.label}</option>)}</optgroup>)}</select></label>
              {candidate&&<div className="space-y-1 border-l-2 pl-3 text-sm" aria-label="Selected match target"><p className="break-words font-medium">{candidate.label}</p><p>{candidate.type==="budget_spend"?"Budget amount":"Source total"}: {candidate.amount===null?"Not recorded":`${candidate.currency} ${candidate.amount}`}</p><p className="break-all text-xs text-muted-foreground">Reference: {candidate.id}</p></div>}
              {!data.candidates.length&&<p className="text-sm text-muted-foreground">No eligible records found. Records must be in this workspace with a matching currency and direction.</p>}
              <label className="block text-sm">Allocation amount ({detail.currency})<Input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} /></label>
              <label className="block text-sm">Reason<Input name="rationale" required /></label><p className="text-sm text-muted-foreground">Remaining after match: {after===null?"Enter a valid amount within the remaining balance":`${detail.currency} ${after}`}</p>
              <Button type="submit" disabled={busy||!candidate||after===null||!/[1-9]/.test(amount)}>Record match</Button>
            </form>
          </section>}
          <section aria-label="Match history"><h3 className="font-medium">History</h3>{!detail.matches.length&&<p className="mt-2 text-sm text-muted-foreground">No matches recorded.</p>}<ul className="divide-y">{detail.matches.map(match=><li key={match.id} className="space-y-2 py-4 text-sm"><p>{matchNames[match.match_type as keyof typeof matchNames]} · {detail.currency} {match.allocated_amount} · {match.status}</p><p className="break-all text-xs text-muted-foreground">{match.target_id}</p><p className="break-words">{match.rationale}</p><p className="break-all text-xs text-muted-foreground">{date(match.created_at)} · {match.actorName||"Unknown actor"}</p>{match.status==="reversed"&&<p className="break-words text-xs">Reversed {date(match.reversed_at)} · {match.reversedByName||"Unknown actor"} · {match.reversal_reason}</p>}
            {canMutate&&match.status==="active"&&<details><summary className="cursor-pointer text-xs">Reverse match</summary><form className="mt-2 flex flex-wrap gap-2" onSubmit={async event=>{event.preventDefault();await submit(`/api/finance/reconciliation/${encodeURIComponent(detail.id)}/reverse`,{id:match.id,reversal_reason:new FormData(event.currentTarget).get("reason")},"Match reversed. The remaining amount has been restored.");}}><Input className="min-w-0 flex-1" aria-label="Reversal reason" name="reason" required /><Button variant="outline" disabled={busy}>Confirm reversal</Button></form></details>}
          </li>)}</ul></section>
        </>}
      </section>
    </div>}
  </section>;
}
