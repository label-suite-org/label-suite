"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import BudgetGrantGuidance, { type GrantGuidance } from "./BudgetGrantGuidance";
import BudgetKpiStrip from "./BudgetKpiStrip";
import BudgetBucketMatrix from "./BudgetBucketMatrix";
import FundingStack from "./FundingStack";
import BudgetLineTable from "./BudgetLineTable";
import CashflowTimeline from "./CashflowTimeline";
import NewProjectModal from "./NewProjectModal";
import NewFundingSourceModal from "./NewFundingSourceModal";
import { projectTypeLabels } from "../../lib/projects-events-core";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
interface Project {
  id: string;
  name: string;
  project_type: string;
  status: string | null;
  currency: string | null;
  total_planned: number | null;
  baseline_funding: number | null;
  track_count: number | null;
  singles_count: number | null;
  artist_name: string | null;
  release_title: string | null;
  release_format: string | null;
  cover_art_url: string | null;
}

interface ArtistOption { id: string; name: string }
interface ReleaseOption { id: string; title: string }

interface BudgetDepartmentProps {
  workspaceId?: string;
  projects: Project[];
  hasLegacyItems: boolean;
  artistOptions: ArtistOption[];
  releaseOptions: ReleaseOption[];
  grantGuidance?: GrantGuidance[];
  initialProjectId?: string | null;
  canMutate?: boolean;
  canDecideVariance?: boolean;
}

export default function BudgetDepartment({ workspaceId = "default", projects, artistOptions, releaseOptions, canMutate = true, canDecideVariance = false, grantGuidance = [], initialProjectId = null }: BudgetDepartmentProps) {
  const [projectList, setProjectList] = useState<Project[]>(projects);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(projects.find(p => p.id === initialProjectId)?.id ?? projects[0]?.id ?? null);
  const [selectionReady, setSelectionReady] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [grantDetailsOpen, setGrantDetailsOpen] = useState(false);
  const [allGrantsOpen, setAllGrantsOpen] = useState(false);
  const [projectNotes, setProjectNotes] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kpi, setKpi] = useState<any>(null);
  const [buckets, setBuckets] = useState<any[]>([]);
  const [lines, setLines] = useState<any[]>([]);
  const [funding, setFunding] = useState<any[]>([]);
  const [phases, setPhases] = useState<any[]>([]);
  const [calendarPhases, setCalendarPhases] = useState<any[]>([]);
  const [coverage, setCoverage] = useState<any>(null);
  const [varianceRequests, setVarianceRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showNewFunding, setShowNewFunding] = useState(false);

  const refetch = useCallback(async (signal?: AbortSignal) => {
    if (!activeProjectId) return;
    setLoading(true);
    setLoadError(null);
    setKpi(null);
    try {
      const res = await fetch(`/api/budget-projects/${activeProjectId}/dashboard`, { signal });
      if (!res.ok) throw new Error("Could not load this budget. Please try again.");
      const data = await res.json();
      if (signal?.aborted) return;
      setProjectNotes(data.project?.notes ?? null);
      setKpi(data.kpi);
      setBuckets(data.buckets);
      setLines(data.lines);
      setFunding(data.funding);
      setPhases(data.phases);
      setCalendarPhases(data.calendarPhases ?? []);
      setCoverage(data.coverage ?? null);
      setVarianceRequests(data.varianceRequests ?? []);
    } catch (error) {
      if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : "Could not load this budget.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeProjectId]);

  const refetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/budget-projects");
      const data = await res.json();
      if (data?.projects) setProjectList(data.projects);
    } catch {
      // ignore — list refresh is best-effort
    }
  }, []);

  useEffect(() => {
    if (!initialProjectId) {
      try {
        const saved = localStorage.getItem(`budget-project:${workspaceId}`);
        if (projects.some(project => project.id === saved)) setActiveProjectId(saved);
      } catch { /* Browser storage is optional; keep the first accessible project. */ }
    }
    setSelectionReady(true);
  }, [workspaceId, initialProjectId, projects]);

  useEffect(() => {
    if (!selectionReady || !activeProjectId) return;
    try { localStorage.setItem(`budget-project:${workspaceId}`, activeProjectId); }
    catch { /* Project selection still works when storage is unavailable. */ }
    // SAFETY: a malformed location must not break saving the project selection.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("project", activeProjectId);
      window.history.replaceState(null, "", url);
    } catch {
      /* ignore — keep the selection without syncing the URL */
    }
    setNotesOpen(false);
    setGrantDetailsOpen(false);
    setAllGrantsOpen(false);
    const controller = new AbortController();
    void refetch(controller.signal);
    return () => controller.abort();
  }, [refetch, selectionReady, activeProjectId, workspaceId]);

  if (projectList.length === 0) {
    return (
      <div className="space-y-4">
        <div className="p-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <p className="text-lg">No budget projects yet.</p>
          <p className="text-sm mt-1">{canMutate ? "Create your first project to start planning." : "Read-only for your role"}</p>
          {canMutate && <Button
            onClick={() => setShowNewProject(true)}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-foreground px-4 text-sm font-medium text-background"
          >
            <Plus className="h-4 w-4" />
            New project
          </Button>}
        </div>
        {canMutate && showNewProject && (
          <NewProjectModal
            onClose={() => setShowNewProject(false)}
            onCreated={async (id) => {
              setShowNewProject(false);
              await refetchProjects();
              setActiveProjectId(id);
            }}
            artistOptions={artistOptions}
            releaseOptions={releaseOptions}
          />
        )}
      </div>
    );
  }

  const activeProject = projectList.find((p) => p.id === activeProjectId);
  const activeCurrency = activeProject?.currency ?? coverage?.currency ?? "DKK";
  const activeProjectTypeLabel = activeProject?.project_type && activeProject.project_type in projectTypeLabels
    ? projectTypeLabels[activeProject.project_type as keyof typeof projectTypeLabels]
    : "Other";

  const projectGrants = grantGuidance.filter(grant => grant.project_id === activeProjectId);
  const otherGrants = grantGuidance.filter(grant => !projectGrants.includes(grant));
  const pendingSources = funding.filter(source => source.type === "grant" && !["confirmed", "granted", "rejected", "cancelled"].includes(source.status));
  function reveal(section: "notes" | "grants", id: string) {
    if (section === "notes") setNotesOpen(true); else setGrantDetailsOpen(true);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }

  return (
    <div className="min-w-0 space-y-5">
      <header className="space-y-4">
        <div><h1 className="text-2xl font-semibold">Money & budgets</h1><p className="mt-1 text-sm text-muted-foreground">Know what each project costs and what your funding can cover.</p></div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <label htmlFor="budget-project" className="mb-1 block text-sm font-medium">Project</label>
            <NativeSelect id="budget-project" value={activeProjectId ?? ""} onChange={event => {
              setActiveProjectId(event.target.value);
              try {
                const url = new URL(window.location.href);
                url.searchParams.set("project", event.target.value);
                window.history.replaceState(null, "", url);
              } catch {
                /* ignore — the selection still applies without URL sync */
              }
            }} className="h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm">
              {projectList.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </NativeSelect>
          </div>
          <span className="py-3 text-sm text-muted-foreground">{activeCurrency} · {activeProjectTypeLabel} project</span>
          {canMutate && <Button onClick={() => setShowNewProject(true)} className="h-11 rounded-md border border-border px-3 text-sm">New project</Button>}
          <a href={`/api/budget-projects/${activeProjectId}/export?format=xls`} className="py-3 text-sm underline">Export</a>
        </div>
      </header>
      {(!selectionReady || loading) && <p role="status" className="text-sm text-muted-foreground">Loading project data…</p>}
      {loadError && <div role="alert" className="text-sm text-red-700">{loadError} <Button variant="link" className="underline" onClick={() => void refetch()}>Retry</Button></div>}
      {!canMutate && <p className="text-sm text-muted-foreground">Read-only for your role</p>}
      {kpi && <>
        <BudgetKpiStrip kpi={kpi} coverage={coverage} sources={funding} currency={activeCurrency} />
        {(projectNotes || projectGrants.some(grant => grant.next_action && grant.workflow_stage !== "closed") || pendingSources.length > 0) && <section aria-label="Next actions" className="rounded-lg border border-border p-4">
          <h2 className="font-semibold">Next actions</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {projectNotes && <li><Button variant="link" className="text-left underline" onClick={() => reveal("notes", "budget-notes")}>Review budget figures and open questions</Button></li>}
            {projectGrants.filter(grant => grant.next_action && grant.workflow_stage !== "closed").slice(0, 1).map(grant => <li key={grant.id}><Button variant="link" className="text-left underline" onClick={() => reveal("grants", `grant-${grant.id}`)}>{grant.name}: {grant.next_action}</Button></li>)}
            {pendingSources.length > 0 && <li><a href="#project-funding" className="underline">Review {pendingSources.length} grant plans and applications</a></li>}
          </ul>
        </section>}
        <section id="spending-plan" className="min-w-0 space-y-3">
          <div><h2 className="text-lg font-semibold">Spending plan</h2><p className="text-sm text-muted-foreground">What you plan to spend, recorded payments and the intended funding source.</p></div>
          {lines.length > 0 ? <ReadOnlySurface readOnly={!canMutate}><BudgetLineTable key={activeProjectId} lines={lines} varianceRequests={varianceRequests} canDecideVariance={canDecideVariance} onChanged={() => void refetch()} currency={activeCurrency} /></ReadOnlySurface> : <p className="text-sm text-muted-foreground">No expense lines recorded.</p>}
        </section>
        <div id="project-funding"><FundingStack key={activeProjectId} sources={funding} currency={activeCurrency} onChanged={canMutate ? () => void refetch() : undefined} onAdd={canMutate ? () => setShowNewFunding(true) : undefined} /></div>
        {projectGrants.length > 0 && <details open={grantDetailsOpen} onToggle={event => setGrantDetailsOpen(event.currentTarget.open)} className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer font-medium">Grant purposes for this project · {projectGrants.length}</summary>
          <div className="mt-3"><BudgetGrantGuidance grants={projectGrants} /></div>
        </details>}
        {projectNotes && <details id="budget-notes" open={notesOpen} onToggle={event => setNotesOpen(event.currentTarget.open)} className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Budget notes and open questions</summary><p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed">{projectNotes}</p></details>}
        {otherGrants.length > 0 && <details open={allGrantsOpen} onToggle={event => setAllGrantsOpen(event.currentTarget.open)} className="rounded-lg border border-border p-4"><summary className="cursor-pointer font-medium">Other workspace grants · {otherGrants.length}</summary><p className="mt-2 text-sm text-muted-foreground">These awards are not confirmed funding for the selected project.</p><div className="mt-3"><BudgetGrantGuidance grants={otherGrants} title="Other grant money" /></div></details>}
        <details className="min-w-0 rounded-lg border border-border bg-card p-4">
          <summary className="cursor-pointer font-medium">Category totals and cashflow</summary>
          <div className="mt-4 min-w-0 space-y-4 overflow-x-auto">
            {buckets.length > 0 && <BudgetBucketMatrix buckets={buckets} kpi={kpi} lines={lines} currency={activeCurrency} />}
            {calendarPhases.length > 0 ? <CashflowTimeline phases={phases} calendarMonths={calendarPhases} funding={funding} currency={activeCurrency} /> : <p className="text-sm text-muted-foreground">Add a spending month to expense lines to see cashflow.</p>}
          </div>
        </details>
      </>}

      {canMutate && showNewProject && (
        <NewProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={async (id) => {
            setShowNewProject(false);
            await refetchProjects();
            setActiveProjectId(id);
          }}
          artistOptions={artistOptions}
          releaseOptions={releaseOptions}
        />
      )}

      {canMutate && showNewFunding && activeProjectId && (
        <NewFundingSourceModal
          projectId={activeProjectId}
          onClose={() => setShowNewFunding(false)}
          onTrackAsApplication={() => { window.location.assign(`/grants?newApplicationProjectId=${encodeURIComponent(activeProjectId)}`); }}
          onCreated={async () => {
            setShowNewFunding(false);
            await refetch();
          }}
        />
      )}
    </div>
  );
}

function ReadOnlySurface({ readOnly, children }: { readOnly: boolean; children: ReactNode }) {
  if (!readOnly) return <>{children}</>;
  return <div inert aria-disabled="true" className="opacity-75">{children}</div>;
}
