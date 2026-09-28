"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { getNativeRoyaltyStatement } from "../../server/native-royalties";
import type { PreparedRoyaltyStatements } from "../../server/royalty-statements";

import type { getPayoutBatch } from "../../server/royalty-payout-recording";

type Statement = { id: string; contact_name: string | null; period_start: string; period_end: string; currency: string; closing_balance: string; posted_balance: string; status: string; updated_at: string | null };
type Detail = Omit<Awaited<ReturnType<typeof getNativeRoyaltyStatement>>, "statement"> & { statement: Statement };
type Page = { rows: Statement[]; next_offset: number | null };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Request failed. Refresh and try again.");
  return result;
}

export function StatementReview({ canMutate, onChanged }: { canMutate: boolean; onChanged?: () => Promise<void> }) {
  const [page, setPage] = useState<Page>({ rows: [], next_offset: null });
  const [selected, setSelected] = useState<Record<string, { statement: Statement; amount: string }>>({});
  const [batch, setBatch] = useState<Awaited<ReturnType<typeof getPayoutBatch>> | null>(null);
  const payoutAttempt = useRef<{payload: string; key: string} | null>(null);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [lineOffset, setLineOffset] = useState(0);
  const [prepared, setPrepared] = useState<PreparedRoyaltyStatements | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    request<Page>("/api/royalties/statements").then(result => { if (active) setPage(result); })
      .catch(error => { if (active) setError(error.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  }
  async function loadPage(next: number) {
    setPage(await request<Page>(`/api/royalties/statements?offset=${next}`)); setOffset(next);
  }
  async function open(id: string, next = 0) {
    setDetail(await request<Detail>(`/api/royalties/statements/${encodeURIComponent(id)}?offset=${next}`)); setLineOffset(next);
  }
  async function transition(action: "review" | "issue", evidence?: string) {
    if (!detail) return;
    const id = detail.statement.id;
    await request(`/api/royalties/statements/${encodeURIComponent(id)}/${action}`, {
      expected_updated_at: detail.statement.updated_at, ...(action === "issue" ? { evidence_reference: evidence } : {}),
    });
    setMessage(action === "issue" ? "Statement issued and allocation recorded. No payment sent." : "Statement reviewed.");
    await open(id); await loadPage(offset); await onChanged?.();
  }
  return <section className="space-y-4" aria-label="Payee statements" aria-busy={busy}>
    <div><h2 className="text-lg font-semibold">Payee statements</h2><p className="text-sm text-[var(--muted-foreground)]">Calculate earnings, inspect source lines, then review and issue each statement.</p></div>
    {canMutate && <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      void perform(async () => {
        const result = await request<PreparedRoyaltyStatements>("/api/royalties/statements/prepare", Object.fromEntries(data));
        setPrepared(result); setDetail(null); setSelected({}); await loadPage(0); await onChanged?.();
      });
    }}>
      <label>From<Input name="period_start" type="date" required disabled={busy} /></label>
      <label>Through<Input name="period_end" type="date" required disabled={busy} /></label>
      <label>Currency<Input name="currency" aria-label="Currency" defaultValue="USD" pattern="[A-Za-z]{3}" maxLength={3} required disabled={busy} className="w-24" /></label>
      <Button type="submit" disabled={busy}>Calculate statements</Button>
    </form>}
    {prepared && <div role="status" className="text-sm space-y-1">
      <p>{prepared.plans.length} statements · {prepared.protectedStatements.length} existing statements preserved · {prepared.blockers.length} source rows need attention.</p>
      {prepared.blockers.length > 0 && <ul>{prepared.blockers.map((item,index) => <li key={`${item.earningId}-${index}`}>{item.detail} ({item.earningId})</li>)}</ul>}
    </div>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && <p role="status">{message}</p>}
    <Button disabled={busy} onClick={() => void perform(async () => { await loadPage(offset); if (detail) await open(detail.statement.id,lineOffset); })}>Refresh</Button>
    {!busy && page.rows.length === 0 && <p>No calculated statements yet.</p>}
    <ul className="divide-y divide-[var(--border)]">
      {page.rows.map(statement => <li key={statement.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
        <div><strong>{statement.contact_name || "Unnamed payee"}</strong><p className="text-sm">{statement.period_start} – {statement.period_end} · {statement.currency} {statement.closing_balance} · {statement.status}</p></div>
        <div className="flex flex-wrap items-center gap-3">
          {canMutate && ["issued","closed"].includes(statement.status) && <label className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={!!selected[statement.id]} onChange={event => {
            const checked=event.target.checked;
            setSelected(current => { const next={...current}; if (checked) next[statement.id]={statement,amount:""}; else delete next[statement.id]; return next; });
          }} />Include in payout batch</label>}
          <Button disabled={busy} onClick={() => void perform(() => open(statement.id))}>Inspect statement</Button>
        </div>
      </li>)}
    </ul>
    <div className="flex flex-wrap gap-2"><Button disabled={busy || offset === 0} onClick={() => void perform(() => loadPage(Math.max(0,offset-50)))}>Previous statements</Button><Button disabled={busy || page.next_offset === null} onClick={() => void perform(() => loadPage(page.next_offset!))}>Next statements</Button></div>
    {canMutate && Object.keys(selected).length > 0 && <form className="min-w-0 break-words border border-[var(--border)] rounded-lg p-4 space-y-3" onSubmit={event => {
      event.preventDefault(); const data=new FormData(event.currentTarget);
      const payload={reference:String(data.get("reference")),effective_date:String(data.get("effective_date")),lines:Object.values(selected).map(item=>({statement_id:item.statement.id,amount:item.amount}))};
      const signature=JSON.stringify(payload);
      if (payoutAttempt.current?.payload!==signature) payoutAttempt.current={payload:signature,key:crypto.randomUUID()};
      const key=payoutAttempt.current.key;
      void perform(async()=>{
        const result=await request<{batch_id:string}>("/api/royalties/payouts",{...payload,idempotency_key:key});
        setSelected({}); payoutAttempt.current=null; setMessage("Payout batch recorded. No money was sent.");
        setBatch(await request(`/api/royalties/payouts/${encodeURIComponent(result.batch_id)}`));
        await loadPage(offset); if (detail) await open(detail.statement.id); await onChanged?.();
      });
    }}>
      <h3 className="font-semibold">Record completed payments</h3>
      <p className="text-sm">Enter payments already made outside Label Suite. This updates the ledger and does not transfer money.</p>
      {Object.values(selected).map(({statement,amount})=><label key={statement.id} className="block">
        {statement.contact_name || "Unnamed payee"} · {statement.currency} · Posted balance {statement.posted_balance}
        <Input aria-label={`Payment amount for ${statement.contact_name || statement.id}`} inputMode="decimal" pattern="(0|[1-9][0-9]{0,11})([.][0-9]{1,8})?" required disabled={busy} value={amount} onChange={event=>setSelected(current=>({...current,[statement.id]:{statement,amount:event.target.value}}))} />
      </label>)}
      <label className="block">Payment reference<Input name="reference" required maxLength={500} disabled={busy} /></label>
      <label className="block">Payment date<Input name="effective_date" type="date" required disabled={busy} /></label>
      <label className="flex gap-2"><input type="checkbox" required disabled={busy} />These payments have already been made.</label>
      <Button type="submit" disabled={busy}>Record payout batch</Button>
      <Button type="button" disabled={busy} onClick={()=>setSelected({})}>Clear selection</Button>
    </form>}
    {canMutate && batch && <div className="min-w-0 break-words border border-[var(--border)] rounded-lg p-4 space-y-3">
      <h3 className="font-semibold">Recorded batch · {batch.batch.status}</h3>
      <p>{batch.batch.reference} · {batch.batch.effective_date}</p>
      <ul>{batch.lines.map(line=><li key={line.id}>{line.contact_name || "Unnamed payee"} · {line.currency} {line.amount} · Statement {line.statement_id}</li>)}</ul>
      {batch.batch.status==="posted" && <form className="space-y-3" onSubmit={event=>{
        event.preventDefault(); const data=new FormData(event.currentTarget); const id=batch.batch.id;
        void perform(async()=>{
          await request(`/api/royalties/payouts/${encodeURIComponent(id)}/reverse`,Object.fromEntries(data));
          setMessage("Batch recording reversed. No money was moved.");
          setBatch(await request(`/api/royalties/payouts/${encodeURIComponent(id)}`));
          await loadPage(offset); if (detail) await open(detail.statement.id); await onChanged?.();
        });
      }}>
        <p className="text-sm">Reversal restores the balances for every payment listed above. Original entries remain in the audit history.</p>
        <label className="block">Reversal reason or reference<Input name="reference" required maxLength={500} disabled={busy} /></label>
        <label className="block">Reversal date<Input name="effective_date" type="date" min={batch.batch.effective_date} required disabled={busy} /></label>
        <label className="flex gap-2"><input type="checkbox" required disabled={busy} />Reverse the entire batch shown above.</label>
        <Button type="submit" disabled={busy}>Reverse batch recording</Button>
      </form>}
    </div>}
    {detail && <div className="min-w-0 break-words border border-[var(--border)] rounded-lg p-4 space-y-3" key={detail.statement.id + detail.statement.updated_at}>
      <h3 className="font-semibold">{detail.statement.contact_name || "Unnamed payee"} · {detail.statement.status}</h3>
      <p className="text-sm">{detail.statement.period_start} – {detail.statement.period_end} · {detail.statement.currency} {detail.statement.closing_balance}</p>
      <p>Posted balance: {detail.statement.currency} {detail.statement.posted_balance}</p>
      {detail.payouts?.length > 0 && <ul>{detail.payouts.map(payout=><li key={payout.id} className="flex flex-wrap items-center gap-2">
        <span>{payout.currency} {payout.amount} · {payout.status}</span>
        {canMutate && payout.recording_batch_id && <Button disabled={busy} onClick={()=>void perform(async()=>setBatch(await request(`/api/royalties/payouts/${encodeURIComponent(payout.recording_batch_id!)}`)))}>Inspect payout batch</Button>}
      </li>)}</ul>}
      {detail.payouts_truncated && <p>Showing the latest 50 payouts for this statement.</p>}
      <p className="text-sm">Source reconciliation: {detail.reconciliation.earnings_match && detail.reconciliation.balance_match ? "Totals match" : "Needs attention"}. {detail.reconciliation.missing_sources} missing sources · {detail.reconciliation.changed_sources} changed sources · {detail.reconciliation.unresolved_payees} unresolved payees.</p>
      <ul className="divide-y divide-[var(--border)]">{detail.lines.map(line => <li key={line.id} className="py-2 text-sm break-words">
        <p>{line.description || line.track_title || "Earning"} · {detail.statement.currency} {line.amount} · {line.share_percent}%</p>
        <p className="text-[var(--muted-foreground)]">{line.source} · {line.report_period} · Source row {line.source_row_id || "missing"}{line.source_changed ? " · Changed since calculation" : ""}</p>
      </li>)}</ul>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || lineOffset === 0} onClick={() => void perform(() => open(detail.statement.id, Math.max(0,lineOffset-50)))}>Previous lines</Button><Button disabled={busy || detail.next_offset === null} onClick={() => void perform(() => open(detail.statement.id,detail.next_offset!))}>Next lines</Button></div>
      {canMutate && detail.statement.status === "calculated" && <Button disabled={busy} onClick={() => void perform(() => transition("review"))}>Mark reviewed</Button>}
      {canMutate && detail.statement.status === "reviewed" && <form className="space-y-3" onSubmit={event => {
        event.preventDefault(); const data = new FormData(event.currentTarget);
        void perform(() => transition("issue",String(data.get("evidence_reference"))));
      }}>
        <label className="block">Review reference<Input name="evidence_reference" required maxLength={500} disabled={busy} /></label>
        <label className="flex items-start gap-2"><input type="checkbox" required disabled={busy} />I have checked the sources and payee shares. Issuing records the allocation in the ledger.</label>
        <Button type="submit" disabled={busy}>Issue statement</Button>
      </form>}
    </div>}
  </section>;
}
