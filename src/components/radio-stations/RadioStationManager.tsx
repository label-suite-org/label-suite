"use client";

import { useState, useMemo } from "react";
import { AlertTriangle, Globe, Mail, Phone } from "lucide-react";
import { RadioStationForm, type RadioStation } from "./RadioStationForm";
import { EmailComposer } from "./EmailComposer";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
const TIER_ORDER = ["nacc", "jbe", "mediabase", "submodern", "spinning", "priority", "untiered"];

const TIER_LABELS: Record<string, string> = {
  nacc: "NACC / college radio",
  jbe: "JBE",
  mediabase: "Mediabase",
  submodern: "SubModern",
  spinning: "Spinning / active",
  priority: "Manual priority A–D",
  untiered: "Untagged",
};

const TIER_BG = "bg-muted text-muted-foreground border border-border";

function tierGroup(tier?: string | null) {
  const raw = (tier || "").trim();
  const value = raw.toLowerCase();
  if (!value) return "untiered";
  if (value.includes("nacc")) return "nacc";
  if (value.includes("jbe")) return "jbe";
  if (value.includes("mediabase")) return "mediabase";
  if (value.includes("submodern")) return "submodern";
  if (value.includes("spinning")) return "spinning";
  if (["a", "b", "c", "d"].includes(value)) return "priority";
  return "untiered";
}

export function RadioStationManager({
  initialStations,
  emailTemplates = [],
  campaigns = [],
  canMutate = true,
}: {
  initialStations: RadioStation[];
  emailTemplates?: {
    id: string;
    name: string;
    subject: string;
    body: string;
    description?: string | null;
  }[];
  campaigns?: { id: string; campaign_name: string; artist_name?: string | null; release_title?: string | null }[];
  canMutate?: boolean;
}) {
  const [stations, setStations] = useState<RadioStation[]>(initialStations);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showEmailComposer, setShowEmailComposer] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return stations;
    const q = search.toLowerCase();
    return stations.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.city || "").toLowerCase().includes(q) ||
        (s.call_sign || "").toLowerCase().includes(q) ||
        (s.dj_name || "").toLowerCase().includes(q) ||
        (s.tier || "").toLowerCase().includes(q),
    );
  }, [stations, search]);

  const grouped = useMemo(() => {
    const map: Record<string, RadioStation[]> = {};
    for (const s of filtered) {
      const tier = tierGroup(s.tier);
      if (!map[tier]) map[tier] = [];
      map[tier].push(s);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => a.name.localeCompare(b.name));
    }
    return map;
  }, [filtered]);

  const tierKeys = useMemo(() => {
    return TIER_ORDER.filter((k) => grouped[k]?.length);
  }, [grouped]);

  const completeness = useMemo(() => {
    const withEmail = stations.filter((s) => Boolean(s.email)).length;
    const withDj = stations.filter((s) => Boolean(s.dj_name)).length;
    const usCount = stations.filter((s) => (s.country || "").toLowerCase().includes("united") || (s.country || "").toLowerCase() === "us" || (s.country || "").toLowerCase() === "usa").length;
    return { withEmail, missingEmail: stations.length - withEmail, withDj, usCount };
  }, [stations]);

  const allFilteredIds = useMemo(() => new Set(filtered.map((s) => s.id)), [filtered]);

  const allSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));
  const selectedCount = useMemo(() => {
    let count = 0;
    for (const id of selectedIds) {
      if (allFilteredIds.has(id)) count++;
    }
    return count;
  }, [selectedIds, allFilteredIds]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(filtered.map((s) => s.id)));
  }

  function deselectAll() {
    setSelectedIds(new Set());
  }

  const selectedStations = useMemo(() => {
    return stations.filter((s) => selectedIds.has(s.id));
  }, [stations, selectedIds]);

  async function deleteStation(id: string) {
    if (!confirm("Delete this radio station?")) return;
    try {
      const res = await fetch("/api/radio-stations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete");
      }
      setStations((prev) => prev.filter((s) => s.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (err: any) {
      alert(err.message);
    }
  }

  const editing = stations.find((s) => s.id === editingId);

  return (
    <div className="space-y-6">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
            />
          </svg>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, city, call sign, or DJ…"
            className="w-full pl-9 pr-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>

        {/* Select all / Deselect all */}
        {canMutate && filtered.length > 0 && (
          <div className="flex items-center gap-1">
            <Button variant="ghost"
              onClick={allSelected ? deselectAll : selectAll}
              className="px-3 py-2 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </Button>
          </div>
        )}

        {/* Preview remains available at every release-gate width; the action still requires explicit send confirmation. */}
        {canMutate && selectedCount > 0 && (
          <Button
            onClick={() => setShowEmailComposer(true)}
            className="inline-flex px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 shrink-0"
          >
            Send Email ({selectedCount})
          </Button>
        )}

        {canMutate && <Button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 shrink-0"
        >
          + Add Station
        </Button>}
      </div>

      {stations.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Stations" value={stations.length} />
          <KpiCard label="With email" value={completeness.withEmail} />
          <KpiCard label="Missing email" value={completeness.missingEmail} tone={completeness.missingEmail > 0 ? "amber" : "default"} />
          <KpiCard label="DJ/contact" value={completeness.withDj} />
          <KpiCard label="US stations" value={completeness.usCount} />
        </div>
      )}

      {!stations.length && !creating ? (
        <div className="p-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <p className="text-lg">No radio stations yet.</p>
          {canMutate && <Button
            onClick={() => setCreating(true)}
            className="mt-3 text-sm text-primary hover:underline"
          >
            Add your first station
          </Button>}
        </div>
      ) : (
        <>
          {/* Summary */}
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {stations.length} station
            {stations.length === 1 ? "" : "s"}
            {search.trim() ? " match your search" : ""}
            {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
          </p>

          {/* Tier groups */}
          {tierKeys.map((tier) => (
            <section key={tier} className="space-y-2">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                {TIER_LABELS[tier] ?? tier}
                <span className="text-xs text-muted-foreground font-normal">
                  {grouped[tier].length}
                </span>
              </h2>
              <div className="bg-card border border-border rounded-xl divide-y divide-border">
                {grouped[tier].map((s) => {
                  const isSelected = selectedIds.has(s.id);
                  const hasEmail = !!s.email;
                  return (
                    <div
                      key={s.id}
                      className={`flex items-start justify-between gap-3 p-4 ${
                        isSelected
                          ? "bg-primary/5 dark:bg-primary/10"
                          : ""
                      }`}
                    >
                      {/* Checkbox + content */}
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {canMutate && <Input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(s.id)}
                          className="mt-1 w-4 h-4 rounded border-input text-primary focus:ring-2 focus:ring-ring cursor-pointer shrink-0"
                        />}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium text-sm">{s.name}</p>
                            {s.tier && (
                              <span
                                className={`text-xs px-1.5 py-0.5 rounded font-medium ${TIER_BG}`}
                              >
                                {s.tier}
                              </span>
                            )}
                            {!hasEmail && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium">
                                <AlertTriangle className="h-3 w-3" />
                                no email
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {[s.city, s.state, s.country].filter(Boolean).join(", ")}
                            {s.frequency ? ` · ${s.frequency}` : ""}
                            {s.call_sign ? ` · ${s.call_sign}` : ""}
                          </p>
                          {(s.email || s.phone || s.website) && (
                            <div className="flex flex-wrap items-center gap-2 mt-1.5">
                              {s.email && (
                                <a
                                  href={`mailto:${s.email}`}
                                  className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <Mail className="w-3 h-3" />
                                  {s.email}
                                </a>
                              )}
                              {s.phone && (
                                <a
                                  href={`tel:${s.phone}`}
                                  className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <Phone className="w-3 h-3" />
                                  {s.phone}
                                </a>
                              )}
                              {s.website && (
                                <a
                                  href={s.website}
                                  target="_blank"
                                  rel="noopener"
                                  className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                                >
                                  <Globe className="w-3 h-3" />
                                  Website
                                </a>
                              )}
                            </div>
                          )}
                          {s.dj_name && (
                            <p className="text-xs text-muted-foreground mt-1">
                              DJ: {s.dj_name}
                            </p>
                          )}
                          {s.notes && (
                            <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-2">
                              {s.notes}
                            </p>
                          )}
                        </div>
                      </div>
                      {canMutate && <div className="flex gap-1 shrink-0 pt-0.5">
                        <Button
                          onClick={() => setEditingId(s.id!)}
                          className="px-2.5 py-1 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground transition-colors"
                        >
                          Edit
                        </Button>
                        <Button
                          onClick={() => deleteStation(s.id!)}
                          className="px-2.5 py-1 text-xs rounded-md bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-400 transition-colors"
                        >
                          Delete
                        </Button>
                      </div>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {/* Create modal */}
      {canMutate && creating && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setCreating(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Add Radio Station</h2>
            <RadioStationForm onClose={() => setCreating(false)} />
          </div>
        </div>
      )}

      {/* Edit modal */}
      {canMutate && editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setEditingId(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold mb-4">Edit Radio Station</h2>
            <RadioStationForm initial={editing} onClose={() => setEditingId(null)} />
          </div>
        </div>
      )}

      {/* Email composer modal */}
      {canMutate && showEmailComposer && selectedStations.length > 0 && (
        <EmailComposer
          selectedStations={selectedStations}
          templates={emailTemplates}
          campaigns={campaigns}
          onClose={() => setShowEmailComposer(false)}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "amber" }) {
  return (
    <div className={`rounded-xl border p-3 ${tone === "amber" ? "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20" : "border-border bg-card"}`}>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
