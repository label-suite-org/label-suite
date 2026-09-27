import { ProjectFiles, type ProjectDocumentRecord, type ProjectMediaRecord } from "./ProjectFiles";
import { ProjectMoneySummary } from "./ProjectMoneySummary";
import { ProjectOverview } from "./ProjectOverview";
import { ProjectPeople, type ProjectPersonRecord } from "./ProjectPeople";
import { ProjectSchedule } from "./ProjectSchedule";
import { ProjectTasks, type ProjectTaskRecord } from "./ProjectTasks";
import type { ProjectEventRecord, ProjectRecord } from "./ProjectsEventsWorkspace";

const sharedTabs = [
  ["overview", "Overview"], ["schedule", "Schedule"], ["tasks", "Tasks"],
  ["money", "Money"], ["people", "People"], ["files", "Files"],
] as const;
type ProjectTab = typeof sharedTabs[number][0] | "master-tour";

export type ProjectWorkspaceRecord = ProjectRecord & {
  events?: ProjectEventRecord[];
  tasks?: ProjectTaskRecord[];
  people?: ProjectPersonRecord[];
  documents?: ProjectDocumentRecord[];
  mediaAssets?: ProjectMediaRecord[];
  grantApplications?: GrantApplicationSummary[];
};

type GrantApplicationSummary = {
  id: string;
  grant_name: string | null;
  status: string | null;
  outcome: string | null;
  amount_requested: number | string | null;
  amount_awarded: number | string | null;
};

export type ProjectWorkspaceOptions = {
  artists: { id: string; name: string }[];
  releases: { id: string; title: string }[];
  campaigns: { id: string; name: string }[];
  contacts: { id: string; name: string }[];
  projects: { id: string; name: string }[];
};

function currencyValue(value: unknown) {
  return typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : 0;
}

function formatMoney(value: unknown, currency: string | undefined) {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function grantLabel(application: GrantApplicationSummary, currency: string | undefined) {
  const status = application.outcome || application.status || "unknown";
  const amount = currencyValue(application.amount_awarded);
  if (!amount) return `${status.replaceAll("_", " ")}`;
  return `${status.replaceAll("_", " ")} · ${formatMoney(amount, currency)}`;
}

export function resolveProjectTab(projectType: string, requested: string | null | undefined): ProjectTab {
  const tabs = new Set<ProjectTab>(sharedTabs.map(([id]) => id));
  if (projectType === "tour") tabs.add("master-tour");
  if (requested && tabs.has(requested as ProjectTab)) return requested as ProjectTab;
  return "overview";
}

export default function ProjectWorkspace({ workspace, initialTab, options }: { workspace: ProjectWorkspaceRecord; initialTab?: string | null; options?: ProjectWorkspaceOptions }) {
  const tab = resolveProjectTab(workspace.project_type, initialTab);
  const tabs = sharedTabs;
  return <div className="space-y-6">
    <header><a href="/projects" className="text-sm text-muted-foreground no-underline hover:text-foreground">Projects</a><div className="mt-2 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1><span className="border border-border px-2 py-1 text-xs capitalize text-muted-foreground">{workspace.project_type.replaceAll("_", " ")}</span><span className="text-xs capitalize text-muted-foreground">{workspace.status || "planning"}</span></div></header>
    {options && (
      <section className="border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Supported pickers</h2>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="rounded border border-border px-2 py-1">Artists ({options.artists.length})</span>
          <span className="rounded border border-border px-2 py-1">Releases ({options.releases.length})</span>
          <span className="rounded border border-border px-2 py-1">Contacts ({options.contacts.length})</span>
          <span className="rounded border border-border px-2 py-1">Campaigns ({options.campaigns.length})</span>
          <span className="rounded border border-border px-2 py-1">Projects ({options.projects.length})</span>
        </div>
      </section>
    )}
    {tab !== "money" && workspace.grantApplications?.length ? (
      <section className="border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Grant context</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {workspace.grantApplications.map((application) => (
            <li key={application.id}>
              <span className="font-medium text-foreground">{application.grant_name || "Grant application"}</span> · {grantLabel(application, typeof workspace.currency === "string" ? workspace.currency : undefined)}
            </li>
          ))}
        </ul>
      </section>
    ) : null}
    <nav role="tablist" aria-label="Project workspace" className="flex overflow-x-auto border-b border-border">{tabs.map(([id, title]) => <a key={id} role="tab" aria-selected={tab === id} href={`/projects/${workspace.id}?tab=${id}`} className={`relative inline-flex h-11 shrink-0 items-center px-4 text-sm font-medium no-underline ${tab === id ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{title}{tab === id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />}</a>)}</nav>
    {tab === "overview" && <ProjectOverview project={workspace} />}
    {tab === "schedule" && <ProjectSchedule events={workspace.events} />}
    {tab === "tasks" && <ProjectTasks tasks={workspace.tasks} />}
    {tab === "money" && <ProjectMoneySummary project={workspace} grantApplications={workspace.grantApplications} />}
    {tab === "people" && <ProjectPeople people={workspace.people} />}
    {tab === "files" && <ProjectFiles documents={workspace.documents} mediaAssets={workspace.mediaAssets} />}
  </div>;
}
