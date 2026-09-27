"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import type { RadioStation } from "../radio-stations/RadioStationForm";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
const STATUSES = [
  "selected",
  "drafted",
  "sent",
  "follow_up_due",
  "replied",
  "added",
  "spun",
  "declined",
  "no_response",
  "bounced",
  "wrong_contact",
] as const;

const PRIORITIES = ["high", "medium", "low"] as const;

const STATUS_META: Record<string, { label: string; className: string }> = {
  selected: { label: "Selected", className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  drafted: { label: "Drafted", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  sent: { label: "Sent", className: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" },
  follow_up_due: { label: "Follow-up due", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  replied: { label: "Replied", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  added: { label: "Added", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  spun: { label: "Spun", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" },
  declined: { label: "Declined", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  no_response: { label: "No response", className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  bounced: { label: "Bounced", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
  wrong_contact: { label: "Wrong contact", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300" },
};

interface CampaignSummary {
  id: string;
  campaign_name: string;
  campaign_type: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  main_platform: string | null;
  release_title: string | null;
  artist_name: string | null;
  target_count: number;
  with_email_count: number;
  sent_count: number;
  follow_up_due_count: number;
}

interface ReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
}

interface CampaignStation extends RadioStation {
  campaign_id: string | null;
  station_id: string | null;
  status: string | null;
  last_contacted_at: string | Date | null;
  follow_up_at: string | Date | null;
  feedback: string | null;
  priority: string | null;
  pitch_angle: string | null;
  updated_at: string | Date | null;
}

interface CurrentCampaign extends CampaignSummary {
  owner: string | null;
  goal: string | null;
  notes: string | null;
  kpi_summary: string | null;
  linked_release_id: string | null;
  linked_artist_id: string | null;
  release_date: string | null;
  release_status: string | null;
  readiness: ReadinessItem[];
  stations: CampaignStation[];
  status_counts: Record<string, number>;
}

export function RadioPluggingCockpit({
  campaigns,
  current,
  allStations,
  canMutate = true,
  embedded = false,
}: {
  campaigns: CampaignSummary[];
  current: CurrentCampaign | null;
  allStations: RadioStation[];
  canMutate?: boolean;
  embedded?: boolean;
}) {
  const [stationSearch, setStationSearch] = useState("");
  const [stationId, setStationId] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const linkedStationIds = useMemo(() => new Set(current?.stations.map((s) => s.station_id) ?? []), [current]);
  const availableStations = useMemo(() => {
    const q = stationSearch.trim().toLowerCase();
    return allStations
      .filter((station) => !linkedStationIds.has(station.id))
      .filter((station) => {
        if (!q) return true;
        return [station.name, station.call_sign, station.city, station.tier, station.dj_name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q);
      })
      .slice(0, 80);
  }, [allStations, linkedStationIds, stationSearch]);

  async function addStation() {
    if (!current || !stationId) return;
    setAdding(true);
    try {
      const res = await fetch("/api/campaign-stations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: current.id, station_id: stationId, status: "selected", priority: "medium" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add station");
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setAdding(false);
    }
  }

  async function updateStation(id: string, patch: Record<string, string | null>) {
    setSavingId(id);
    try {
      const res = await fetch("/api/campaign-stations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update station");
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingId(null);
    }
  }

  async function removeStation(id: string) {
    if (!confirm("Remove this station from the campaign?")) return;
    setSavingId(id);
    try {
      const res = await fetch("/api/campaign-stations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not remove station");
      window.location.reload();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSavingId(null);
    }
  }

  const readyCount = current?.readiness.filter((item) => item.ready).length ?? 0;
  const emptyState = current ? null : (
    <div className="rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground">
      {embedded ? "No campaign radio context is available yet." : "Select a campaign to build a radio plugging target list."}
    </div>
  );
  const currentView = current ? (
    <>
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {embedded ? "Embedded radio channel" : "Radio plugging cockpit"}
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{current.campaign_name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {[current.artist_name, current.release_title, current.main_platform || current.campaign_type].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {current.start_date || "No start date"}{current.end_date ? ` → ${current.end_date}` : ""} · {current.status || "planning"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/radio-stations" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              Open station directory
            </a>
            {embedded && (
              <a href={`/radio-plugging/${current.id}`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                Open dedicated radio cockpit
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Metric label="Target stations" value={current.target_count} />
        <Metric label="With email" value={current.with_email_count} />
        <Metric label="Sent / outcomes" value={current.sent_count} />
        <Metric label="Follow-up due" value={current.follow_up_due_count} tone={current.follow_up_due_count > 0 ? "amber" : "default"} />
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Radio-ready checklist</h3>
            <p className="text-sm text-muted-foreground">{readyCount}/{current.readiness.length} checks look ready from linked data and campaign notes.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {current.readiness.map((item) => (
            <div key={item.key} className="rounded-lg border border-border p-3">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${item.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {item.ready ? <Check className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                </span>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <h3 className="text-lg font-semibold">Target station pipeline</h3>
            <p className="text-sm text-muted-foreground">Select stations, track pitch status, follow-up date, and feedback.</p>
          </div>
          {canMutate && <div className="grid gap-2 sm:grid-cols-[minmax(12rem,1fr)_minmax(12rem,1fr)_auto] md:w-[34rem]">
            <Input
              value={stationSearch}
              onChange={(e) => setStationSearch(e.target.value)}
              placeholder="Filter available stations…"
              className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            />
            <NativeSelect value={stationId} onChange={(e) => setStationId(e.target.value)} className="rounded-lg border border-input bg-background px-3 py-2 text-sm">
              <option value="">Add station…</option>
              {availableStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.name}{station.tier ? ` · ${station.tier}` : ""}{station.email ? " · email" : ""}
                </option>
              ))}
            </NativeSelect>
            <Button onClick={addStation} disabled={!stationId || adding} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
              Add
            </Button>
          </div>}
        </div>

        {current.stations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No target stations yet. Add stations above, then use the existing Radio Stations bulk sender with this campaign selected.
          </div>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border">
            {current.stations.map((station) => (
              <div key={station.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(14rem,1.2fr)_10rem_8rem_10rem_minmax(12rem,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-sm">{station.name}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_META[station.status || "selected"]?.className ?? STATUS_META.selected.className}`}>
                      {STATUS_META[station.status || "selected"]?.label ?? station.status}
                    </span>
                    {station.tier && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{station.tier}</span>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[station.call_sign, station.city, station.state, station.country].filter(Boolean).join(" · ") || "No location data"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {station.email ? station.email : "No email"}{station.dj_name ? ` · ${station.dj_name}` : ""}
                  </p>
                </div>

                {canMutate ? <><NativeSelect
                  value={station.status || "selected"}
                  onChange={(e) => updateStation(station.id, { status: e.target.value })}
                  disabled={savingId === station.id}
                  className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
                >
                  {STATUSES.map((status) => <option key={status} value={status}>{STATUS_META[status].label}</option>)}
                </NativeSelect>

                <NativeSelect
                  value={station.priority || "medium"}
                  onChange={(e) => updateStation(station.id, { priority: e.target.value })}
                  disabled={savingId === station.id}
                  className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
                >
                  {PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </NativeSelect>

                <Input
                  type="date"
                  defaultValue={dateValue(station.follow_up_at)}
                  onBlur={(e) => updateStation(station.id, { follow_up_at: e.target.value || null })}
                  disabled={savingId === station.id}
                  className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
                />

                <Input
                  defaultValue={station.pitch_angle || station.feedback || ""}
                  placeholder="Pitch angle / feedback…"
                  onBlur={(e) => updateStation(station.id, { pitch_angle: e.target.value || null })}
                  disabled={savingId === station.id}
                  className="rounded-lg border border-input bg-background px-2 py-2 text-sm"
                />

                <Button
                  onClick={() => removeStation(station.id)}
                  disabled={savingId === station.id}
                  className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Remove
                </Button></> : <span className="text-xs text-muted-foreground">Operator-only controls</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  ) : null;

  return (
    <div className="space-y-6">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      {embedded ? (
        emptyState ?? currentView
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-6">
          <aside className="space-y-3">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Radio campaigns</p>
              <div className="mt-3 space-y-2">
                {campaigns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No radio-relevant campaigns found. Create a Campaign with platform “Radio” or PR/radio wording.</p>
                ) : (
                  campaigns.map((campaign) => (
                    <a
                      key={campaign.id}
                      href={`/radio-plugging/${campaign.id}`}
                      className={`block rounded-lg border p-3 text-sm transition-colors ${current?.id === campaign.id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    >
                      <div className="font-medium leading-snug">{campaign.campaign_name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[campaign.artist_name, campaign.release_title].filter(Boolean).join(" · ") || campaign.campaign_type || "Campaign"}
                      </div>
                      <div className="mt-2 flex gap-2 text-[11px] text-muted-foreground">
                        <span>{campaign.target_count} targets</span>
                        <span>{campaign.sent_count} sent</span>
                        {campaign.follow_up_due_count > 0 && <span className="text-amber-700">{campaign.follow_up_due_count} due</span>}
                      </div>
                    </a>
                  ))
                )}
              </div>
            </div>
          </aside>

          <div className="space-y-6">
            {emptyState ?? currentView}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" }) {
  return (
    <div className={`rounded-xl border p-4 ${tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200" : "border-border bg-card"}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function dateValue(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
