import { useMemo, useState } from "react";
import {
  CalendarRange,
  FileCheck2,
  Files,
  HandCoins,
  Library,
  ListChecks,
  Target,
} from "lucide-react";
import {
  ApplicationsView,
  AssetsView,
  CalendarReportingView,
  formatMoney,
  FundingPlanView,
  GrantsCatalogView,
  ProjectDetailPanel,
} from "./GrantsWorkspaceViews";
import { GrantApplicationDrawer, type ApplicationDrawerSeed } from "./GrantApplicationDrawer";
import { FundingNeedModal, GrantOpportunityModal } from "./GrantOperatingModals";
import { GrantWorkspaceTools } from "./GrantWorkspaceTools";
import GrantsWorklistView from "./GrantsWorklistView";
import type { GrantsWorklistItem } from "../../server/grants-worklist-core";
import {
  buildWorkspaceSummary,
  type FundingProjectView,
  type GrantsWorkspacePayload,
} from "./grants-workspace-ui";

import { Button } from "@/components/ui/button";
type WorkspaceView = "worklist" | "funding" | "applications" | "opportunities" | "assets" | "calendar";

const VIEWS: Array<{ id: WorkspaceView; label: string; icon: typeof Target }> = [
  { id: "worklist", label: "What needs doing", icon: ListChecks },
  { id: "funding", label: "Funding plan", icon: Target },
  { id: "applications", label: "Applications", icon: FileCheck2 },
  { id: "opportunities", label: "Grants", icon: Library },
  { id: "assets", label: "Assets", icon: Files },
  { id: "calendar", label: "Calendar & reporting", icon: CalendarRange },
];

export default function GrantsFundingCockpit({ workspace, currentUserName = null, canMutate = true, initialWorklist = [], initialNewApplicationProjectId = null, initialGrantId = null }: { workspace: GrantsWorkspacePayload; initialGrantId?: string | null; currentUserName?: string | null; canMutate?: boolean; initialWorklist?: GrantsWorklistItem[]; initialNewApplicationProjectId?: string | null }) {
  const [liveWorkspace, setLiveWorkspace] = useState(workspace);
  const [activeView, setActiveView] = useState<WorkspaceView>(initialGrantId ? "opportunities" : "worklist");
  const [selectedProject, setSelectedProject] = useState<FundingProjectView | null>(null);
  const [applicationDrawer, setApplicationDrawer] = useState<ApplicationDrawerSeed | null>(() => initialNewApplicationProjectId ? { projectId: initialNewApplicationProjectId } : null);
  const [opportunityEditor, setOpportunityEditor] = useState<GrantsWorkspacePayload["opportunities"][number] | "new" | null>(null);
  const [needEditor, setNeedEditor] = useState<{ project: FundingProjectView; need?: FundingProjectView["needs"][number] } | null>(null);
  const summary = useMemo(() => buildWorkspaceSummary(liveWorkspace), [liveWorkspace]);
  const primaryFunding = summary.fundingByCurrency[0] ?? { currency: "DKK", confirmed: 0, pending: 0, gap: 0 };
  const hasMultipleCurrencies = summary.fundingByCurrency.length > 1;

  async function completeWorklistAction(item: GrantsWorklistItem) {
    const response = await fetch("/api/grant-applications", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item.kind === "reporting"
        ? { id: item.applicationId, reporting_due: null }
        : { id: item.applicationId, next_action: null, next_action_due: null }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(result?.error ?? "The action could not be completed.");
    }
    await refreshWorkspace();
  }

  async function refreshWorkspace() {
    const response = await fetch("/api/grants-workspace");
    if (response.ok) setLiveWorkspace(await response.json());
  }

  return (
    <div className="space-y-6">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Read-only for your role</p>}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight">Grants & funding</h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Plan what each project needs, move applications forward, and keep every deadline and submission material visible.
          </p>
        </div>
        <a href="/budget" className="inline-flex h-10 w-fit items-center gap-2 border border-border bg-background px-3 text-sm font-medium transition hover:bg-muted">
          <HandCoins className="size-4" />
          Open Budget
        </a>
      </header>

      <section className="grid gap-px border border-border bg-border sm:grid-cols-2 xl:grid-cols-4" aria-label="Funding workspace summary">
        <SummaryCell
          label={hasMultipleCurrencies ? "Funding gap by currency" : "Confirmed funding gap"}
          value={hasMultipleCurrencies
            ? summary.fundingByCurrency.map((row) => formatMoney(row.gap, row.currency)).join(" · ")
            : formatMoney(primaryFunding.gap, primaryFunding.currency)}
          detail={hasMultipleCurrencies ? "Currencies kept separate" : `${formatMoney(primaryFunding.pending, primaryFunding.currency)} expected from pipeline (weighted)`}
        />
        <SummaryCell label="Funding projects" value={liveWorkspace.projects.length.toString()} detail={`${liveWorkspace.projects.filter((project) => project.priority === "high").length} high priority`} />
        <SummaryCell label="Active applications" value={summary.activeApplications.toString()} detail={`${summary.upcomingDeadlines} upcoming deadlines`} />
        <SummaryCell label="Materials to fix" value={summary.materialsNeedingAttention.toString()} detail="missing or stale requirements" />
      </section>
      {canMutate && <GrantWorkspaceTools workspace={liveWorkspace} />}

      {activeView === "worklist" && <GrantsWorklistView applications={liveWorkspace.applications} projects={liveWorkspace.projects} currentUserName={currentUserName} canMutate={canMutate} additionalItems={initialWorklist} onEdit={(application) => setApplicationDrawer({ application })} onComplete={canMutate ? completeWorklistAction : undefined} />}

      <nav className="-mx-1 overflow-x-auto px-1" aria-label="Grants workspace views">
        <div className="flex min-w-max border-b border-border" role="tablist">
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={activeView === id}
              onClick={() => setActiveView(id)}
              className={`relative inline-flex h-11 items-center gap-2 rounded-none px-3 text-sm font-medium transition sm:px-4 ${activeView === id ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Icon className="size-4" />
              {label}
              {activeView === id && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-primary" />}
            </Button>
          ))}
        </div>
      </nav>

      {activeView === "funding" && <FundingPlanView projects={liveWorkspace.projects} onSelectProject={setSelectedProject} />}
      {activeView === "applications" && (
        <ApplicationsView
          applications={liveWorkspace.applications}
          currentUserName={currentUserName}
          onCreate={canMutate ? () => setApplicationDrawer({}) : undefined}
          onEdit={canMutate ? (application) => setApplicationDrawer({ application }) : undefined}
        />
      )}
      {activeView === "opportunities" && (
        <GrantsCatalogView
          initialGrantId={initialGrantId}
          grants={liveWorkspace.opportunities}
          applications={liveWorkspace.applications}
          projects={liveWorkspace.projects}
          onStartApplication={canMutate ? (grant) => setApplicationDrawer({ opportunity: grant }) : undefined}
          onEditApplication={canMutate ? (application) => setApplicationDrawer({ application }) : undefined}
          onCreate={canMutate ? () => setOpportunityEditor("new") : undefined}
          onEdit={canMutate ? setOpportunityEditor : undefined}
        />
      )}
      {activeView === "assets" && <AssetsView assets={liveWorkspace.assets} />}
      {activeView === "calendar" && <CalendarReportingView events={liveWorkspace.calendarEvents} />}

      {selectedProject && (
        <ProjectDetailPanel
          project={selectedProject}
          applications={liveWorkspace.applications}
          assets={liveWorkspace.assets}
          onCreateNeed={canMutate ? () => setNeedEditor({ project: selectedProject }) : undefined}
          onEditNeed={canMutate ? (need) => setNeedEditor({ project: selectedProject, need }) : undefined}
          onClose={() => setSelectedProject(null)}
        />
      )}

      {applicationDrawer && (
        <GrantApplicationDrawer
          seed={applicationDrawer}
          projects={liveWorkspace.projects}
          opportunities={liveWorkspace.opportunities}
          contacts={liveWorkspace.contacts ?? []}
          members={liveWorkspace.members ?? []}
          onClose={() => setApplicationDrawer(null)}
          onSaved={async () => { setApplicationDrawer(null); await refreshWorkspace(); }}
        />
      )}

      {opportunityEditor && (
        <GrantOpportunityModal
          opportunity={opportunityEditor === "new" ? undefined : opportunityEditor}
          onClose={() => setOpportunityEditor(null)}
          onSaved={async () => { setOpportunityEditor(null); await refreshWorkspace(); }}
        />
      )}

      {needEditor && (
        <FundingNeedModal
          project={needEditor.project}
          need={needEditor.need}
          onClose={() => setNeedEditor(null)}
          onSaved={async () => { setNeedEditor(null); await refreshWorkspace(); }}
        />
      )}
    </div>
  );
}

function SummaryCell({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 bg-background p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums" title={value}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  );
}
