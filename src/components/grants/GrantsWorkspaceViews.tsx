import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  CircleDollarSign,
  Edit3,
  ExternalLink,
  FileCheck2,
  FileWarning,
  Filter,
  List,
  Search,
  Sparkles,
  Target,
  UserRound,
  Plus,
} from "lucide-react";
import CoverageBar, { formatCoverageMoney } from "../funding/CoverageBar";
import {
  applicationMatchesFilter,
  applicationWorkspaceView,
  coverageFromProject,
  formatApplicationSortDate,
  getApplicationReadiness,
  labelForOutcome,
  labelForStage,
  opportunityMatchesQuery,
  parseGrantRules,
  safeWorkspaceHref,
  sortCalendarEvents,
  sortApplications,
  type ApplicationFilter,
  type ApplicationSort,
  type ApplicationSortDateField,
  type FundingProjectView,
  type GrantApplicationView,
  type GrantAssetView,
  type GrantCalendarEventView,
  type GrantOpportunityView,
} from "./grants-workspace-ui";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const inputClass = "h-10 border border-border bg-background px-3 text-sm outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200";

function SafeWorkspaceLink({ href, children, ...props }: React.ComponentProps<"a">) {
  const safeHref = safeWorkspaceHref(href);
  return safeHref ? <a {...props} href={safeHref}>{children}</a> : <>{children}</>;
}

export function formatMoney(amount: number | null, currency = "DKK") {
  if (amount == null) return "Not recorded";
  return formatCoverageMoney(amount, currency);
}

function formatApplicationMoney(amount: number, recorded: boolean | undefined, currency: string, suffix: string) {
  return `${recorded === false ? "Not recorded" : formatMoney(amount, currency)} ${suffix}`;
}

export function formatGrantDate(date: string | null) {
  if (!date) return "Not scheduled";
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(parsed);
}

function StatusTag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "positive" | "attention" | "info" }) {
  const toneClass = {
    neutral: "border-border bg-muted/40 text-muted-foreground",
    positive: "border-emerald-200 bg-emerald-50 text-emerald-700",
    attention: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-sky-200 bg-sky-50 text-sky-700",
  }[tone];
  return <span className={`inline-flex items-center border px-2 py-1 text-[11px] font-medium ${toneClass}`}>{children}</span>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof List; title: string; detail: string }) {
  return (
    <div className="border border-dashed border-border px-5 py-14 text-center">
      <Icon className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function RuleChip({ label, value, tone = "neutral" }: { label: string; value: boolean | null; tone?: "neutral" | "positive" | "attention" }) {
  if (value === null) return null;
  return <StatusTag tone={value ? tone : "neutral"}>{value ? label : `No ${label.toLowerCase()}`}</StatusTag>;
}

function GrantEnrichmentDetail({ grant }: { grant: GrantOpportunityView }) {
  const rules = parseGrantRules(grant.rules);
  const rounds = grant.deadlineRounds ?? [];
  if (!rules && !rounds.length && !grant.researchUrl) return null;
  return (
    <div className="grid gap-5 border-t border-border pt-5 lg:col-span-3 lg:grid-cols-2">
      {rules && <section aria-label={`${grant.name} eligibility rules`} className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Eligibility &amp; rules</p>
        <div className="flex flex-wrap gap-2">
          <RuleChip label="ApS eligible" value={rules.apsEligible} tone="positive" />
          <RuleChip label="Forening eligible" value={rules.foreningEligible} tone="positive" />
          <RuleChip label="Individual eligible" value={rules.individualEligible} tone="positive" />
          <RuleChip label="Commercial use allowed" value={rules.commercialAllowed} tone="positive" />
          <RuleChip label="Revenue-generating use allowed" value={rules.revenueGeneratingAllowed} tone="positive" />
          <RuleChip label="Co-financing required" value={rules.coFinancingRequired} tone="attention" />
          <RuleChip label="Self-financing required" value={rules.selfFinancingRequired} tone="attention" />
          <RuleChip label="In-kind accepted" value={rules.inKindAccepted} tone="positive" />
        </div>
        <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          {([["Career stage", rules.careerStage], ["Geography", rules.geography], ["Genre restrictions", rules.genreRestrictions], ["Payment", rules.paymentSchedule], ["Timing", rules.paymentTiming]] as const).filter(([, value]) => value).map(([label, value]) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1">{value}</dd></div>)}
        </dl>
        {rules.restrictions && <p className="text-sm leading-6 text-muted-foreground"><span className="font-medium text-foreground">Restrictions:</span> {rules.restrictions}</p>}
      </section>}

      <section aria-label={`${grant.name} deadline rounds`} className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Deadline rounds</p>
        {rounds.length ? <div className="divide-y divide-border border border-border">{rounds.map((round) => <div key={round.id} className="space-y-2 p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{formatGrantDate(round.date)}{round.label ? ` · ${round.label}` : ""}</p><StatusTag tone={round.classification === "confirmed" ? "positive" : round.classification === "estimated" ? "attention" : "info"}>{round.classification.slice(0, 1).toUpperCase() + round.classification.slice(1)}</StatusTag></div><p className="text-xs text-muted-foreground">{[round.deadlineTime, round.timezone].filter(Boolean).join(" ") || "Time not stated"}{round.opensOn ? ` · opens ${formatGrantDate(round.opensOn)}` : ""}{round.expectedResponseDate ? ` · response ${formatGrantDate(round.expectedResponseDate)}` : ""}</p>{round.sourceUrl && <SafeWorkspaceLink href={round.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline underline-offset-4">Official source <ExternalLink className="size-3" /></SafeWorkspaceLink>}</div>)}</div> : rules?.recurrenceNotes ? <p className="border border-dashed border-border p-3 text-sm text-muted-foreground">{rules.recurrenceNotes}. This grant is recurring; confirm the next date from the official source.</p> : <p className="text-sm text-muted-foreground">No dated round recorded yet.</p>}
      </section>

      {rules?.playbook && <section aria-label={`${grant.name} application playbook`} className="space-y-3 lg:col-span-2">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Application playbook</p>
        <div className="grid gap-4 border border-border p-4 md:grid-cols-3">
          <div><p className="text-xs text-muted-foreground">Preparation</p><p className="mt-1 text-sm">{rules.playbook.preparationTimeline || "Not recorded"}</p>{rules.playbook.owner && <p className="mt-2 text-xs text-muted-foreground">Owner: {rules.playbook.owner}</p>}</div>
          <div><p className="text-xs text-muted-foreground">Required assets</p>{rules.playbook.requiredAssets.length ? <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">{rules.playbook.requiredAssets.map((asset) => <li key={asset}>{asset}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>}</div>
          <div><p className="text-xs text-muted-foreground">Common traps</p>{rules.playbook.commonTraps.length ? <ul className="mt-1 list-disc space-y-1 pl-4 text-sm">{rules.playbook.commonTraps.map((trap) => <li key={trap}>{trap}</li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">Not recorded</p>}{rules.playbook.tips && <p className="mt-2 text-xs text-muted-foreground">Tip: {rules.playbook.tips}</p>}</div>
        </div>
      </section>}

      {(grant.researchUrl || grant.researchSource) && <div className="flex flex-wrap gap-4 text-sm lg:col-span-2">{grant.researchUrl && <SafeWorkspaceLink href={grant.researchUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4">Guidelines <ExternalLink className="size-3.5" /></SafeWorkspaceLink>}{grant.researchSource && <SafeWorkspaceLink href={grant.researchSource} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4">Research source <ExternalLink className="size-3.5" /></SafeWorkspaceLink>}</div>}
    </div>
  );
}

export function FundingPlanView({
  projects,
  onSelectProject,
}: {
  projects: FundingProjectView[];
  onSelectProject: (project: FundingProjectView) => void;
}) {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState("all");
  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesQuery = !normalized || [project.name, project.artistName, project.releaseTitle, project.goal]
        .some((value) => (value ?? "").toLowerCase().includes(normalized));
      const matchesPriority = priority === "all" || (project.priority ?? "normal").toLowerCase() === priority;
      return matchesQuery && matchesPriority;
    });
  }, [priority, projects, query]);

  return (
    <section aria-labelledby="funding-plan-heading" className="space-y-4">
      <div className="flex flex-col gap-3 border-y border-border py-3 md:flex-row md:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search project, artist, release…"
            aria-label="Search funding projects"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground">
          <Filter className="size-4" />
          <NativeSelect value={priority} onChange={(event) => setPriority(event.target.value)} className="bg-transparent text-foreground outline-none">
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </NativeSelect>
        </label>
      </div>

      <div className="sr-only" id="funding-plan-heading">Funding plan projects</div>
      {visible.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((project) => <FundingProjectCard key={project.id} project={project} onOpen={() => onSelectProject(project)} />)}
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title="No funding projects match this view"
          detail="Set up a project budget or clear the current filters to bring funding work into view."
        />
      )}
    </section>
  );
}

function FundingProjectCard({ project, onOpen }: { project: FundingProjectView; onOpen: () => void }) {
  const coverage = coverageFromProject(project);
  const needs = project.needs.slice(0, 3);
  return (
    <article className="flex min-h-[330px] flex-col border border-border bg-card">
      <div className="flex items-start justify-between gap-4 border-b border-border p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone={project.priority === "high" ? "attention" : "neutral"}>{project.priority || "Normal"} priority</StatusTag>
            <span className="text-xs capitalize text-muted-foreground">{project.status || "Planning"}</span>
          </div>
          <h2 className="mt-3 text-lg font-semibold tracking-tight">{project.name}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {[project.artistName, project.releaseTitle].filter(Boolean).join(" · ") || "No artist or release linked"}
          </p>
        </div>
        <Button variant="outline" type="button" onClick={onOpen} className="inline-flex size-9 shrink-0 items-center justify-center border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground" aria-label={`Open ${project.name}`}>
          <ArrowRight className="size-4" />
        </Button>
      </div>

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-[1fr_auto] items-end gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Remaining gap</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatMoney(project.remainingGap, project.currency)}</p>
            <p className="mt-1 text-xs text-muted-foreground">of {formatMoney(project.totalBudget, project.currency)} planned</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{coverage.confirmedPercent}% confirmed</p>
            <p className="mt-1">{formatMoney(project.pendingFunding, project.currency)} expected from pipeline</p>
          </div>
        </div>
        <CoverageBar coverage={coverage} compact />

        <div>
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">What needs funding</p>
          {needs.length ? (
            <div className="mt-2 divide-y divide-border border-y border-border">
              {needs.map((need) => (
                <div key={need.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <span className="truncate">{need.title}</span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoney(need.remainingGap, project.currency)}</span>
                </div>
              ))}
            </div>
          ) : <p className="mt-2 text-sm text-amber-700">Funding needs have not yet been reconciled to Budget.</p>}
        </div>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Next owned action</p>
            <p className="mt-1 text-sm font-medium">{project.nextAction || "Set the next action"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{project.ownerName || "No owner"}{project.nextActionDue ? ` · ${formatGrantDate(project.nextActionDue)}` : ""}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Best grant</p>
            <p className="mt-1 text-sm font-medium">{project.topMatch?.name || "No match reviewed"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{project.topMatch?.deadline ? `Deadline ${formatGrantDate(project.topMatch.deadline)}` : `${project.assetReadiness.missing} missing material${project.assetReadiness.missing === 1 ? "" : "s"}`}{project.suggestedMatches && project.suggestedMatches.length > 1 ? ` · ${project.suggestedMatches.length} suggestions` : ""}</p>
          </div>
        </div>
      </div>
    </article>
  );
}

const APPLICATION_FILTERS: Array<{ key: ApplicationFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "my_actions", label: "My actions" },
  { key: "due_30", label: "Due in 30 days" },
  { key: "writing", label: "Writing" },
  { key: "ready_to_submit", label: "Ready to submit" },
  { key: "decision_pending", label: "Awaiting decision" },
  { key: "reporting", label: "Reporting due" },
  { key: "closed", label: "Closed" },
];

export function ApplicationsView({ applications, currentUserName = null, onCreate, onEdit }: {
  applications: GrantApplicationView[];
  currentUserName?: string | null;
  onCreate?: () => void;
  onEdit?: (application: GrantApplicationView) => void;
}) {
  const [filter, setFilter] = useState<ApplicationFilter>("all");
  const [outcome, setOutcome] = useState("all");
  const [owner, setOwner] = useState("all");
  const [sort, setSort] = useState<ApplicationSort>("submitted_desc");
  const [view, setView] = useState<"table" | "board">("table");
  const [workspaceView, setWorkspaceView] = useState<"pipeline" | "history">("pipeline");
  const scopedApplications = applications.filter((application) => applicationWorkspaceView(application) === workspaceView);
  const owners = [...new Set(scopedApplications.map((application) => application.ownerName || "Unassigned"))].sort();
  const sortedApplications = sortApplications(scopedApplications, sort);
  const visible = sortedApplications.filter((application) => applicationMatchesFilter(application, filter, undefined, currentUserName)
    && (outcome === "all" || application.outcome === outcome)
    && (owner === "all" || (application.ownerName || "Unassigned") === owner));

  return (
    <section className="space-y-4" aria-labelledby="applications-heading">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {workspaceView === "pipeline" ? "Work applications forward from idea to decision, with deadlines, owners, actions, and material readiness visible." : "History only includes applications marked as submitted with an approved, partially approved, or declined decision. If the source did not include a submission date or amount, Suite leaves it unrecorded instead of guessing."}
      </p>
      <div className="flex flex-col gap-3 border-y border-border py-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Application views and filters">
          {(["pipeline", "history"] as const).map((item) => (
            <Button key={item} type="button" onClick={() => { setWorkspaceView(item); setFilter("all"); }} className={`h-9 shrink-0 border px-3 text-sm font-semibold transition ${workspaceView === item ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
              {item === "pipeline" ? "Pipeline" : "History"}
            </Button>
          ))}
          <span className="mx-1 border-l border-border" aria-hidden="true" />
          {APPLICATION_FILTERS.map((item) => (
            <Button key={item.key} type="button" onClick={() => setFilter(item.key)} className={`h-9 shrink-0 border px-3 text-sm font-medium transition ${filter === item.key ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-foreground hover:text-foreground"}`}>
              {item.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground">Outcome<NativeSelect value={outcome} onChange={(event) => setOutcome(event.target.value)} aria-label="Filter applications by outcome" className="bg-transparent text-foreground outline-none"><option value="all">All outcomes</option><option value="approved">Approved</option><option value="rejected">Declined</option></NativeSelect></label>
          <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground">Owner<NativeSelect value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="Filter applications by owner" className="bg-transparent text-foreground outline-none"><option value="all">All owners</option>{owners.map((name) => <option key={name} value={name}>{name}</option>)}</NativeSelect></label>
          <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground">Sort by<NativeSelect value={sort} onChange={(event) => setSort(event.target.value as ApplicationSort)} aria-label="Sort applications by date" className="bg-transparent text-foreground outline-none"><option value="submitted_desc">Submitted date (newest first)</option><option value="decision_desc">Decision date (newest first)</option><option value="deadline_asc">Deadline (soonest first)</option></NativeSelect></label>
          <div className="inline-flex border border-border bg-muted/30 p-1" role="tablist" aria-label="Applications display">
            {(["table", "board"] as const).map((mode) => (
              <Button key={mode} type="button" role="tab" aria-selected={view === mode} onClick={() => setView(mode)} className={`h-8 px-3 text-sm font-medium capitalize ${view === mode ? "bg-background shadow-sm" : "text-muted-foreground"}`}>{mode}</Button>
            ))}
          </div>
          {onCreate && <Button variant="outline" type="button" onClick={onCreate} className="inline-flex h-10 items-center border border-foreground px-3 text-xs font-medium text-foreground hover:bg-muted">Record sent application</Button>}
        </div>
      </div>
      <h2 id="applications-heading" className="sr-only">Grant applications</h2>
      {visible.length ? view === "table" ? <ApplicationTable applications={visible} sort={sort} onEdit={onEdit} /> : <ApplicationBoard applications={visible} onEdit={onEdit} /> : (
        <EmptyState icon={FileCheck2} title="No applications match this filter" detail="Application work will appear here with its workflow stage, decision outcome, next action, and material readiness." />
      )}
    </section>
  );
}

function ApplicationTable({ applications, sort = "submitted_desc", onEdit }: { applications: GrantApplicationView[]; sort?: ApplicationSort; onEdit?: (application: GrantApplicationView) => void }) {
  const dateField: ApplicationSortDateField = sort === "submitted_desc" ? "submitted" : sort === "decision_desc" ? "decision" : "deadline";
  const dateLabel = dateField === "submitted" ? "Submitted date" : dateField === "decision" ? "Decision date" : "Deadline";
  return (
    <div className="overflow-x-auto border border-border">
      <table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="border-b border-border bg-muted/35 text-xs text-muted-foreground">
          <tr><th className="px-4 py-3 font-medium">Grant / project</th><th className="px-4 py-3 font-medium">Workflow</th><th className="px-4 py-3 font-medium">Outcome</th><th className="px-4 py-3 font-medium">Owner</th><th className="px-4 py-3 text-right font-medium">Applied / received</th><th className="px-4 py-3 font-medium">{dateLabel}</th><th className="px-4 py-3 font-medium">Next action</th><th className="px-4 py-3 font-medium">Materials</th>{onEdit && <th className="w-12 px-2 py-3"><span className="sr-only">Actions</span></th>}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {applications.map((application) => {
            const readiness = getApplicationReadiness(application);
            const selectedDate = formatApplicationSortDate(application, dateField);
            return (
              <tr key={application.id} className="align-top transition hover:bg-muted/20">
                <td className="px-4 py-4"><p className="font-medium">{application.opportunityName || application.name}</p><p className="mt-1 text-xs text-muted-foreground">{application.projectName || "No project linked"}</p></td>
                <td className="px-4 py-4"><StatusTag tone="info">{labelForStage(application.workflowStage)}</StatusTag></td>
                <td className="px-4 py-4"><StatusTag tone={application.outcome === "approved" ? "positive" : application.outcome === "rejected" ? "attention" : "neutral"}>{labelForOutcome(application.outcome)}</StatusTag></td>
                <td className="px-4 py-4"><span className="inline-flex items-center gap-2"><UserRound className="size-3.5 text-muted-foreground" />{application.ownerName || "Unassigned"}</span></td>
                <td className="px-4 py-4 text-right tabular-nums"><p>{formatApplicationMoney(application.amountRequested, application.amountRequestedRecorded, application.currency, "applied")}</p><p className="mt-1 text-xs text-muted-foreground">{formatApplicationMoney(application.amountAwarded, application.amountAwardedRecorded, application.currency, "received")}</p></td>
                <td className="px-4 py-4"><span className={selectedDate === "Date not recorded" ? "text-muted-foreground" : ""}>{selectedDate}</span></td>
                <td className="max-w-[250px] px-4 py-4"><p className="font-medium">{application.nextAction || "No next action"}</p><p className="mt-1 text-xs text-muted-foreground">{formatGrantDate(application.nextActionDue ?? application.applicationDeadline)}</p></td>
                <td className="px-4 py-4"><StatusTag tone={readiness.tone === "ready" ? "positive" : readiness.tone === "attention" ? "attention" : "neutral"}>{readiness.label}</StatusTag></td>
                {onEdit && <td className="px-2 py-3"><Button type="button" onClick={() => onEdit(application)} className="inline-flex size-9 items-center justify-center border border-transparent text-muted-foreground hover:border-border hover:bg-background hover:text-foreground" aria-label={`Edit ${application.opportunityName || application.name}`}><Edit3 className="size-4" /></Button></td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ApplicationBoard({ applications, onEdit }: { applications: GrantApplicationView[]; onEdit?: (application: GrantApplicationView) => void }) {
  const stages = ["idea", "research", "writing", "ready_to_submit", "submitted", "decision_pending", "reporting", "closed"] as const;
  return (
    <div className="grid gap-px overflow-x-auto border border-border bg-border lg:grid-cols-4">
      {stages.map((stage) => {
        const rows = applications.filter((application) => application.workflowStage === stage);
        return (
          <div key={stage} className="min-w-[240px] bg-background p-3">
            <div className="flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">{labelForStage(stage)}</h3><span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span></div>
            <div className="mt-3 space-y-2">
              {rows.map((application) => <div key={application.id} className="border border-border bg-card p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">{application.opportunityName || application.name}</p><p className="mt-1 text-xs text-muted-foreground">{application.projectName || "No project"}</p></div>{onEdit && <Button type="button" onClick={() => onEdit(application)} className="inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground" aria-label={`Edit ${application.opportunityName || application.name}`}><Edit3 className="size-4" /></Button>}</div>{application.nextAction && <p className="mt-3 border-t border-border pt-2 text-xs">{application.nextAction}</p>}</div>)}
              {!rows.length && <p className="py-6 text-center text-xs text-muted-foreground">No applications</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function GrantsCatalogView({ initialGrantId = null, grants, applications, projects, onStartApplication, onEditApplication, onCreate, onEdit }: { initialGrantId?: string | null; grants: GrantOpportunityView[]; applications: GrantApplicationView[]; projects: FundingProjectView[]; onStartApplication?: (grant: GrantOpportunityView) => void; onEditApplication?: (application: GrantApplicationView) => void; onCreate?: () => void; onEdit?: (grant: GrantOpportunityView) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(() => initialGrantId ?? (grants.length === 1 ? grants[0]?.id ?? null : null));
  const visible = grants.filter((grant) => opportunityMatchesQuery(grant, query, projects) && (status === "all" || (grant.status ?? "unknown").toLowerCase() === status));

  return (
    <section className="space-y-4" aria-labelledby="grants-catalog-heading">
      <div className="flex flex-col gap-3 border-y border-border py-3 md:flex-row">
        <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search funder, programme, purpose, project…" className={`${inputClass} w-full pl-9`} aria-label="Search grants" /></div>
        <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground"><Filter className="size-4" /><NativeSelect value={status} onChange={(event) => setStatus(event.target.value)} className="bg-transparent text-foreground outline-none"><option value="all">All statuses</option><option value="open">Open</option><option value="research">Research</option><option value="planned">Planned</option><option value="closed">Closed</option></NativeSelect></label>
        {onCreate && <Button type="button" onClick={onCreate} className="inline-flex h-10 items-center justify-center gap-2 bg-foreground px-3 text-sm font-medium text-background"><Plus className="size-4" />New grant</Button>}
      </div>
      <h2 id="grants-catalog-heading" className="sr-only">Grant catalog</h2>
      {initialGrantId && !grants.some((grant) => grant.id === initialGrantId) && <p role="status">The linked grant is no longer available in this workspace.</p>}
      {visible.length ? (
        <div className="divide-y divide-border border-y border-border">
          {visible.map((grant) => {
            const expanded = expandedId === grant.id;
            const matchingProjects = projects.filter((project) => grant.matchingProjectIds.includes(project.id));
            const linkedApplications = applications.filter((application) => application.opportunityId === grant.id);
            const historyApplications = linkedApplications.filter((application) => applicationWorkspaceView(application) === "history");
            const pipelineApplications = linkedApplications.filter((application) => applicationWorkspaceView(application) === "pipeline");
            return (
              <article key={grant.id} id={`grant-${grant.id}`} className="py-4">
                <Button type="button" onClick={() => setExpandedId(expanded ? null : grant.id)} className="grid w-full gap-4 text-left sm:grid-cols-[minmax(0,1fr)_160px_150px_32px] sm:items-center" aria-expanded={expanded}>
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{grant.name}</h3><StatusTag tone={grant.status === "open" ? "positive" : "neutral"}>{grant.status || "Unknown"}</StatusTag><span className="text-xs text-muted-foreground">{linkedApplications.length} {linkedApplications.length === 1 ? "application" : "applications"}</span></div><p className="mt-1 text-sm text-muted-foreground">{[grant.funder, grant.program].filter(Boolean).join(" · ") || "Funder not recorded"}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{grant.purposes.slice(0, 3).map((purpose) => <span key={purpose}>{purpose}</span>)}</div></div>
                  <div><p className="text-xs text-muted-foreground">Next deadline</p><p className="mt-1 text-sm font-medium">{formatGrantDate(grant.deadline)}</p></div>
                  <div className="sm:text-right"><p className="text-xs text-muted-foreground">Maximum</p><p className="mt-1 text-sm font-medium tabular-nums">{grant.maxAmount == null ? "Not stated" : formatMoney(grant.maxAmount, grant.currency)}</p></div>
                  <ChevronDown className={`size-4 text-muted-foreground transition ${expanded ? "rotate-180" : ""}`} />
                </Button>
                {expanded && (
                  <div className="mt-4 grid gap-5 border-t border-border bg-muted/20 px-4 py-5 lg:grid-cols-[1fr_1fr_220px]">
                    <div><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Eligibility & requirements</p>{grant.researchSummary && <p className="mt-2 text-sm leading-6">{grant.researchSummary}</p>}<p className="mt-2 text-sm leading-6">{grant.requirements || "Requirements have not been summarized yet."}</p><p className="mt-2 text-xs text-muted-foreground">Applicant: {grant.applicantType || "Not confirmed"}</p></div>
                    <div><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Why it matches</p>{grant.matchReasons.length ? <ul className="mt-2 space-y-2">{grant.matchReasons.map((reason) => <li key={reason} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{reason}</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No match has been reviewed. Verify eligibility before pursuing.</p>}</div>
                    <div><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Matching projects</p><p className="mt-2 text-sm">{matchingProjects.map((project) => project.name).join(", ") || "None reviewed"}</p><p className="mt-3 text-xs text-muted-foreground">Research {grant.lastVerifiedAt ? `verified ${formatGrantDate(grant.lastVerifiedAt)}` : "needs verification"}</p><div className="mt-4 flex flex-wrap gap-2">{onStartApplication && <Button type="button" onClick={() => onStartApplication(grant)} className="inline-flex h-9 items-center gap-2 bg-foreground px-3 text-sm font-medium text-background"><Plus className="size-4" />Record sent application</Button>}{onEdit && <Button type="button" onClick={() => onEdit(grant)} className="inline-flex h-9 items-center gap-2 border border-border px-3 text-sm font-medium hover:bg-muted"><Edit3 className="size-4" />Edit grant</Button>}</div>{grant.officialUrl && <SafeWorkspaceLink href={grant.officialUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1.5 text-sm font-medium underline underline-offset-4">Official source <ExternalLink className="size-3.5" /></SafeWorkspaceLink>}</div>
                    <GrantEnrichmentDetail grant={grant} />
                    <section className="space-y-3 lg:col-span-3" aria-label={`${grant.name} application history`}>
                      {pipelineApplications.length > 0 && <div className="space-y-3 border-t border-border pt-4"><div className="flex items-center justify-between gap-4"><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Open application pipeline</p><p className="text-xs text-muted-foreground">{pipelineApplications.length} {pipelineApplications.length === 1 ? "application" : "applications"}</p></div><div className="divide-y divide-border border border-border">{pipelineApplications.map((application) => <div key={application.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_150px_190px_auto] sm:items-center"><div><p className="text-sm font-medium">{application.projectName || "No project linked"}</p><p className="mt-1 text-xs text-muted-foreground">{application.name}</p></div><div><p className="text-xs text-muted-foreground">Application deadline</p><p className="mt-1 text-sm font-medium">{formatGrantDate(application.applicationDeadline)}</p></div><div className="flex flex-wrap gap-2"><StatusTag tone="info">{labelForStage(application.workflowStage)}</StatusTag><StatusTag>{application.nextAction || "No next action"}</StatusTag></div>{onEditApplication && <Button type="button" onClick={() => onEditApplication(application)} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Edit application for ${application.projectName || grant.name}`}><Edit3 className="size-4" /></Button>}</div>)}</div></div>}
                      <div className="flex items-center justify-between gap-4 border-t border-border pt-4"><p className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">Application history</p><p className="text-xs text-muted-foreground">{historyApplications.length} {historyApplications.length === 1 ? "application" : "applications"}</p></div>
                      {historyApplications.length ? <div className="divide-y divide-border border border-border">{historyApplications.map((application) => <div key={application.id} className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_150px_170px_190px_auto] lg:items-center"><div><p className="text-sm font-medium">{application.projectName || "No project linked"}</p><p className="mt-1 text-xs text-muted-foreground">{application.name}</p></div><div><p className="text-xs text-muted-foreground">Application deadline</p><p className="mt-1 text-sm font-medium">{formatGrantDate(application.applicationDeadline)}</p></div><div className="flex flex-wrap gap-2"><StatusTag tone="info">{labelForStage(application.workflowStage)}</StatusTag><StatusTag tone={application.outcome === "approved" ? "positive" : application.outcome === "rejected" ? "attention" : "neutral"}>{labelForOutcome(application.outcome)}</StatusTag></div><div className="text-sm tabular-nums lg:text-right"><p>{formatApplicationMoney(application.amountRequested, application.amountRequestedRecorded, application.currency, "applied")}</p><p className="mt-1 text-xs text-muted-foreground">{formatApplicationMoney(application.amountAwarded, application.amountAwardedRecorded, application.currency, "received")}</p></div>{onEditApplication && <Button type="button" onClick={() => onEditApplication(application)} className="inline-flex size-9 items-center justify-center border border-border text-muted-foreground hover:bg-background hover:text-foreground" aria-label={`Edit application for ${application.projectName || grant.name}`}><Edit3 className="size-4" /></Button>}</div>)}</div> : <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No decided applications recorded. This grant stays in the catalog and can be reused for a future project or round.</p>}
                    </section>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : <EmptyState icon={Sparkles} title="No grants match your search" detail="Clear the filters or add researched grants to the catalog." />}
    </section>
  );
}

export function AssetsView({ assets }: { assets: GrantAssetView[] }) {
  const [query, setQuery] = useState("");
  const [readiness, setReadiness] = useState("all");
  const [role, setRole] = useState("all");
  const [owner, setOwner] = useState("all");
  const [project, setProject] = useState("all");
  const [freshness, setFreshness] = useState("all");
  const roles = [...new Set(assets.map((asset) => asset.role))].sort();
  const owners = [...new Set(assets.map((asset) => asset.ownerName || "Unassigned"))].sort();
  const projects = [...new Set(assets.map((asset) => asset.projectName || "Reusable"))].sort();
  const visible = assets.filter((asset) => {
    const matchesQuery = !query.trim() || [asset.name, asset.role, asset.projectName, asset.ownerName].some((value) => (value ?? "").toLowerCase().includes(query.trim().toLowerCase()));
    return matchesQuery
      && (readiness === "all" || asset.readiness === readiness)
      && (role === "all" || asset.role === role)
      && (owner === "all" || (asset.ownerName || "Unassigned") === owner)
      && (project === "all" || (asset.projectName || "Reusable") === project)
      && (freshness === "all" || (freshness === "stale" ? asset.readiness === "stale" : asset.readiness !== "stale"));
  });
  return (
    <section className="space-y-4" aria-labelledby="assets-heading">
      <div className="grid gap-px border border-border bg-border sm:grid-cols-4">
        {[{ label: "Ready", value: assets.filter((asset) => asset.readiness === "ready").length }, { label: "Draft", value: assets.filter((asset) => asset.readiness === "draft").length }, { label: "Missing", value: assets.filter((asset) => asset.readiness === "missing").length }, { label: "Stale", value: assets.filter((asset) => asset.readiness === "stale").length }].map((stat) => <div key={stat.label} className="bg-background p-4"><p className="text-xs text-muted-foreground">{stat.label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</p></div>)}
      </div>
      <div className="space-y-3 border-y border-border py-3"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search materials, role, owner, project…" className={`${inputClass} w-full pl-9`} aria-label="Search grant materials" /></div><div className="flex flex-wrap gap-2"><AssetFilter label="Type / role" value={role} onChange={setRole} options={roles} /><AssetFilter label="Owner" value={owner} onChange={setOwner} options={owners} /><AssetFilter label="Project" value={project} onChange={setProject} options={projects} /><AssetFilter label="Readiness" value={readiness} onChange={setReadiness} options={["ready", "draft", "missing", "stale"]} /><AssetFilter label="Freshness" value={freshness} onChange={setFreshness} options={["current", "stale"]} /></div></div>
      <h2 id="assets-heading" className="sr-only">Reusable grant materials</h2>
      {visible.length ? <div className="overflow-x-auto border border-border"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-border bg-muted/35 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Material</th><th className="px-4 py-3 font-medium">Role</th><th className="px-4 py-3 font-medium">Readiness</th><th className="px-4 py-3 font-medium">Owner / project</th><th className="px-4 py-3 font-medium">Used by</th><th className="px-4 py-3 font-medium">Updated</th></tr></thead><tbody className="divide-y divide-border">{visible.map((asset) => <tr key={asset.id} className="hover:bg-muted/20"><td className="px-4 py-4 font-medium">{asset.href ? <SafeWorkspaceLink href={asset.href} className="underline underline-offset-4">{asset.name}</SafeWorkspaceLink> : asset.name}</td><td className="px-4 py-4 capitalize">{asset.role.replaceAll("_", " ")}</td><td className="px-4 py-4"><StatusTag tone={asset.readiness === "ready" ? "positive" : asset.readiness === "draft" ? "info" : "attention"}>{asset.readiness}</StatusTag></td><td className="px-4 py-4"><p>{asset.ownerName || "Unassigned"}</p><p className="mt-1 text-xs text-muted-foreground">{asset.projectName || "Reusable across projects"}</p></td><td className="px-4 py-4 text-muted-foreground">{asset.applicationNames.length ? asset.applicationNames.join(", ") : "Not linked"}</td><td className="px-4 py-4 text-muted-foreground">{formatGrantDate(asset.lastUpdatedAt)}</td></tr>)}</tbody></table></div> : <EmptyState icon={FileWarning} title="No grant materials match this view" detail="The Airtable material library will appear here as linked Label Suite Documents after import." />}
    </section>
  );
}

function AssetFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <label className="inline-flex h-10 items-center gap-2 border border-border bg-background px-3 text-sm text-muted-foreground">{label}<NativeSelect value={value} onChange={(event) => onChange(event.target.value)} aria-label={`Filter assets by ${label.toLowerCase()}`} className="max-w-[150px] bg-transparent text-foreground outline-none"><option value="all">All</option>{options.map((option) => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</NativeSelect></label>;
}

export function CalendarReportingView({ events }: { events: GrantCalendarEventView[] }) {
  const sorted = sortCalendarEvents(events);
  const grouped = sorted.reduce<Record<string, GrantCalendarEventView[]>>((groups, event) => {
    const key = event.date?.slice(0, 7) ?? "unscheduled";
    (groups[key] ||= []).push(event);
    return groups;
  }, {});
  return (
    <section className="space-y-4" aria-labelledby="calendar-heading">
      <div className="grid gap-px border border-border bg-border sm:grid-cols-3"><div className="bg-background p-4"><p className="text-xs text-muted-foreground">Submission deadlines</p><p className="mt-1 text-xl font-semibold tabular-nums">{events.filter((event) => event.kind === "deadline").length}</p></div><div className="bg-background p-4"><p className="text-xs text-muted-foreground">Expected decisions</p><p className="mt-1 text-xl font-semibold tabular-nums">{events.filter((event) => event.kind === "decision").length}</p></div><div className="bg-background p-4"><p className="text-xs text-muted-foreground">Reports due</p><p className="mt-1 text-xl font-semibold tabular-nums">{events.filter((event) => event.kind === "reporting").length}</p></div></div>
      <h2 id="calendar-heading" className="sr-only">Grant calendar and reporting</h2>
      {events.length ? <div className="border-y border-border">{Object.entries(grouped).map(([month, monthEvents]) => <div key={month} className="grid border-b border-border last:border-b-0 md:grid-cols-[180px_1fr]"><div className="border-b border-border bg-muted/25 px-4 py-4 md:border-b-0 md:border-r"><p className="text-sm font-semibold">{month === "unscheduled" ? "Unscheduled" : new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00`))}</p><p className="mt-1 text-xs text-muted-foreground">{monthEvents.length} date{monthEvents.length === 1 ? "" : "s"}</p></div><div className="divide-y divide-border">{monthEvents.map((event) => <div key={`${event.kind}-${event.id}`} className="grid gap-3 px-4 py-4 sm:grid-cols-[110px_minmax(0,1fr)_150px] sm:items-center"><div className="text-sm font-medium tabular-nums">{event.date ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${event.date.slice(0, 10)}T00:00:00`)) : "No date"}</div><div><p className="font-medium">{event.href ? <SafeWorkspaceLink href={event.href} className="underline underline-offset-4">{event.title}</SafeWorkspaceLink> : event.title}</p><p className="mt-1 text-xs text-muted-foreground">{event.context || event.kind.replaceAll("_", " ")}</p></div><div className="sm:text-right"><StatusTag tone={event.kind === "reporting" ? "attention" : event.kind === "decision" ? "info" : "neutral"}>{event.kind}</StatusTag></div></div>)}</div></div>)}</div> : <EmptyState icon={CalendarDays} title="No grant dates are scheduled yet" detail="Grant rounds, next actions, submissions, decisions, and reporting obligations will share this timeline." />}
    </section>
  );
}

export function ProjectDetailPanel({ project, applications, assets, onClose, onCreateNeed, onEditNeed }: { project: FundingProjectView; applications: GrantApplicationView[]; assets: GrantAssetView[]; onClose: () => void; onCreateNeed?: () => void; onEditNeed?: (need: FundingProjectView["needs"][number]) => void }) {
  const [section, setSection] = useState<"needs" | "applications" | "matches" | "assets" | "evaluation">("needs");
  const relatedApplications = applications.filter((application) => application.projectId === project.id);
  const relatedAssets = assets.filter((asset) => asset.projectName === project.name || asset.applicationNames.some((name) => relatedApplications.some((application) => application.name === name)));
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/35" role="dialog" aria-modal="true" aria-label={`${project.name} funding workspace`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-background shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5 sm:px-7"><div><p className="text-xs text-muted-foreground">Funding project</p><h2 className="mt-1 text-xl font-semibold tracking-tight">{project.name}</h2><p className="mt-1 text-sm text-muted-foreground">{project.goal || "Grant-facing project narrative not added yet."}</p></div><Button variant="outline" type="button" onClick={onClose} className="border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Close</Button></div>
        <div className="flex gap-1 overflow-x-auto border-b border-border px-5 py-2 sm:px-7" role="tablist">{(["needs", "applications", "matches", "assets", "evaluation"] as const).map((item) => <Button key={item} type="button" role="tab" aria-selected={section === item} onClick={() => setSection(item)} className={`h-9 shrink-0 px-3 text-sm font-medium capitalize ${section === item ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{item}</Button>)}</div>
        <div className="flex-1 overflow-y-auto p-5 sm:p-7">
          {section === "needs" && <div className="space-y-3"><div className="flex items-center justify-between gap-4"><div><h3 className="text-sm font-semibold">Uses of funds</h3><p className="mt-1 text-xs text-muted-foreground">Define exactly what grant money will pay for.</p></div>{onCreateNeed && <Button type="button" onClick={onCreateNeed} className="inline-flex h-9 items-center gap-2 bg-foreground px-3 text-sm font-medium text-background"><Plus className="size-4" />Add need</Button>}</div>{project.needs.length ? project.needs.map((need) => <div key={need.id} className="border border-border p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{need.title}</p><p className="mt-1 text-sm text-muted-foreground">{need.description || need.category}</p></div><div className="flex items-center gap-3"><p className="font-semibold tabular-nums">{formatMoney(need.remainingGap, project.currency)}</p>{onEditNeed && <Button type="button" onClick={() => onEditNeed(need)} className="inline-flex size-8 items-center justify-center border border-border text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${need.title}`}><Edit3 className="size-4" /></Button>}</div></div><div className="mt-4 flex flex-wrap gap-2"><StatusTag tone={need.reconciled ? "positive" : "attention"}>{need.reconciled ? "Reconciled to Budget" : "Unreconciled"}</StatusTag><StatusTag>{need.eligibility.replaceAll("_", " ")}</StatusTag>{need.neededBy && <StatusTag>{formatGrantDate(need.neededBy)}</StatusTag>}</div></div>) : <EmptyState icon={CircleDollarSign} title="No funding needs defined" detail="Translate Budget lines into specific, grant-facing uses of funds." />}</div>}
          {section === "applications" && (relatedApplications.length ? <ApplicationTable applications={relatedApplications} /> : <EmptyState icon={FileCheck2} title="No applications linked" detail="Applications for this project will appear here without changing the project budget." />)}
          {section === "matches" && ((project.suggestedMatches?.length ?? 0) > 0 ? <div className="space-y-3"><div><h3 className="text-sm font-semibold">Suggested grants</h3><p className="mt-1 text-xs text-muted-foreground">Ranked by next deadline and fit with this project’s funding needs.</p></div>{project.suggestedMatches!.map((match) => <article key={match.opportunityId} className="border border-border p-4"><div className="flex items-start justify-between gap-4"><div><p className="font-semibold">{match.name}</p><p className="mt-1 text-sm text-muted-foreground">{match.funder || "Funder not recorded"}</p></div><div className="text-right text-xs text-muted-foreground">{match.deadline ? <><p>Deadline</p><p className="mt-1 font-medium text-foreground">{formatGrantDate(match.deadline)}</p></> : <p>Rolling / not dated</p>}</div></div><ul className="mt-4 space-y-1">{match.reasons.map((reason) => <li key={reason} className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />{reason}</li>)}</ul>{match.cautions.length > 0 && <div className="mt-4 border-l-2 border-amber-400 pl-3"><p className="text-xs font-medium text-amber-800">Verify before applying</p>{match.cautions.map((caution) => <p key={caution} className="mt-1 text-sm text-muted-foreground">{caution}</p>)}</div>}</article>)}</div> : <EmptyState icon={Sparkles} title="No grant match reviewed" detail="Matching reasons will explain purpose, eligibility, amount, market, and timing fit." />)}
          {section === "assets" && <AssetsView assets={relatedAssets} />}
          {section === "evaluation" && <EmptyState icon={Target} title="Evaluation is ready for the project outcome" detail="Record success measures, decision lessons, delivery evidence, and recommended next steps here." />}
        </div>
      </div>
    </div>
  );
}
