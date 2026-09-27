"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

type QueueHealth = {
  queued: number;
  running: number;
  failed: number;
  expiredLeases: number;
  activeWorkers: number;
  oldestQueuedAt: string | null;
};

type PublicJob = {
  id: string;
  job_type: string;
  trigger: string;
  status: string;
  attempt: number;
  max_attempts: number;
  error: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export function JobQueuePanel() {
  const [health, setHealth] = useState<QueueHealth | null>(null);
  const [jobs, setJobs] = useState<PublicJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [healthResponse, jobsResponse] = await Promise.all([
        fetch("/api/jobs/health"),
        fetch("/api/jobs?limit=10"),
      ]);
      if (!healthResponse.ok || !jobsResponse.ok) throw new Error("Could not load background jobs");
      setHealth(await healthResponse.json());
      const data = await jobsResponse.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load background jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Background jobs</CardTitle>
          <CardDescription>Queue health and operator-safe recent jobs for this workspace.</CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {health && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Workers" value={health.activeWorkers} />
            <Metric label="Queued" value={health.queued} />
            <Metric label="Running" value={health.running} />
            <Metric label="Failed" value={health.failed} />
            <Metric label="Expired leases" value={health.expiredLeases} />
          </div>
        )}
        <div className="divide-y divide-border rounded-md border border-border">
          {jobs.length ? jobs.map((job) => (
            <div key={job.id} className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{job.job_type.replaceAll("_", " ")}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {formatJobDetails(job)}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-[11px] font-medium">{job.status}</span>
            </div>
          )) : (
            <p className="px-3 py-5 text-sm text-muted-foreground">{loading ? "Loading jobs…" : "No background jobs yet."}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function formatJobDetails(job: PublicJob) {
  const summary = formatJobSummary(job);
  return job.error ? `${job.error} · ${summary}` : summary;
}

function formatJobSummary(job: PublicJob) {
  const parts = [`${job.trigger.replaceAll("_", " ")} · attempt ${job.attempt}/${job.max_attempts}`];
  if (job.lease_owner) parts.push(`worker ${job.lease_owner}`);
  if (job.lease_expires_at) parts.push(`lease ${new Date(job.lease_expires_at).toLocaleTimeString()}`);
  parts.push(job.idempotency_key || job.id);
  return parts.join(" · ");
}
