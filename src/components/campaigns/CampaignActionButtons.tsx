"use client";

import { useState } from "react";
import { CampaignForm, type Campaign } from "./CampaignForm";

import { Button } from "@/components/ui/button";
export function CampaignEditButton({
  campaign,
  releases,
  artists,
}: {
  campaign: Campaign;
  releases: Array<{ id: string; title: string }>;
  artists: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="px-2.5 py-1 text-xs font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
        aria-label={`Edit ${campaign.campaign_name}`}
      >
        Edit
      </Button>
      {open && (
        <EditDialog campaign={campaign} releases={releases} artists={artists} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function EditDialog({
  campaign,
  releases,
  artists,
  onClose,
}: {
  campaign: Campaign;
  releases: Array<{ id: string; title: string }>;
  artists: Array<{ id: string; name: string }>;
  onClose: () => void;
}) {
  const [aiDecisionPending, setAiDecisionPending] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { if (!aiDecisionPending) onClose(); }}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold mb-4">Edit Campaign</h2>
        <CampaignForm initial={campaign} releases={releases} artists={artists} onClose={onClose} onAiDecisionPending={setAiDecisionPending} />
      </div>
    </div>
  );
}

export function CampaignDeleteButton({ campaign }: { campaign: Campaign }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: campaign.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Delete failed");
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }

  if (!confirming) {
    return (
      <Button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true); }}
        className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-destructive/20"
        aria-label={`Delete ${campaign.campaign_name}`}
      >
        Delete
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => !loading && setConfirming(false)}>
      <div className="bg-card rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold mb-2">Delete {campaign.campaign_name}?</h2>
        <p className="text-sm text-muted-foreground mb-2">
          This deletes the campaign and its linked station placements. This action cannot be undone.
        </p>
        {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
        <div className="flex gap-2 justify-end">
          <Button onClick={() => setConfirming(false)} disabled={loading} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground">Cancel</Button>
          <Button variant="ghost" onClick={onDelete} disabled={loading}
            className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50">
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
