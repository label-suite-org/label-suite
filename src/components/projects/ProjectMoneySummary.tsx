import type { ProjectRecord } from "./ProjectsEventsWorkspace";

function money(value: unknown, currency: unknown) {
  return new Intl.NumberFormat("en", { style: "currency", currency: typeof currency === "string" ? currency : "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

type GrantApplicationSummary = {
  id: string;
  grant_name: string | null;
  status: string | null;
  outcome: string | null;
  amount_requested: number | string | null;
  amount_awarded: number | string | null;
};

function moneyRange(value: unknown, currency: unknown) {
  if (value == null || value === "") return "—";
  const normalized = typeof value === "string" ? Number(value) : Number(value || 0);
  return money(normalized, currency);
}

export function ProjectMoneySummary({ project, grantApplications }: { project: ProjectRecord; grantApplications?: GrantApplicationSummary[] }) {
  const planned = Number(project.total_planned || 0);
  const funding = Number(project.baseline_funding || 0);
  const query = encodeURIComponent(project.id);
  return <section aria-labelledby="project-money-heading">
    <h2 id="project-money-heading" className="font-semibold">Money</h2>
    <div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="Planned" value={money(planned, project.currency)} /><Metric label="Confirmed funding" value={money(funding, project.currency)} /><Metric label="Funding gap" value={money(Math.max(0, planned - funding), project.currency)} /></div>
    <div className="mt-4 flex gap-3"><a href={`/budget?project=${query}`} className="border border-border px-3 py-2 text-sm font-medium no-underline hover:bg-muted">Open Budget</a><a href={`/grants?project=${query}`} className="border border-border px-3 py-2 text-sm font-medium no-underline hover:bg-muted">Open Grants</a></div>
    {!!(grantApplications?.length) && <div className="mt-4">
      <h3 className="text-sm font-medium">Linked grant applications</h3>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">
        {grantApplications.map((grant) => (
          <p key={grant.id} className="border border-border bg-background px-3 py-2">
            <span className="font-medium text-foreground">{grant.grant_name || "Grant application"}</span> · {grant.outcome || grant.status || "Unknown"} · requested {moneyRange(grant.amount_requested, project.currency)} · awarded {moneyRange(grant.amount_awarded, project.currency)}
          </p>
        ))}
      </div>
    </div>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border border-border bg-card p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold">{value}</p></div>; }
