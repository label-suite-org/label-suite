"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Disc3,
  FileSignature,
  Link2,
  Mail,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import {
  contactCapabilityTags,
  contactReason,
  getContactOptionsForScope,
  type RightsContactOption,
} from "../roles/contactEligibility";
import { RoleForm, type RoleData } from "../roles/RoleForm";
import { CLEARANCE_STATUS_WEIGHTS, computeClearanceFromRoleRows, type ClearanceRoleRow } from "../../lib/readiness-core";
import { WorkDeleteButton, WorkEditButton } from "./WorkActionButtons";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
type Work = {
  id: string;
  title: string;
  isrc?: string | null;
  iswc?: string | null;
  duration?: number | null;
  genre?: string | null;
};

type RoleRow = RoleData & {
  id: string;
  contact_name?: string | null;
  isDraft?: boolean;
};

type ContactRow = RightsContactOption;

type TrackRow = {
  id: string;
  title: string;
  release_id?: string | null;
  position?: number | null;
  isrc?: string | null;
  track_ready?: boolean | null;
  clearance_pub?: number | null;
  clearance_master?: number | null;
  clearance_progress?: number | null;
};

type ScopeSummary = {
  label: "Publishing" | "Master";
  scopes: string[];
  rows: RoleRow[];
  entered: number;
  weighted: number;
  pct: number;
  cleared: boolean;
  applicable: boolean;
  hasRights: boolean;
  pendingRows: RoleRow[];
};

type NextFix = {
  id: string;
  title: string;
  detail: string;
  action?: "publishing" | "master";
  done?: boolean;
  optional?: boolean;
};

type ModalState = { title: string; defaults: RoleData } | null;
type SaveState = "saving" | "saved" | "failed";
type TemplateKind = "single" | "even" | "collab";
type WorkClearanceFocus = "publishing" | "master" | "credits";
type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: "neutral" | "green" | "amber";
};

const weightMap: Record<string, number> = {
  Signed: 1,
  Confirmed: 0.75,
  Pending: 0.25,
  Unknown: 0,
};

const inputClass =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm text-neutral-900 outline-none transition-colors hover:border-border hover:bg-background focus:border-neutral-300 focus:bg-background focus:ring-2 focus:ring-neutral-900/10";

export function WorkClearanceWorkspace({
  work,
  roles,
  contacts,
  tracks,
  canMutate = true,
}: {
  work: Work;
  roles: RoleRow[];
  contacts: ContactRow[];
  tracks: TrackRow[];
  canMutate?: boolean;
}) {
  const [activeScope, setActiveScope] = useState<WorkClearanceFocus | "recordings" | "activity">("publishing");
  const [roleRows, setRoleRows] = useState<RoleRow[]>(roles);
  const [modal, setModal] = useState<ModalState>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [requestSentIds, setRequestSentIds] = useState<Set<string>>(new Set());
  const [activity, setActivity] = useState<ActivityItem[]>(() => buildInitialActivity(roles, tracks));
  const [pendingWorkFocus, setPendingWorkFocus] = useState<WorkClearanceFocus | null>(null);

  const publishing = useMemo(() => summarizeScope("Publishing", ["Publishing", "Mechanical"], roleRows), [roleRows]);
  const master = useMemo(() => summarizeScope("Master", ["Master"], roleRows), [roleRows]);
  const credits = roleRows.filter((role) => role.ownership_type === "Credit");
  const clearanceDisplay = useMemo(() => getWorkClearanceDisplay(roleRows), [roleRows]);
  const unassignedCount = roleRows.filter((role) => !role.contact_id).length;
  const totalProgress = clearanceDisplay.progress;
  const ready = clearanceDisplay.cleared;
  const nextFixes = buildNextFixes(publishing, master, unassignedCount, ready);

  useEffect(() => {
    const applyRoute = () => {
      const route = parseWorkClearanceRoute(window.location.search);
      setActiveScope(route.scope ?? "publishing");
      setPendingWorkFocus(route.scope);
    };
    applyRoute();
    window.addEventListener("popstate", applyRoute);
    return () => {
      window.removeEventListener("popstate", applyRoute);
    };
  }, []);

  useEffect(() => {
    if (!pendingWorkFocus) return;
    const timeout = window.setTimeout(() => {
      const element = workClearanceFocusIds(pendingWorkFocus)
        .map((id) => document.getElementById(id))
        .find((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      element.focus();
      setPendingWorkFocus(null);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pendingWorkFocus, roleRows, credits.length]);

  function openCreate(scope: "Publishing" | "Master" | "Mechanical" | "Credit") {
    const isCredit = scope === "Credit";
    if (!isCredit) {
      setActiveScope(scope === "Master" ? "master" : "publishing");
      addDraftRole(scope);
      return;
    }

    setModal({
      title: "Add credit",
      defaults: {
        role: "Credit",
        ownership_type: "Credit",
        scope: "Master",
        percent_share: null,
        clearance_status: "Confirmed",
      },
    });
  }

  function addDraftRole(
    scope: "Publishing" | "Master" | "Mechanical",
    percentShare = 0,
    role = scope === "Master" ? "Master owner" : "Songwriter",
  ) {
    const draft = createDraftRole(scope, percentShare, role);

    setRoleRows((current) => [...current, draft]);
    setDirtyIds((current) => new Set(current).add(draft.id));
    logActivity("Split added", `${scope} row created inline with ${formatShare(percentShare)}.`, "amber");
  }

  function addRemainingSplit(scope: "Publishing" | "Master" | "Mechanical") {
    const summary = scope === "Master" ? master : publishing;
    const remaining = roundShare(100 - summary.entered);
    if (remaining <= 0) return;
    setActiveScope(scope === "Master" ? "master" : "publishing");
    addDraftRole(scope, remaining);
  }

  function applyTemplate(scope: "Publishing" | "Master" | "Mechanical", template: TemplateKind) {
    const summary = scope === "Master" ? master : publishing;
    const remaining = roundShare(100 - summary.entered);
    const baseShare = remaining > 0 ? remaining : 100;
    const rows = buildTemplateRows(scope, template, baseShare);
    const drafts = rows.map((row) => createDraftRole(scope, row.percentShare, row.role));

    setRoleRows((current) => [...current, ...drafts]);
    setDirtyIds((current) => {
      const next = new Set(current);
      drafts.forEach((draft) => next.add(draft.id));
      return next;
    });
    logActivity("Template applied", `${templateLabel(scope, template)} added ${drafts.length} draft split${drafts.length === 1 ? "" : "s"}.`, "amber");
  }

  function patchRole(roleId: string, patch: Partial<RoleRow>) {
    setRoleRows((current) =>
      current.map((role) => {
        if (role.id !== roleId) return role;
        const next = { ...role, ...patch };
        if (patch.contact_id !== undefined) {
          next.contact_name = contacts.find((contact) => contact.id === patch.contact_id)?.name ?? null;
        }
        return next;
      }),
    );
    setDirtyIds((current) => new Set(current).add(roleId));
  }

  function requestClearance(role: RoleRow) {
    if (!role.contact_id) return;
    if (!["Signed", "Confirmed"].includes(role.clearance_status || "Unknown")) {
      patchRole(role.id, { clearance_status: "Pending" });
    }
    setRequestSentIds((current) => new Set(current).add(role.id));
    logActivity(
      "Request queued",
      `${role.contact_name || "Selected contact"} will need ${role.scope || "rights"} clearance.`,
      "amber",
    );
  }

  async function saveRole(role: RoleRow) {
    setSavingId(role.id);
    setSaveStates((current) => ({ ...current, [role.id]: "saving" }));
    setDirtyIds((current) => {
      const next = new Set(current);
      next.delete(role.id);
      return next;
    });
    try {
      const isDraft = Boolean(role.isDraft);
      const res = await fetch("/api/roles", {
        method: isDraft ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(isDraft ? { work_id: work.id } : { id: role.id }),
          contact_id: role.contact_id || null,
          role: role.role || "",
          ownership_type: role.ownership_type || "Rights",
          scope: role.scope || null,
          percent_share: role.percent_share ?? null,
          clearance_status: role.clearance_status || "Unknown",
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save role");
      }
      const data = await res.json();
      if (isDraft) {
        setRoleRows((current) =>
          current.map((item) => item.id === role.id ? { ...item, id: data.id, isDraft: false } : item),
        );
        setSaveStates((current) => {
          const next = { ...current };
          delete next[role.id];
          next[data.id] = "saved";
          return next;
        });
      } else {
        setSaveStates((current) => ({ ...current, [role.id]: "saved" }));
      }
      logActivity("Split saved", `${role.role || "Role"} ${role.scope ? `on ${role.scope}` : "line"} saved.`, "green");
    } catch (err) {
      setDirtyIds((current) => new Set(current).add(role.id));
      setSaveStates((current) => ({ ...current, [role.id]: "failed" }));
      window.alert(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSavingId(null);
    }
  }

  async function deleteRole(role: RoleRow) {
    if (role.isDraft) {
      setRoleRows((current) => current.filter((item) => item.id !== role.id));
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(role.id);
        return next;
      });
      logActivity("Draft discarded", `${role.scope || "Rights"} row removed before saving.`, "neutral");
      return;
    }

    if (!window.confirm(`Delete ${role.role || "this role"} from ${role.contact_name || "this work"}?`)) {
      return;
    }
    setDeletingId(role.id);
    try {
      const res = await fetch("/api/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: role.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete role");
      }
      setRoleRows((current) => current.filter((item) => item.id !== role.id));
      logActivity("Split deleted", `${role.role || "Role"} removed from ${work.title}.`, "neutral");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setDeletingId(null);
    }
  }

  function logActivity(title: string, detail: string, tone: ActivityItem["tone"] = "neutral") {
    const entry: ActivityItem = {
      id: `activity-${crypto.randomUUID?.() ?? Date.now()}`,
      title,
      detail,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      tone,
    };
    setActivity((current) => [entry, ...current].slice(0, 8));
  }

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 px-2 pb-12 sm:px-0">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <a
            href="/works"
            className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to Works
          </a>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="break-words text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {work.title}
            </h1>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                ready
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}
            >
              {ready ? <BadgeCheck className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
              {ready ? "Cleared" : `${totalProgress}% clear`}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {work.iswc ? <InfoChip label={`ISWC ${work.iswc}`} mono /> : <InfoChip label="No ISWC" />}
            <InfoChip label={work.isrc ? `ISRC ${work.isrc}` : "No ISRC"} mono={Boolean(work.isrc)} />
            {work.genre ? <InfoChip label={work.genre} /> : null}
            {work.duration ? <InfoChip label={formatDuration(work.duration)} /> : null}
          </div>
        </div>
        <fieldset disabled={!canMutate} className="flex shrink-0 items-center gap-2">
          <WorkEditButton work={work} />
          <WorkDeleteButton work={work} />
        </fieldset>
      </header>

      <Tabs value={activeScope} onValueChange={value => { setActiveScope(value as typeof activeScope); setPendingWorkFocus(null); }} className="min-w-0 gap-5">
        <div className="overflow-x-auto border-b border-border">
          <TabsList variant="line" aria-label="Work sections" className="h-11">
            <TabsTrigger value="publishing">Publishing</TabsTrigger>
            <TabsTrigger value="master">Master</TabsTrigger>
            <TabsTrigger value="credits">Credits</TabsTrigger>
            <TabsTrigger value="recordings">Recordings</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>
        <fieldset disabled={!canMutate} className="min-w-0">
          <TabsContent value="publishing">
            <ClearanceBoard
              summary={publishing}
              contacts={contacts}
              accent="blue"
              sectionId="work-publishing"
              icon={<BookOpen className="h-5 w-5" />}
              dirtyIds={dirtyIds}
              savingId={savingId}
              deletingId={deletingId}
              saveStates={saveStates}
              requestSentIds={requestSentIds}
              onAdd={() => openCreate("Publishing")}
              onAddRemaining={() => addRemainingSplit("Publishing")}
              onApplyTemplate={(template) => applyTemplate("Publishing", template)}
              onPatch={patchRole}
              onSave={saveRole}
              onDelete={deleteRole}
              onRequest={requestClearance}
            />
          </TabsContent>
          <TabsContent value="master">
            <ClearanceBoard
              summary={master}
              contacts={contacts}
              accent="amber"
              sectionId="work-master"
              icon={<Disc3 className="h-5 w-5" />}
              dirtyIds={dirtyIds}
              savingId={savingId}
              deletingId={deletingId}
              saveStates={saveStates}
              requestSentIds={requestSentIds}
              onAdd={() => openCreate("Master")}
              onAddRemaining={() => addRemainingSplit("Master")}
              onApplyTemplate={(template) => applyTemplate("Master", template)}
              onPatch={patchRole}
              onSave={saveRole}
              onDelete={deleteRole}
              onRequest={requestClearance}
            />
          </TabsContent>
          <TabsContent value="credits">
            <CreditsPanel
              sectionId="work-credits"
              credits={credits}
              contacts={contacts}
              dirtyIds={dirtyIds}
              savingId={savingId}
              deletingId={deletingId}
              saveStates={saveStates}
              requestSentIds={requestSentIds}
              onAdd={() => openCreate("Credit")}
              onPatch={patchRole}
              onSave={saveRole}
              onDelete={deleteRole}
              onRequest={requestClearance}
            />
          </TabsContent>
          <TabsContent value="recordings">
            <TracksPanel tracks={tracks} publishing={publishing} master={master} />
          </TabsContent>
          <TabsContent value="activity" className="space-y-7">
            <NextFixes
              fixes={nextFixes}
              onCreatePublishing={() => openCreate("Publishing")}
              onCreateMaster={() => openCreate("Master")}
              onAddPublishingRemaining={() => addRemainingSplit("Publishing")}
              onAddMasterRemaining={() => addRemainingSplit("Master")}
            />
            <ActivityTrail activity={activity} />
          </TabsContent>

        </fieldset>
      </Tabs>

      <Dialog open={Boolean(modal)} onOpenChange={open => { if (!open) setModal(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{modal?.title}</DialogTitle>
            <DialogDescription>Add the person, points, and clearance state for this work.</DialogDescription>
          </DialogHeader>
          {modal && <RoleForm workId={work.id} contacts={contacts} role={modal.defaults} filterRightsContacts={modal.defaults.ownership_type !== "Credit"} onClose={() => setModal(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ClearanceBoard({
  summary,
  contacts,
  accent,
  icon,
  sectionId,
  dirtyIds,
  savingId,
  deletingId,
  saveStates,
  requestSentIds,
  onAdd,
  onAddRemaining,
  onApplyTemplate,
  onPatch,
  onSave,
  onDelete,
  onRequest,
}: {
  summary: ScopeSummary;
  contacts: ContactRow[];
  sectionId: string;
  accent: "blue" | "amber";
  icon: React.ReactNode;
  dirtyIds: Set<string>;
  savingId: string | null;
  deletingId: string | null;
  saveStates: Record<string, SaveState>;
  requestSentIds: Set<string>;
  onAdd: () => void;
  onAddRemaining: () => void;
  onApplyTemplate: (template: TemplateKind) => void;
  onPatch: (roleId: string, patch: Partial<RoleRow>) => void;
  onSave: (role: RoleRow) => void;
  onDelete: (role: RoleRow) => void;
  onRequest: (role: RoleRow) => void;
}) {
  const accentSoft = accent === "blue" ? "bg-accent text-accent-foreground" : "bg-amber-50 text-amber-700";
  const addLabel = summary.label === "Publishing" ? "Add publishing split" : "Add master split";
  const remaining = roundShare(100 - summary.entered);
  const templateOptions = getTemplateOptions(summary.label);

  return (
    <section id={sectionId} className="min-w-0 space-y-4">
      <div className="border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 sm:flex-nowrap">
          <div className="flex min-w-0 basis-full items-center gap-3 sm:flex-1 sm:basis-0">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accentSoft}`}>
              {icon}
            </span>
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold text-foreground">{summary.label} clearance</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatShare(summary.entered)} entered / {formatShare(summary.weighted)} weighted
              </p>
            </div>
          </div>
          <Button
            type="button"
            id={`${sectionId}-add`}
            variant="outline"
            onClick={onAdd}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
              accent === "blue"
                ? "border-blue-200 text-blue-700 hover:bg-blue-50"
                : "border-amber-200 text-amber-700 hover:bg-amber-50"
            }`}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {addLabel}
          </Button>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${summary.cleared ? "bg-emerald-50 text-emerald-700" : accentSoft}`}>
            {summary.applicable ? summary.cleared ? "Cleared" : `${summary.pct}%` : "Not applicable"}
          </span>
        </div>

      </div>

      <p className="text-xs text-muted-foreground sm:hidden">Scroll across to review all split fields.</p>
      <div className="overflow-x-auto" role="region" aria-label={`${summary.label} split fields`} tabIndex={0}><div className="min-w-[32rem]">
      <div className="grid grid-cols-[minmax(150px,1fr)_54px_82px_56px_60px] gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Role / contact</span>
        <span>Points</span>
        <span>Status</span>
        <span>Request</span>
        <span className="text-right">Save</span>
      </div>

      <div className="divide-y divide-border">
        {summary.rows.length ? (
          summary.rows.map((role, index) => (
            <InlineRoleRow
              key={role.id}
              role={role}
              contacts={contacts}
              filterRightsContacts
              dirty={dirtyIds.has(role.id)}
              saving={savingId === role.id}
              deleting={deletingId === role.id}
              saveState={saveStates[role.id]}
              requestSent={requestSentIds.has(role.id)}
              focusContactId={index === 0 ? `${sectionId}-first-contact` : undefined}
              onPatch={onPatch}
              onSave={onSave}
              onDelete={onDelete}
              onRequest={onRequest}
            />
          ))
        ) : (
          <div className="flex flex-col items-start gap-3 p-4">
            <div>
              <p className="text-sm font-medium text-foreground">No {summary.label.toLowerCase()} splits yet</p>
              <p className="mt-1 text-sm text-muted-foreground">Start with the person or company that owns points on this side.</p>
            </div>
          </div>
        )}
      </div>

      </div></div>

      <Accordion><AccordionItem value="split-tools" className="border-y border-border"><AccordionTrigger>Split tools & templates</AccordionTrigger><AccordionContent>      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">
            Total entered <strong className="text-foreground">{formatShare(summary.entered)}</strong>
          </p>
          {remaining > 0.01 ? (
            <Button variant="outline"
              type="button"
              onClick={onAddRemaining}
              className="mt-2 gap-1.5 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Add remaining {formatShare(remaining)}
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {templateOptions.map((template) => (
            <Button
              key={template.kind}
              variant="outline"
              type="button"
              onClick={() => onApplyTemplate(template.kind)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted"
            >
              <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
              {template.label}
            </Button>
          ))}

        </div>
      </div>
</AccordionContent></AccordionItem></Accordion>

      {summary.applicable && !summary.cleared ? (
        <div className="border-t border-border px-4 py-2 text-xs text-amber-700">
          {summary.entered < 100 ? (
            <span>{`Add ${formatShare(100 - summary.entered)} to reach 100%.`}</span>
          ) : summary.pendingRows.length ? (
            <span>{summary.pendingRows.length} line{summary.pendingRows.length === 1 ? "" : "s"} still need full clearance.</span>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function InlineRoleRow({
  role,
  contacts,
  filterRightsContacts = false,
  dirty,
  saving,
  deleting,
  saveState,
  requestSent,
  focusContactId,
  onPatch,
  onSave,
  onDelete,
  onRequest,
}: {
  role: RoleRow;
  contacts: ContactRow[];
  filterRightsContacts?: boolean;
  dirty: boolean;
  saving: boolean;
  deleting: boolean;
  saveState?: SaveState;
  requestSent: boolean;
  focusContactId?: string;
  onPatch: (roleId: string, patch: Partial<RoleRow>) => void;
  onSave: (role: RoleRow) => void;
  onDelete: (role: RoleRow) => void;
  onRequest: (role: RoleRow) => void;
}) {
  const contactOptions = filterRightsContacts
    ? getContactOptionsForScope(contacts, role.scope, role.contact_id)
    : { eligible: contacts, currentOnly: null };
  const selectedContact = role.contact_id ? contacts.find((contact) => contact.id === role.contact_id) ?? null : null;
  const capabilityTags = selectedContact ? contactCapabilityTags(selectedContact).slice(0, 3) : [];
  const contactHint = filterRightsContacts
    ? role.scope === "Master"
      ? "Showing artists, producers, labels, master owners, and contacts already used on master rights."
      : "Showing writers, composers, publishers, PRO/IPI artists, producers, and contacts already used on publishing rights."
    : "";

  return (
    <div className={`grid grid-cols-[minmax(150px,1fr)_54px_82px_56px_60px] gap-2 px-4 py-3 ${role.isDraft ? "bg-amber-50/50" : ""}`}>
      <div className="flex min-w-0 gap-2">
        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          {role.isDraft ? (
            <span className="ml-2 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-amber-700">
              New split
            </span>
          ) : null}
          <NativeSelect
            id={focusContactId}
            value={role.contact_id ?? ""}
            onChange={(event) => onPatch(role.id, { contact_id: event.target.value || null })}
            className={`${inputClass} truncate pr-5 font-semibold`}
            aria-label="Contact"
          >
            <option value="">Unassigned contact</option>
            {contactOptions.currentOnly ? (
              <optgroup label="Current selection">
                <option value={contactOptions.currentOnly.id}>
                  {contactOptions.currentOnly.name} (review eligibility)
                </option>
              </optgroup>
            ) : null}
            <optgroup label={filterRightsContacts ? "Rights candidates" : "Contacts"}>
              {contactOptions.eligible.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}{contactReason(contact, role.scope) ? ` - ${contactReason(contact, role.scope)}` : ""}
                </option>
              ))}
            </optgroup>
          </NativeSelect>
          {selectedContact ? (
            <div className="flex flex-wrap gap-1 px-2">
              {capabilityTags.length ? capabilityTags.map((tag) => (
                <span key={tag} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {tag}
                </span>
              )) : null}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${selectedContact.email ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                {selectedContact.email ? "Email ready" : "No email"}
              </span>
            </div>
          ) : filterRightsContacts ? <p className="px-2 text-[11px] leading-4 text-muted-foreground">{contactHint}</p> : null}
          <Input
            value={role.role ?? ""}
            onChange={(event) => onPatch(role.id, { role: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") onSave(role);
            }}
            className={`${inputClass} truncate text-xs text-muted-foreground`}
            aria-label="Role"
            placeholder="Role"
          />
        </div>
      </div>

      <div className="pt-1">
        <Input
          type="text"
          inputMode="decimal"
          value={role.percent_share ?? ""}
          onChange={(event) => {
            const value = event.target.value.replace(",", ".");
            onPatch(role.id, { percent_share: value === "" ? null : Number(value) });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSave(role);
          }}
          className={`${inputClass} px-1 text-right font-semibold`}
          aria-label="Points"
        />
      </div>

      <div className="pt-1">
        <NativeSelect
          value={role.clearance_status ?? "Unknown"}
          onChange={(event) => onPatch(role.id, { clearance_status: event.target.value })}
          className={`${inputClass} appearance-none px-1 text-xs ${statusSelectClass(role.clearance_status || "Unknown")}`}
          aria-label="Clearance status"
        >
          {["Signed", "Confirmed", "Pending", "Unknown"].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex items-start justify-start pt-1">
        <Button
          variant="ghost"
          type="button"
          onClick={() => onRequest(role)}
          disabled={!role.contact_id || role.clearance_status === "Signed" || role.clearance_status === "Confirmed"}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            requestSent
              ? "bg-emerald-50 text-emerald-700"
              : "text-muted-foreground hover:bg-blue-50 hover:text-blue-700"
          } disabled:cursor-not-allowed disabled:opacity-35`}
          aria-label="Queue clearance request"
          title={requestSent ? "Request queued" : selectedContact?.email ? "Queue clearance request" : "Add contact email before sending"}
        >
          {requestSent ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      <div className="flex items-start justify-end gap-1 pt-1">
        <Button
          type="button"
          onClick={() => onSave(role)}
          disabled={!dirty || saving}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
            dirty
              ? "bg-neutral-950 text-white hover:bg-neutral-800"
              : "text-neutral-300 hover:bg-muted"
          } disabled:opacity-50`}
          aria-label="Save split"
          title={saveButtonTitle(dirty, role.isDraft, saveState)}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          onClick={() => onDelete(role)}
          disabled={deleting}
          className="inline-flex h-8 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
          aria-label="Delete split"
          title={role.isDraft ? "Discard split" : "Delete split"}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
      {saveState === "saved" || saveState === "failed" ? (
        <p className={`col-span-5 -mt-2 pl-10 text-[11px] ${saveState === "failed" ? "text-red-600" : "text-emerald-700"}`}>
          {saveState === "failed" ? "Save failed. Changes are still editable." : "Saved."}
        </p>
      ) : null}
    </div>
  );
}

function NextFixes({
  fixes,
  onCreatePublishing,
  onCreateMaster,
  onAddPublishingRemaining,
  onAddMasterRemaining,
}: {
  fixes: NextFix[];
  onCreatePublishing: () => void;
  onCreateMaster: () => void;
  onAddPublishingRemaining: () => void;
  onAddMasterRemaining: () => void;
}) {
  return (
    <aside className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Next fixes</h2>
        <FileSignature className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        {fixes.map((fix) => (
          <Button
            key={fix.id}
            type="button"
            variant="ghost"
            onClick={() => {
              if (fix.action === "publishing") onCreatePublishing();
              if (fix.action === "master") onCreateMaster();
              if (fix.id === "publishing-balance") onAddPublishingRemaining();
              if (fix.id === "master-balance") onAddMasterRemaining();
            }}
            className="flex h-auto w-full items-center gap-3 border-b border-border rounded-none px-3 py-3 text-left whitespace-normal last:border-b-0 hover:bg-muted/30"
          >
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                fix.done ? "bg-emerald-100 text-emerald-700" : fix.optional ? "bg-muted text-muted-foreground" : "bg-amber-100 text-amber-700"
              }`}
            >
              {fix.done ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-foreground">{fix.optional ? `Optional: ${fix.title}` : fix.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{fix.detail}</span>
            </span>
          </Button>
        ))}
      </div>
    </aside>
  );
}

function ActivityTrail({ activity }: { activity: ActivityItem[] }) {
  return (
    <aside className="rounded-lg border border-border bg-background p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Activity</h2>
        <Clock3 className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-4 space-y-3">
        {activity.map((item) => (
          <div key={item.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2">
            <span className={`mt-1 h-2 w-2 rounded-full ${activityDotClass(item.tone)}`} />
            <span className="min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{item.time}</span>
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function TracksPanel({ tracks, publishing, master }: { tracks: TrackRow[]; publishing: ScopeSummary; master: ScopeSummary }) {
  return (
    <section className="min-w-0 space-y-4">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-base font-semibold text-foreground">Linked tracks & releases</h2>
      </div>
      <div className="overflow-x-auto"><div className="min-w-[56rem]">
      <div className="grid grid-cols-[minmax(0,1.4fr)_130px_210px_210px_140px] gap-3 border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        <span>Release / track</span>
        <span>ISRC</span>
        <span>Publishing readiness</span>
        <span>Master readiness</span>
        <span>Status</span>
      </div>
      <div className="divide-y divide-border">
        {tracks.length ? (
          tracks.map((track) => {
            const progress = Math.round((track.clearance_progress ?? 0) * 100);
            return (
              <a
                key={track.id}
                href={track.release_id ? `/releases/${track.release_id}/tracks` : "/tracks"}
                className="grid grid-cols-[minmax(0,1.4fr)_130px_210px_210px_140px] gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/30"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-foreground">{track.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{track.position ? `Track ${track.position}` : "Linked recording"}</span>
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">{track.isrc || "No ISRC"}</span>
                <ReadinessCell entered={publishing.entered} confirmed={publishing.weighted} tone="blue" />
                <ReadinessCell entered={master.entered} confirmed={master.weighted} tone="amber" />
                <span
                  className={`h-fit w-fit rounded-full px-2 py-1 text-xs font-semibold ${
                    track.track_ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {track.track_ready ? "Ready" : `${progress}%`}
                </span>
              </a>
            );
          })
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No tracks are linked to this work yet.</p>
        )}
      </div>
      </div></div>
    </section>
  );
}

function CreditsPanel({
  sectionId,
  credits,
  contacts,
  dirtyIds,
  savingId,
  deletingId,
  saveStates,
  requestSentIds,
  onAdd,
  onPatch,
  onSave,
  onDelete,
  onRequest,
}: {
  sectionId: string;
  credits: RoleRow[];
  contacts: ContactRow[];
  dirtyIds: Set<string>;
  savingId: string | null;
  deletingId: string | null;
  saveStates: Record<string, SaveState>;
  requestSentIds: Set<string>;
  onAdd: () => void;
  onPatch: (roleId: string, patch: Partial<RoleRow>) => void;
  onSave: (role: RoleRow) => void;
  onDelete: (role: RoleRow) => void;
  onRequest: (role: RoleRow) => void;
}) {
  return (
    <section id={sectionId} className="min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">Credits</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Name-only credits do not count toward clearance math.</p>
        </div>
        <Button variant="outline"
          type="button"
          id={`${sectionId}-add`}
          onClick={onAdd}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/30"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add credit
        </Button>
      </div>
      {credits.length ? (
        <div className="overflow-x-auto"><div className="min-w-[32rem] divide-y divide-border">
          {credits.map((role, index) => (
            <InlineRoleRow
              key={role.id}
              role={role}
              contacts={contacts}
              dirty={dirtyIds.has(role.id)}
              saving={savingId === role.id}
              deleting={deletingId === role.id}
              saveState={saveStates[role.id]}
              requestSent={requestSentIds.has(role.id)}
              focusContactId={index === 0 ? `${sectionId}-first-contact` : undefined}
              onPatch={onPatch}
              onSave={onSave}
              onDelete={onDelete}
              onRequest={onRequest}
            />
          ))}
        </div></div>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">No non-rights credits have been added yet.</p>
      )}
    </section>
  );
}

function ReadinessCell({ entered, confirmed, tone }: { entered: number; confirmed: number; tone: "blue" | "amber" }) {
  return (
    <span className="grid grid-cols-2 gap-3">
      <span>
        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Entered</span>
        <span className="font-semibold text-foreground">{formatShare(entered)}</span>
      </span>
      <span>
        <span className="block text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Weighted</span>
        <span className={`font-semibold ${tone === "blue" ? "text-blue-700" : "text-amber-700"}`}>{formatShare(confirmed)}</span>
      </span>
    </span>
  );
}

function InfoChip({ label, mono = false }: { label: string; mono?: boolean }) {
  return (
    <span className={`rounded-md border border-border bg-muted/30 px-2.5 py-1 text-muted-foreground ${mono ? "font-mono" : ""}`}>
      {label}
    </span>
  );
}

function createDraftRole(scope: "Publishing" | "Master" | "Mechanical", percentShare: number, role: string): RoleRow {
  return {
    id: `draft-${scope.toLowerCase()}-${crypto.randomUUID?.() ?? Date.now()}`,
    isDraft: true,
    contact_id: null,
    contact_name: null,
    role,
    ownership_type: "Rights",
    scope,
    percent_share: roundShare(percentShare),
    clearance_status: "Pending",
  };
}

function getTemplateOptions(scope: "Publishing" | "Master") {
  return scope === "Publishing"
    ? [
        { kind: "single" as const, label: "100 writer" },
        { kind: "even" as const, label: "2 writers" },
        { kind: "collab" as const, label: "Writer + publisher" },
      ]
    : [
        { kind: "single" as const, label: "100 master" },
        { kind: "even" as const, label: "Artist + producer" },
        { kind: "collab" as const, label: "Label + producer" },
      ];
}

function buildTemplateRows(scope: "Publishing" | "Master" | "Mechanical", template: TemplateKind, baseShare: number) {
  if (template === "single") {
    return [{ role: scope === "Master" ? "Master owner" : "Songwriter", percentShare: baseShare }];
  }

  const half = roundShare(baseShare / 2);
  const remainder = roundShare(baseShare - half);
  if (scope === "Master") {
    return template === "even"
      ? [
          { role: "Artist master share", percentShare: half },
          { role: "Producer master share", percentShare: remainder },
        ]
      : [
          { role: "Label master share", percentShare: half },
          { role: "Producer master share", percentShare: remainder },
        ];
  }

  return template === "even"
    ? [
        { role: "Songwriter", percentShare: half },
        { role: "Songwriter", percentShare: remainder },
      ]
    : [
        { role: "Songwriter", percentShare: half },
        { role: "Publisher", percentShare: remainder },
      ];
}

function templateLabel(scope: "Publishing" | "Master" | "Mechanical", template: TemplateKind) {
  return getTemplateOptions(scope === "Master" ? "Master" : "Publishing").find((item) => item.kind === template)?.label ?? "Template";
}

function buildInitialActivity(roles: RoleRow[], tracks: TrackRow[]): ActivityItem[] {
  const pending = roles.filter((role) => role.ownership_type !== "Credit" && !["Signed", "Confirmed"].includes(role.clearance_status || "Unknown")).length;
  const missingContacts = roles.filter((role) => !role.contact_id).length;
  const items: ActivityItem[] = [
    {
      id: "activity-loaded",
      title: "Workspace opened",
      detail: `${tracks.length} linked track${tracks.length === 1 ? "" : "s"} and ${roles.length} role line${roles.length === 1 ? "" : "s"} loaded.`,
      time: "Now",
      tone: "neutral",
    },
  ];

  if (pending) {
    items.push({
      id: "activity-pending",
      title: "Signatures pending",
      detail: `${pending} rights line${pending === 1 ? "" : "s"} still need confirmation.`,
      time: "Current",
      tone: "amber",
    });
  }

  if (missingContacts) {
    items.push({
      id: "activity-contact",
      title: "Contacts missing",
      detail: `${missingContacts} line${missingContacts === 1 ? "" : "s"} need a person or company.`,
      time: "Current",
      tone: "amber",
    });
  }

  return items;
}

function saveButtonTitle(dirty: boolean, isDraft?: boolean, saveState?: SaveState) {
  if (saveState === "saving") return "Saving";
  if (saveState === "saved") return "Saved";
  if (saveState === "failed") return "Try saving again";
  if (dirty) return isDraft ? "Create split" : "Save split";
  return "No changes";
}

function activityDotClass(tone: ActivityItem["tone"]) {
  if (tone === "green") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-500";
  return "bg-neutral-300";
}

export function summarizeScope(label: "Publishing" | "Master", scopes: string[], roles: RoleRow[]): ScopeSummary {
  const rows = roles.filter((role) => role.ownership_type !== "Credit" && scopes.includes(role.scope || ""));
  const clearance = computeClearanceFromRoleRows(normalizeClearanceRoles(roles));
  const scope = label === "Publishing" ? clearance.pub : clearance.master;
  const pendingRows = rows.filter((role) => (CLEARANCE_STATUS_WEIGHTS[role.clearance_status || "Unknown"] ?? 0) < 1);

  return {
    label,
    scopes,
    rows,
    entered: scope.enteredTotal,
    weighted: scope.weightedTotal,
    pct: Math.round(scope.progress * 100),
    cleared: scope.cleared,
    applicable: rows.length > 0,
    hasRights: rows.length > 0,
    pendingRows,
  };
}

export function buildNextFixes(publishing: ScopeSummary, master: ScopeSummary, unassignedCount: number, workCleared: boolean): NextFix[] {
  const fixes: NextFix[] = [];

  addScopeFixes(fixes, publishing, "publishing");
  addScopeFixes(fixes, master, "master");

  if (unassignedCount > 0) {
    fixes.push({
      id: "unassigned",
      title: "Link contact",
      detail: `${unassignedCount} line${unassignedCount === 1 ? "" : "s"} need a person or company.`,
    });
  }

  if (publishing.pendingRows.length || master.pendingRows.length) {
    fixes.push({
      id: "signature-request",
      title: "Send signature request",
      detail: "Contract automation can attach here next.",
    });
  }

  const hasBlockingFixes = fixes.length > 0;
  if (!hasBlockingFixes && workCleared) {
    fixes.push({
      id: "done",
      title: "Ready for final clearance review",
      detail: "Every applicable scope is cleared.",
      done: true,
    });
  }

  addOptionalScopeAction(fixes, publishing, "publishing");
  addOptionalScopeAction(fixes, master, "master");

  return fixes.slice(0, 5);
}

function addScopeFixes(
  fixes: NextFix[],
  summary: ScopeSummary,
  action: "publishing" | "master",
) {
  const label = summary.label.toLowerCase();
  if (!summary.applicable || summary.cleared) return;

  if (summary.entered < 100) {
    fixes.push({
      id: `${action}-balance`,
      title: `Balance ${label} to 100%`,
      detail: `${formatShare(100 - summary.entered)} still unassigned.`,
    });
  }

  if (summary.pendingRows.length) {
    fixes.push({
      id: `${action}-pending`,
      title: `Chase ${label} signatures`,
      detail: `${summary.pendingRows.length} role${summary.pendingRows.length === 1 ? "" : "s"} still pending.`,
    });
  }
}

function addOptionalScopeAction(fixes: NextFix[], summary: ScopeSummary, action: "publishing" | "master") {
  if (summary.applicable) return;
  const label = summary.label.toLowerCase();
  fixes.push({
    id: `${action}-missing`,
    title: `Add ${label} split`,
    detail: `No ${label} rights are attached yet. Add one if this scope applies.`,
    action,
    optional: true,
  });
}

function statusSelectClass(status: string) {
  if (status === "Signed") return "font-semibold text-emerald-700";
  if (status === "Confirmed") return "font-semibold text-sky-700";
  if (status === "Pending") return "font-semibold text-amber-700";
  return "font-semibold text-muted-foreground";
}

function formatShare(value: number) {
  return `${roundShare(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
}

function roundShare(value: number) {
  return Math.round(value * 100) / 100;
}

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export type WorkClearanceDisplayRole = Partial<ClearanceRoleRow>;

/** Draft form rows may omit fields; the shared persisted-row contract uses null. */
function normalizeClearanceRoles(rows: WorkClearanceDisplayRole[]): ClearanceRoleRow[] {
  return rows.map((row) => ({
    ownership_type: row.ownership_type ?? null,
    scope: row.scope ?? null,
    percent_share: row.percent_share ?? null,
    clearance_status: row.clearance_status ?? null,
  }));
}

export function getWorkClearanceDisplay(roleRows: WorkClearanceDisplayRole[]) {
  const clearance = computeClearanceFromRoleRows(normalizeClearanceRoles(roleRows));
  return {
    progress: Math.round(clearance.overall * 100),
    cleared: clearance.cleared,
  };
}

export function parseWorkClearanceRoute(search: string): { scope: WorkClearanceFocus | null } {
  const params = new URLSearchParams(search);
  return {
    scope: parseWorkClearanceFocus(params.get("scope") ?? params.get("focus")),
  };
}

function parseWorkClearanceFocus(value: string | null): WorkClearanceFocus | null {
  if (value === "publishing" || value === "master" || value === "credits") return value;
  return null;
}

export function workClearanceFocusIds(scope: WorkClearanceFocus): string[] {
  if (scope === "publishing") return ["work-publishing-first-contact", "work-publishing-add"];
  if (scope === "master") return ["work-master-first-contact", "work-master-add"];
  return ["work-credits-first-contact", "work-credits-add"];
}
