"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleDot, Pause, Play, PlugZap, RefreshCw } from "lucide-react";

import SpotifyIdentityReview from "./SpotifyIdentityReview";
import { Button } from "@/components/ui/button";
type Provider = {
  id: string;
  key: string;
  name: string;
  category: string;
  capabilities: string[];
  auth_type: string;
  status: string;
};

type Connection = {
  id: string;
  provider_id: string;
  provider_key: string;
  provider_name: string;
  provider_category: string;
  label: string;
  status: "connected" | "needs_attention" | "paused" | "revoked";
  last_checked_at: string | Date | null;
  last_successful_sync_at: string | Date | null;
};

type SyncJob = {
  id: string;
  connection_id: string;
  provider_key: string;
  job_type: string;
  status: "queued" | "running" | "succeeded" | "failed" | "partial" | "cancelled";
  records_seen: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  error_summary: string | null;
  created_at: string | Date;
  finished_at: string | Date | null;
};

type IntegrationError = {
  id: string;
  connection_id: string;
  severity: "info" | "warning" | "error" | "critical";
  code: string | null;
  message: string;
  created_at: string | Date;
};

export type IntegrationsWorkspaceData = {
  providers: Provider[];
  connections: Connection[];
  syncJobs: SyncJob[];
  errors: IntegrationError[];
};

export default function IntegrationsWorkspace({ initialData, spotifyIdentityEnabled = false }: { initialData: IntegrationsWorkspaceData; spotifyIdentityEnabled?: boolean }) {
  const [data, setData] = useState(initialData);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providerByKey = useMemo(
    () => new Map(data.providers.map((provider) => [provider.key, provider])),
    [data.providers],
  );
  const connectedCount = data.connections.filter((connection) => connection.status === "connected").length;
  const attentionCount = data.connections.filter((connection) => connection.status === "needs_attention").length;
  const activeJobCount = data.syncJobs.filter((job) => job.status === "queued" || job.status === "running").length;

  async function refresh() {
    const response = await fetch("/api/integrations");
    if (!response.ok) throw new Error(await readError(response, "Could not refresh integrations"));
    setData(await response.json() as IntegrationsWorkspaceData);
  }

  async function syncNow(connectionId: string) {
    setBusy(`sync:${connectionId}`);
    setError(null);
    try {
      const response = await fetch("/api/integrations/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connection_id: connectionId }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not queue sync"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not queue sync");
    } finally {
      setBusy(null);
    }
  }

  async function setConnectionStatus(connection: Connection, status: "connected" | "paused") {
    setBusy(`status:${connection.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/connections/${encodeURIComponent(connection.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await readError(response, "Could not update connection"));
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update connection");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Operations</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Integration console</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Inspect connected providers, queue a bounded sync, and pause a connection without exposing credentials or raw payloads.
          </p>
        </div>
        <Button type="button" onClick={() => void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not refresh integrations"))} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent" disabled={busy !== null}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </header>

      {error && <p className="border border-red-500/40 bg-red-500/10 p-3 text-sm" role="alert">{error}</p>}

      <section aria-label="Integration health summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Summary label="Providers" value={String(data.providers.length)} icon={<PlugZap className="size-4" />} />
        <Summary label="Connected" value={String(connectedCount)} icon={<CheckCircle2 className="size-4" />} />
        <Summary label="Needs attention" value={String(attentionCount)} icon={<AlertCircle className="size-4" />} />
        <Summary label="Active sync jobs" value={String(activeJobCount)} icon={<CircleDot className="size-4" />} />
      </section>

      <section aria-labelledby="integration-providers-heading" className="space-y-3">
        <div>
          <h2 id="integration-providers-heading" className="text-xl font-semibold">Providers</h2>
          <p className="mt-1 text-sm text-muted-foreground">Provider capability and lifecycle state. Connection credentials remain outside this view.</p>
        </div>
        {data.providers.length === 0 ? <Empty message="No integration providers are configured for this workspace." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.providers.map((provider) => (
              <article key={provider.id} className="border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><h3 className="font-medium">{provider.name}</h3><p className="mt-1 text-xs text-muted-foreground">{provider.category} · {provider.auth_type.replaceAll("_", " ")}</p></div>
                  <StatusBadge value={provider.status} />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{provider.capabilities.length ? provider.capabilities.join(" · ") : "No capabilities recorded"}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="integration-connections-heading" className="space-y-3">
        <div>
          <h2 id="integration-connections-heading" className="text-xl font-semibold">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sync actions create durable, tenant-scoped jobs and remain auditable.</p>
        </div>
        {data.connections.length === 0 ? <Empty message="No connected accounts yet." /> : (
          <div className="space-y-3">
            {data.connections.map((connection) => (
              <article key={connection.id} className="border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{connection.label}</h3><StatusBadge value={connection.status} /></div>
                    <p className="mt-1 text-sm text-muted-foreground">{connection.provider_name} · {connection.provider_key}</p>
                    <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <Fact label="Last checked" value={formatDate(connection.last_checked_at)} />
                      <Fact label="Last successful sync" value={formatDate(connection.last_successful_sync_at)} />
                    </dl>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => void syncNow(connection.id)} disabled={busy !== null || connection.status === "paused" || connection.status === "revoked"} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"><RefreshCw className="size-4" /> Sync now</Button>
                    {connection.status === "paused" ? (
                      <Button type="button" onClick={() => void setConnectionStatus(connection, "connected")} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"><Play className="size-4" /> Resume</Button>
                    ) : (
                      <Button type="button" onClick={() => void setConnectionStatus(connection, "paused")} disabled={busy !== null || connection.status === "revoked"} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"><Pause className="size-4" /> Pause</Button>
                    )}
                  </div>
                </div>
                {spotifyIdentityEnabled && connection.provider_key === "spotify" && connection.status === "connected" && <SpotifyIdentityReview connectionId={connection.id} />}
                {providerByKey.get(connection.provider_key)?.status === "deprecated" && <p className="mt-3 border border-amber-500/40 bg-amber-500/10 p-2 text-xs" role="status">This provider is deprecated; do not create new connections.</p>}
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="integration-sync-heading" className="space-y-3">
        <div><h2 id="integration-sync-heading" className="text-xl font-semibold">Recent sync jobs</h2><p className="mt-1 text-sm text-muted-foreground">Queue state and bounded record counts, not provider payloads.</p></div>
        {data.syncJobs.length === 0 ? <Empty message="No sync jobs have been queued." /> : <div className="overflow-x-auto border border-border"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border text-muted-foreground"><th className="p-3">Provider</th><th>Type</th><th>Status</th><th>Records</th><th>Created</th></tr></thead><tbody>{data.syncJobs.map((job) => <tr key={job.id} className="border-b border-border"><td className="p-3">{providerByKey.get(job.provider_key)?.name ?? job.provider_key}</td><td>{job.job_type.replaceAll("_", " ")}</td><td><StatusBadge value={job.status} /></td><td>{job.records_seen} seen · {job.records_created} created · {job.records_updated} updated · {job.records_failed} failed</td><td>{formatDate(job.created_at)}</td></tr>)}</tbody></table></div>}
      </section>

      <section aria-labelledby="integration-errors-heading" className="space-y-3">
        <div><h2 id="integration-errors-heading" className="text-xl font-semibold">Recent integration errors</h2><p className="mt-1 text-sm text-muted-foreground">Unresolved errors remain visible for operator follow-up.</p></div>
        {data.errors.length === 0 ? <Empty message="No unresolved integration errors." /> : <div className="space-y-2">{data.errors.map((item) => <article key={item.id} className="flex flex-wrap items-start justify-between gap-3 border border-border p-3"><div><p className="font-medium">{item.message}</p><p className="mt-1 text-xs text-muted-foreground">{item.code ?? "Unclassified"} · connection {item.connection_id}</p></div><div className="flex items-center gap-2 text-xs"><StatusBadge value={item.severity} /> <span className="text-muted-foreground">{formatDate(item.created_at)}</span></div></article>)}</div>}
      </section>
    </div>
  );
}

function Summary({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return <div className="border border-border p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs uppercase tracking-[0.14em]">{label}</span>{icon}</div><p className="mt-2 text-2xl font-semibold">{value}</p></div>;
}

function Empty({ message }: { message: string }) { return <p className="border border-border p-4 text-sm text-muted-foreground" role="status">{message}</p>; }
function Fact({ label, value }: { label: string; value: string }) { return <div><dt>{label}</dt><dd className="mt-0.5 text-foreground">{value}</dd></div>; }
function StatusBadge({ value }: { value: string }) { return <span className="rounded-full border border-border px-2 py-1 text-xs capitalize">{value.replaceAll("_", " ")}</span>; }
function formatDate(value: string | Date | null) { return value ? new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "Never"; }
async function readError(response: Response, fallback: string) { return (await response.json().catch(() => ({})) as { error?: string }).error ?? fallback; }
