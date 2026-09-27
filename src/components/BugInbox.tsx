"use client";

import { useState } from "react";
import { Bug, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
interface Bug {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  status: string | null;
  auto_generated: boolean | null;
}

const statusOptions = [
  { value: "logged", label: "Logged" },
  { value: "triaged", label: "Triaged" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
] as const;

type StatusFeedback = { kind: "error" | "success"; message: string };

export function BugInbox({ initialBugs }: { initialBugs: Bug[] }) {
  const [bugs, setBugs] = useState(initialBugs);
  const [sweeping, setSweeping] = useState(false);
  const [sweepResult, setSweepResult] = useState<string | null>(null);
  const [savingBugId, setSavingBugId] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<Record<string, StatusFeedback>>({});

  async function runSweep() {
    setSweeping(true);
    setSweepResult(null);
    try {
      const res = await fetch("/api/sweep", { method: "POST" });
      const data = await res.json();
      setSweepResult(`Sweep: ${data.created} new, ${data.openIssues} open, ${data.closed} closed. Re-evaluated ${data.releasesReevaluated} releases, ${data.tracksReevaluated} tracks.`);
      // Refresh bugs
      window.location.reload();
    } catch {
      setSweepResult("Sweep failed.");
    } finally {
      setSweeping(false);
    }
  }

  async function updateStatus(bugId: string, status: string) {
    if (savingBugId) return;
    setSavingBugId(bugId);
    setStatusFeedback(prev => {
      const next = { ...prev };
      delete next[bugId];
      return next;
    });

    try {
      const response = await fetch("/api/bugs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bugId, status }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string; ok?: boolean };
      if (!response.ok || result.ok !== true) throw new Error(result.error || "The status could not be saved.");

      setBugs(prev => prev.map(b => b.id === bugId ? { ...b, status } : b));
      const label = statusOptions.find(option => option.value === status)?.label ?? status;
      setStatusFeedback(prev => ({ ...prev, [bugId]: { kind: "success", message: `Status changed to ${label}.` } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The status could not be saved.";
      setStatusFeedback(prev => ({ ...prev, [bugId]: { kind: "error", message: `${message} Try again.` } }));
    } finally {
      setSavingBugId(null);
    }
  }

  const priorityColor: Record<string, string> = {
    P0: "bg-red-100 text-red-700",
    P1: "bg-orange-100 text-orange-700",
    P2: "bg-neutral-100 text-neutral-600",
    P3: "bg-neutral-50 text-neutral-400",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <Bug className="h-4 w-4" />
          Bugs ({bugs.length})
        </h3>
        <Button variant="ghost" onClick={runSweep} disabled={sweeping}
          className="px-3 py-1.5 bg-neutral-900 text-white text-xs font-medium rounded-md hover:bg-neutral-800 disabled:opacity-50">
          {sweeping ? "Sweeping..." : "Run Sweep"}
        </Button>
      </div>
      {sweepResult && <p className="text-xs text-neutral-500">{sweepResult}</p>}
      <div className="space-y-2">
        {bugs.map((b) => (
          <div key={b.id} className="bg-muted/25 p-3">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${priorityColor[b.priority || "P3"]}`}>{b.priority || "P3"}</span>
              <span className="font-medium text-sm flex-1">{b.title}</span>
              {b.auto_generated && <span className="text-xs text-neutral-400">auto</span>}
            </div>
            {b.description && <p className="text-xs text-neutral-500 mt-1">{b.description}</p>}
            <div
              className="mt-2 flex flex-wrap gap-1"
              role="group"
              aria-label={`Status for ${b.title}`}
              aria-busy={savingBugId === b.id}
            >
              {statusOptions.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  onClick={() => updateStatus(b.id, option.value)}
                  disabled={savingBugId !== null}
                  aria-pressed={b.status === option.value}
                  className={`min-h-6 px-2 text-xs font-medium transition-colors disabled:cursor-wait disabled:opacity-50 ${b.status === option.value ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            {savingBugId === b.id && <p className="mt-2 text-xs text-muted-foreground" role="status">Saving status…</p>}
            {statusFeedback[b.id] && (
              <p
                className={`mt-2 text-xs ${statusFeedback[b.id].kind === "error" ? "text-destructive" : "text-muted-foreground"}`}
                role={statusFeedback[b.id].kind === "error" ? "alert" : "status"}
              >
                {statusFeedback[b.id].message}
              </p>
            )}
          </div>
        ))}
        {!bugs.length && (
          <p className="flex items-center gap-2 text-sm text-neutral-400">
            <CheckCircle2 className="h-4 w-4" />
            No open bugs.
          </p>
        )}
      </div>
    </div>
  );
}
