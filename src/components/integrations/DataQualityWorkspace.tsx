"use client";

import { useMemo, useState } from "react";

import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
export type DataQualityIssue = {
  id: string;
  connection_id: string | null;
  source: string;
  issue_type: string;
  priority: string;
  status: string;
  label_suite_object_type: string | null;
  label_suite_object_id: string | null;
  external_object_type: string | null;
  external_object_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type DataQualityTargetOptions = Record<"release" | "track" | "work" | "station", Array<{ id: string; label: string }>>;

type Connection = { id: string; provider_key: string; provider_name: string; label: string; status: string };

export default function DataQualityWorkspace({
  initialIssues,
  connections,
  targetOptions,
}: {
  initialIssues: DataQualityIssue[];
  connections: Connection[];
  targetOptions: DataQualityTargetOptions;
}) {
  const [issues, setIssues] = useState(initialIssues);
  const [source, setSource] = useState("");
  const [priority, setPriority] = useState("");
  const [status, setStatus] = useState("open");
  const [filterObjectType, setFilterObjectType] = useState("");
  const [targets, setTargets] = useState<Record<string, { objectType: keyof DataQualityTargetOptions; targetId: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [connectionByIssue, setConnectionByIssue] = useState<Record<string, string>>(() => Object.fromEntries(initialIssues.filter((issue) => issue.connection_id).map((issue) => [issue.id, issue.connection_id as string])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const sources = useMemo(() => [...new Set(issues.map((issue) => issue.source))].sort(), [issues]);
  const filtered = issues.filter((issue) =>
    (!source || issue.source === source) &&
    (!priority || issue.priority === priority) &&
    (!status || issue.status === status) &&
    (!filterObjectType || issue.label_suite_object_type === filterObjectType),
  );

  async function patchIssue(id: string, nextStatus: string) {
    setError(null);
    setBusyId(id);
    try {
      const response = await fetch("/api/integrations/data-quality", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: nextStatus }),
      });
      if (!response.ok) throw new Error("Could not update issue");
      const updated = await response.json() as DataQualityIssue;
      setIssues((current) => current.map((issue) => issue.id === id ? updated : issue));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update issue");
    } finally {
      setBusyId(null);
    }
  }

  async function createTask(issue: DataQualityIssue) {
    setError(null);
    setBusyId(issue.id);
    try {
      const response = await fetch(`/api/integrations/data-quality/${issue.id}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("Could not create task");
      const result = await response.json() as { issue: DataQualityIssue };
      setIssues((current) => current.map((item) => item.id === issue.id ? result.issue : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create task");
    } finally {
      setBusyId(null);
    }
  }

  async function linkIssue(issue: DataQualityIssue) {
    const { objectType, targetId } = targets[issue.id] ?? { objectType: "release", targetId: "" };
    const connectionId = connectionByIssue[issue.id] ?? issue.connection_id;
    if (!connectionId || !targetId) return;
    setError(null);
    setBusyId(issue.id);
    try {
      const response = await fetch(`/api/integrations/data-quality/${issue.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId,
          external_object_type: issue.external_object_type ?? "record",
          external_object_id: issue.external_object_id ?? issue.id,
          label_suite_object_type: objectType,
          label_suite_object_id: targetId,
          match_method: "manual",
        }),
      });
      if (!response.ok) throw new Error("Could not link object");
      const result = await response.json() as { issue: DataQualityIssue };
      setIssues((current) => current.map((item) => item.id === issue.id ? result.issue : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link object");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2 border-b border-[var(--border)] pb-6">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Operations · Integrations</p>
        <h1 className="text-3xl font-semibold tracking-tight">Data-quality queue</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">Every mismatch has a concrete next action: resolve, ignore, link it to a canonical object, or create an operations task.</p>
      </header>

      {error && <p role="alert" className="border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p>}

      <div className="flex flex-wrap gap-2 rounded-lg border border-border bg-card p-3">
        <NativeSelect aria-label="Source" value={source} onChange={(event) => setSource(event.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">All sources</option>{sources.map((item) => <option key={item} value={item}>{item}</option>)}
        </NativeSelect>
        <NativeSelect aria-label="Priority" value={priority} onChange={(event) => setPriority(event.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">All priorities</option><option>P0</option><option>P1</option><option>P2</option><option>P3</option>
        </NativeSelect>
        <NativeSelect aria-label="Status" value={status} onChange={(event) => setStatus(event.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">All statuses</option><option value="open">Open</option><option value="triaged">Triaged</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option>
        </NativeSelect>
        <NativeSelect aria-label="Object type" value={filterObjectType} onChange={(event) => setFilterObjectType(event.target.value)} className="rounded border border-border bg-background px-2 py-1 text-sm">
          <option value="">All object types</option><option value="release">Release</option><option value="track">Track</option><option value="work">Work</option><option value="station">Station</option>
        </NativeSelect>
        <span className="ml-auto self-center text-xs text-muted-foreground">{filtered.length} of {issues.length} issues</span>
      </div>

      {filtered.length ? (
        <div className="space-y-3">
          {filtered.map((issue) => {
            const busy = busyId !== null;
            const { objectType, targetId } = targets[issue.id] ?? { objectType: "release", targetId: "" };
            return <article key={issue.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{issue.issue_type}</h2><span className="rounded bg-muted px-2 py-0.5 text-xs">{issue.priority}</span><span className="rounded bg-muted px-2 py-0.5 text-xs">{issue.status}</span></div>
                  <p className="mt-1 text-sm text-muted-foreground">{issue.source} · {issue.external_object_type ?? "external record"} {issue.external_object_id ?? ""}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {issue.status !== "resolved" && <Button disabled={busy} onClick={() => patchIssue(issue.id, "resolved")} className="rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-50">Resolve</Button>}
                  {issue.status !== "ignored" && <Button variant="outline" disabled={busy} onClick={() => patchIssue(issue.id, "ignored")} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Ignore</Button>}
                  <Button variant="outline" disabled={busy} onClick={() => createTask(issue)} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Create task</Button>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
                <label className="grid gap-1 text-xs text-muted-foreground">Source connection<NativeSelect value={connectionByIssue[issue.id] ?? issue.connection_id ?? ""} onChange={(event) => setConnectionByIssue((current) => ({ ...current, [issue.id]: event.target.value }))} className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"><option value="">Select source…</option>{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.provider_name} · {connection.label}</option>)}</NativeSelect></label>
                <label className="grid gap-1 text-xs text-muted-foreground">Canonical type<NativeSelect value={objectType} onChange={(event) => { setTargets((current) => ({ ...current, [issue.id]: { objectType: event.target.value as keyof DataQualityTargetOptions, targetId: "" } })); }} className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"><option value="release">Release</option><option value="track">Track</option><option value="work">Work</option><option value="station">Station</option></NativeSelect></label>
                <label className="grid min-w-52 flex-1 gap-1 text-xs text-muted-foreground">Canonical target<NativeSelect value={targetId} onChange={(event) => setTargets((current) => ({ ...current, [issue.id]: { objectType, targetId: event.target.value } }))} className="rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground"><option value="">Select target…</option>{targetOptions[objectType].map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</NativeSelect></label>
                <Button variant="outline" disabled={busy || !(connectionByIssue[issue.id] ?? issue.connection_id) || !targetId} onClick={() => linkIssue(issue)} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Link external object</Button>
              </div>
              {issue.details && <pre className="mt-3 max-h-24 overflow-auto rounded bg-muted/30 p-2 text-xs text-muted-foreground">{JSON.stringify(issue.details, null, 2)}</pre>}
            </article>;
          })}
        </div>
      ) : <div className="rounded-lg border-2 border-dashed border-border p-12 text-center text-sm text-muted-foreground">No data-quality issues match these filters.</div>}
      {connections.length === 0 && <p className="text-xs text-muted-foreground">No integration connections are configured yet.</p>}
    </section>
  );
}
