import { formatCoverageMoney } from "../funding/money";

export interface GrantGuidance {
  id: string;
  project_id?: string | null;
  workflow_stage?: string | null;
  name: string | null;
  currency: string | null;
  amount_awarded: number | null;
  reference: string | null;
  purpose: string | null;
  source_url?: string | null;
  notes: string | null;
  next_action: string | null;
  reporting_due: string | null;
  project_name: string | null;
}

export default function BudgetGrantGuidance({ grants, title = "Grant details" }: { grants: GrantGuidance[]; title?: string }) {
  return <section className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Award amounts keep their original currency. Check project scope before allocating expenses.</p></div>
      <a href="/grants" className="text-sm underline underline-offset-4">Manage grants</a>
    </div>
    {grants.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No awarded grants recorded yet.</p> :
      <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
        {grants.map(grant => <article key={grant.id} id={`grant-${grant.id}`} className="min-w-0 rounded-md border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="font-medium">{grant.name}</h3>
            <span className="font-semibold tabular-nums">{grant.amount_awarded == null ? "Award amount unverified" : formatCoverageMoney(grant.amount_awarded, grant.currency ?? "DKK")}</span>
          </div>
          <p className="mt-1 break-words text-xs text-muted-foreground">{grant.reference || grant.project_name || "Project allocation needs checking"}</p>
          <p className="mt-3 whitespace-pre-line break-words text-sm">{grant.purpose || "Spending conditions have not been recorded. Check the award before allocating money."}</p>
          {grant.workflow_stage === "closed" && <p className="mt-2 text-sm">Completed grant</p>}
          {grant.reporting_due && grant.workflow_stage !== "closed" && <p className="mt-3 text-sm"><strong>Report by:</strong> {grant.reporting_due}</p>}
          {grant.next_action && grant.workflow_stage !== "closed" && <p className="mt-2 whitespace-pre-line text-sm"><strong>Next:</strong> {grant.next_action}</p>}
          {grant.source_url && /^https:\/\//i.test(grant.source_url) && <a href={grant.source_url} className="mt-3 inline-block text-sm underline" target="_blank" rel="noreferrer">Source record</a>}
          {grant.notes && <details className="mt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Receipt evidence and source notes</summary><p className="mt-2 whitespace-pre-line break-words">{grant.notes}</p></details>}
        </article>)}
      </div>}
    <p className="mt-4 text-xs text-muted-foreground">Awarded, received and unspent are different amounts. Remaining cash requires matching the receipts to actual expenses.</p>
  </section>;
}
