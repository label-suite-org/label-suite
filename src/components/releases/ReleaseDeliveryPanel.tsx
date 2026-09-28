import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import type { listReleaseDeliveryAttempts } from "../../server/delivery-exports";

type Attempt = Awaited<ReturnType<typeof listReleaseDeliveryAttempts>>[number];
const timestamp = (value: unknown) => value ? new Date(String(value)).toLocaleString() : "Unknown time";
const providerName = (key:string) => key === "manual_dsp" ? "Manual export" : key.replaceAll("_"," ");
const statusLabel = (status: string) => status === "exported" ? "Exported for manual delivery" : status;

export function ReleaseDeliveryPanel({releaseId,canManage,compact=false,onOpen,onInspect}:{releaseId:string;canManage:boolean;compact?:boolean;onOpen:()=>void;onInspect:(tracks:boolean)=>void}) {
  const [attempts,setAttempts]=useState<Attempt[]|null>(null);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const [revision,setRevision]=useState(0);
  const [notice,setNotice]=useState("");
  useEffect(()=>{
    const controller=new AbortController();setError("");
    fetch(`/api/releases/${encodeURIComponent(releaseId)}/delivery/export`,{signal:controller.signal}).then(async response=>{
      const body=await response.json();if(!response.ok)throw new Error(body.error??"Could not load delivery history");
      if(!controller.signal.aborted)setAttempts(body.attempts);
    }).catch(reason=>{if(!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Could not load delivery history");});
    return()=>controller.abort();
  },[releaseId,revision]);
  const groups=new Map<string,Attempt[]>();
  for(const attempt of attempts??[]) {const key=JSON.stringify([attempt.provider_key,attempt.account_label]);const history=groups.get(key);if(history)history.push(attempt);else groups.set(key,[attempt]);}
  if(compact)return <div className="flex flex-wrap items-center justify-between gap-2 border-y py-3 text-sm"><p>Latest manual export · {error?"History unavailable":attempts===null?"Loading…":attempts.length?`${providerName(attempts[0].provider_key)} · ${attempts[0].account_label} · ${statusLabel(attempts[0].status)}`:"No exports yet"}</p><Button type="button" variant="outline" size="sm" onClick={onOpen}>Open delivery</Button></div>;
  function renderAttempt(attempt:Attempt) {
    const evidence=attempt.response_evidence;
    const warnings=Array.isArray(evidence.warnings)?evidence.warnings as Array<{code:string;message:string;track_id?:string}>:[];
    return <div className="space-y-2 py-3 text-sm">
      <p className="font-medium">{statusLabel(attempt.status)} · Version {attempt.payload_version}.{attempt.patch_version}</p>
      <p className="text-xs text-muted-foreground">{timestamp(attempt.created_at)}</p>
      <a className="inline-block underline underline-offset-4" download={`${releaseId}-${attempt.provider_key}-v${attempt.payload_version}.${attempt.patch_version}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(attempt.payload,null,2))}`}>Download JSON</a>
      {!!warnings.length&&<ul className="space-y-1">{warnings.map(warning=><li key={`${warning.code}:${warning.track_id??"release"}`}><span>{warning.message}. </span><button type="button" className="underline underline-offset-4" onClick={()=>onInspect(Boolean(warning.track_id))}>{warning.track_id?"Review tracks":"Review UPC/EAN"}</button></li>)}</ul>}
      {attempt.error_message&&<p className="text-destructive">{attempt.error_message}</p>}
      <details><summary className="cursor-pointer text-xs">Export evidence</summary><p className="mt-2 break-all text-xs">Payload hash: {attempt.payload_hash}</p><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(evidence,null,2)}</pre></details>
    </div>;
  }
  return <section aria-label="Manual DSP delivery" className="min-w-0 space-y-4 border-b pb-5">
    <header><h2 className="text-lg font-semibold">Manual DSP delivery</h2><p className="mt-1 text-sm text-muted-foreground">Prepare a versioned metadata file for your distributor. Exporting does not submit a release to any DSP.</p></header>
    {error&&<p role="alert" className="text-sm text-destructive">{error} <Button type="button" size="sm" variant="outline" onClick={()=>setRevision(value=>value+1)}>Reload history</Button></p>}
    {notice&&<p role="status" className="text-sm">{notice}</p>}
    {canManage&&<form className="flex flex-wrap items-end gap-3" onSubmit={async event=>{
      event.preventDefault();const fields=new FormData(event.currentTarget);setBusy(true);setError("");setNotice("");
      try {const response=await fetch(`/api/releases/${encodeURIComponent(releaseId)}/delivery/export`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider_key:String(fields.get("provider")).trim().toLowerCase()==="manual export"?"manual_dsp":String(fields.get("provider")).trim().toLowerCase().replace(/\s+/g,"_"),account_label:fields.get("account")})});const body=await response.json();if(!response.ok)throw new Error(body.error??"Could not prepare export");setNotice("Export prepared. Download its JSON below; nothing was submitted to a DSP.");setRevision(value=>value+1);}catch(reason){setError(reason instanceof Error?reason.message:"Could not prepare export");}finally{setBusy(false);}
    }}>
      <label className="min-w-0 flex-1 text-sm">Distributor / destination<Input name="provider" defaultValue="Manual export" pattern="[A-Za-z0-9][A-Za-z0-9 _-]*" required /></label>
      <label className="min-w-0 flex-1 text-sm">Distributor account<Input name="account" defaultValue="Manual export" required /></label>
      <Button type="submit" disabled={busy}>Prepare JSON export</Button>
    </form>}
    {attempts===null&&!error&&<p role="status">Loading delivery history…</p>}
    {attempts?.length===0&&<p className="text-sm text-muted-foreground">No exports yet. Prepare the first file when your release metadata is ready.</p>}
    {[...groups.entries()].map(([key,history])=><section key={key} className="min-w-0 border-t pt-3" aria-label={`${providerName(history[0].provider_key)} · ${history[0].account_label}`}><h3 className="break-words font-medium">{providerName(history[0].provider_key)} · {history[0].account_label}</h3>{renderAttempt(history[0])}{history.length>1&&<details><summary className="cursor-pointer text-sm">Earlier exports ({history.length-1})</summary><div className="divide-y">{history.slice(1).map(attempt=><div key={attempt.id}>{renderAttempt(attempt)}</div>)}</div></details>}</section>)}
  </section>;
}
