"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { isImageAsset, resolveFileUrl } from "../../lib/storage-client";
import { MediaAssetForm, type MediaAssetRecord } from "./MediaAssetForm";
import { getResourceAttention, matchesResourceAttentionFilter, type ResourceAttentionFilter } from "../resource-attention";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/external-url";
const APPROVAL_STYLES: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  changes_requested: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

const DELIVERY_STYLES: Record<string, string> = {
  delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  sent: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  queued: "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300",
  not_sent: "bg-muted text-muted-foreground",
};

function StatusBadge({ value, styles }: { value?: string | null; styles: Record<string, string> }) {
  if (!value) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${styles[value] || "bg-muted text-muted-foreground"}`}>{value.replace(/_/g, " ")}</span>;
}

function ImagePreview({ asset }: { asset: MediaAssetRecord }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!asset.file_link || !isImageAsset(asset.asset_type, asset.file_link)) return;
    resolveFileUrl(asset.file_link, 96).then((nextUrl) => {
      if (!cancelled) setUrl(nextUrl);
    }).catch(() => {
      if (!cancelled) setUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.asset_type, asset.file_link]);

  if (!asset.file_link) {
    return <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">No file</div>;
  }

  if (!isImageAsset(asset.asset_type, asset.file_link)) {
    return <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground px-2 text-center">{asset.asset_type?.replace(/_/g, " ") || "file"}</div>;
  }

  if (!url) {
    return <div className="h-16 w-16 rounded-lg bg-muted animate-pulse" />;
  }

  return <img src={url} alt={asset.asset_name} width={96} height={96} loading="lazy" decoding="async" className="h-16 w-16 rounded-lg object-cover bg-muted" />;
}

function useEscapeToClose(active: boolean, close: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);
}

export function MediaAssetManager({
  initialAssets,
  artists,
  releases,
  projects,
  canMutate = true,
}: {
  initialAssets: MediaAssetRecord[];
  artists: Array<{ id: string; name: string }>;
  releases: Array<{ id: string; title: string }>;
  projects?: Array<{ id: string; name: string }>;
  canMutate?: boolean;
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterAttention, setFilterAttention] = useState<ResourceAttentionFilter>("all");
  const projectOptions = projects ?? [];

  const attentionFor = (asset: MediaAssetRecord) => getResourceAttention({
    hasOwner: Boolean(asset.linked_artist_id || asset.linked_release_id || asset.project_id),
    fileLink: asset.file_link,
    reviewed: Boolean(asset.approval_status && asset.approval_status !== "pending"),
  });

  const types = useMemo(() => ["all", ...Array.from(new Set(assets.map((asset) => asset.asset_type).filter(Boolean) as string[])).sort()], [assets]);

  const filtered = useMemo(() => {
    let result = assets;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((asset) =>
        asset.asset_name.toLowerCase().includes(q)
        || (asset.artist_name || "").toLowerCase().includes(q)
        || (asset.release_title || "").toLowerCase().includes(q)
        || (asset.version || "").toLowerCase().includes(q)
      );
    }
    if (filterType !== "all") {
      result = result.filter((asset) => asset.asset_type === filterType);
    }
    if (filterAttention !== "all") {
      result = result.filter((asset) => {
        const attention = attentionFor(asset);
        return matchesResourceAttentionFilter(attention, filterAttention);
      });
    }
    return result;
  }, [assets, filterAttention, search, filterType]);

  const grouped = useMemo(() => {
    const map = new Map<string, MediaAssetRecord[]>();
    for (const asset of filtered) {
      const key = asset.asset_type || "other";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(asset);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  async function deleteAsset(id: string) {
    if (!confirm("Delete this media asset?")) return;
    try {
      const res = await fetch("/api/media-assets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      setAssets((prev) => prev.filter((asset) => asset.id !== id));
    } catch (err: any) {
      alert(err.message || "Delete failed");
    }
  }

  async function openFile(fileLink?: string | null) {
    if (!fileLink) return;
    try {
      const url = await resolveFileUrl(fileLink);
      openExternalUrl(url);
    } catch (err: any) {
      alert(err.message || "Could not open file");
    }
  }

  const editing = assets.find((asset) => asset.id === editingId) || null;

  useEscapeToClose(creating || !!editing, () => {
    setCreating(false);
    setEditingId(null);
  });

  return (
    <div className="space-y-6">
      {!canMutate && <p className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">Read-only for fundraiser</p>}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search assets, artists, releases..."
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
          />
        </div>
        <NativeSelect
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background"
        >
          {types.map((type) => (
            <option key={type} value={type}>{type === "all" ? "All types" : type.replace(/_/g, " ")}</option>
          ))}
        </NativeSelect>
        <NativeSelect value={filterAttention} onChange={(e) => setFilterAttention(e.target.value as ResourceAttentionFilter)} aria-label="Ownership and evidence state" className="px-3 py-2 border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring bg-background">
          <option value="all">All ownership states</option>
          <option value="needs_attention">Needs attention</option>
          <option value="orphaned">No owner</option>
          <option value="missing">Missing file</option>
          <option value="unreviewed">Unreviewed</option>
        </NativeSelect>
        {canMutate && <Button
          onClick={() => setCreating(true)}
          className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:opacity-90 shrink-0"
        >
          + Add asset
        </Button>}
      </div>

      <p className="text-sm text-muted-foreground">
        {filtered.length} of {assets.length} asset{assets.length === 1 ? "" : "s"}
        {filterType !== "all" || search.trim() ? " match your filters" : " in the library"}
      </p>

      {!assets.length && !creating ? (
        <div className="p-12 text-center text-muted-foreground border-2 border-dashed border-border rounded-xl">
          <p className="text-lg">No media assets yet.</p>
          <p className="text-sm mt-1">Upload cover art, press photos, video files, and social assets.</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="p-8 text-center text-muted-foreground border border-border rounded-xl">No assets match your filters.</div>
      ) : (
        grouped.map(([type, rows]) => (
          <section key={type} className="space-y-2">
            <div className="flex items-center gap-2 px-1">
              <h2 className="text-base font-semibold capitalize tracking-tight">{type.replace(/_/g, " ")}</h2>
              <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{rows.length}</span>
            </div>
            <div className="bg-card border border-border rounded-xl divide-y divide-border">
              {rows.map((asset) => (
                <div key={asset.id} className="p-4 flex items-start gap-4">
                  <ImagePreview asset={asset} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{asset.asset_name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {[asset.artist_name && `Artist: ${asset.artist_name}`, asset.release_title && `Release: ${asset.release_title}`, asset.project_name && `Project: ${asset.project_name}`, asset.version].filter(Boolean).join(" · ") || "No owner"}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end shrink-0">
                        <StatusBadge value={asset.approval_status} styles={APPROVAL_STYLES} />
                        <StatusBadge value={asset.delivery_status} styles={DELIVERY_STYLES} />
                      </div>
                    </div>
                    {asset.notes && <p className="text-sm text-muted-foreground line-clamp-2">{asset.notes}</p>}
                    <div className="flex flex-wrap gap-1.5">
                      {attentionFor(asset).orphaned && <span className="rounded-full bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">No owner</span>}
                      {attentionFor(asset).missing && <span className="rounded-full bg-orange-100 px-2 py-1 text-xs text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">Missing file</span>}
                      {attentionFor(asset).unreviewed && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Unreviewed</span>}
                    </div>
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      {asset.file_link && (
                        <Button onClick={() => openFile(asset.file_link)} className="text-xs px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80">
                          Open file
                        </Button>
                      )}
                      {canMutate && <Button onClick={() => setEditingId(asset.id)} className="text-xs px-2.5 py-1 rounded-md bg-muted hover:bg-muted/80">
                        {attentionFor(asset).orphaned ? "Repair ownership" : "Edit"}
                      </Button>}
                      {canMutate && <Button onClick={() => deleteAsset(asset.id)} className="text-xs px-2.5 py-1 rounded-md bg-red-50 hover:bg-red-100 text-red-700 dark:bg-red-900/20 dark:hover:bg-red-900/30 dark:text-red-400">
                        Delete
                      </Button>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {canMutate && creating && (
        <ModalShell title="Add media asset" onClose={() => setCreating(false)}>
          <MediaAssetForm artists={artists} releases={releases} projects={projectOptions} onClose={() => setCreating(false)} />
        </ModalShell>
      )}

      {canMutate && editing && (
        <ModalShell title="Edit media asset" onClose={() => setEditingId(null)}>
          <div className="space-y-4">
            <AssetPreview asset={editing} />
            <MediaAssetForm initial={editing} artists={artists} releases={releases} projects={projectOptions} onClose={() => setEditingId(null)} />
          </div>
        </ModalShell>
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="bg-card rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border sticky top-0 bg-card">
          <h2 className="text-xl font-bold">{title}</h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground text-2xl leading-none w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted">
            ×
          </Button>
        </div>
        <div className="p-6 pt-4">
          {children}
        </div>
      </div>
    </div>
  );
}

function AssetPreview({ asset }: { asset: MediaAssetRecord }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!asset.file_link || !isImageAsset(asset.asset_type, asset.file_link)) return;
    resolveFileUrl(asset.file_link, 96).then((nextUrl) => {
      if (!cancelled) setUrl(nextUrl);
    }).catch(() => {
      if (!cancelled) setUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [asset.asset_type, asset.file_link]);

  if (!url) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
        <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center text-[10px] text-muted-foreground">
          {asset.file_link ? (isImageAsset(asset.asset_type, asset.file_link) ? "…" : <FileText className="h-4 w-4" />) : "No file"}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{asset.asset_name}</p>
          <p className="text-xs text-muted-foreground">
            {asset.file_link ? (isImageAsset(asset.asset_type, asset.file_link) ? "Image preview" : asset.asset_type || "File") : "No file attached"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
      <img src={url} alt={asset.asset_name} width={96} height={96} loading="lazy" decoding="async" className="h-12 w-12 rounded-lg object-cover" />
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">Current preview</p>
        <p className="text-xs text-muted-foreground truncate">{asset.asset_name}</p>
      </div>
    </div>
  );
}
