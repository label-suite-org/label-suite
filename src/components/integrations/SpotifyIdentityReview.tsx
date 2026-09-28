import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SpotifyIdentityInput, SpotifyIdentityProposal } from "../../server/spotify-identity-core";

type Proposal = SpotifyIdentityProposal & { input: SpotifyIdentityInput };

export default function SpotifyIdentityReview({ connectionId }: { connectionId: string }) {
  const [url, setUrl] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function lookup() {
    setBusy(true); setError(null); setProposal(null); setTarget(""); setConfirmed(false);
    try {
      const response = await fetch("/api/integrations/spotify/identity/propose", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ spotify_url: url }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not look up Spotify link");
      setProposal(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not look up Spotify link");
    } finally { setBusy(false); }
  }

  async function confirm() {
    const candidate = proposal?.candidates.find(item => item.object_id === target);
    if (!proposal || !candidate || !proposal.match_method) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/integrations/spotify/identity/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connection_id: connectionId, object_type: proposal.input.object_type,
          external_id: proposal.input.external_id, external_url: proposal.input.external_url,
          label_suite_object_type: candidate.object_type === "album" ? "release" : candidate.object_type,
          label_suite_object_id: candidate.object_id, match_method: proposal.match_method,
          match_confidence: candidate.score,
        }),
      });
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Could not confirm Spotify match");
      }
      setConfirmed(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm Spotify match");
    } finally { setBusy(false); }
  }

  return <section aria-label="Spotify catalog matching" className="mt-4 space-y-3 border-t border-border pt-4">
    <h4 className="font-medium">Match a Spotify link</h4>
    <p className="text-sm text-muted-foreground">Look up an artist, album or track, then choose its catalog match. Your catalog details stay unchanged.</p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void lookup(); }}>
      <label className="min-w-0 flex-1 text-sm">Spotify URL or URI
        <input className="mt-1 block w-full rounded-md border border-border bg-background p-2" required value={url} disabled={busy} maxLength={2048}
          onChange={event => { setUrl(event.target.value); setProposal(null); setTarget(""); setConfirmed(false); }} />
      </label>
      <Button type="submit" disabled={busy || !url.trim()}>Look up link</Button>
    </form>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {proposal && <div className="space-y-2">
      <p className="break-words text-sm">Spotify {proposal.input.object_type}: <strong>{proposal.input.name}</strong>{proposal.input.artist_name && ` · ${proposal.input.artist_name}`}</p>
      {proposal.candidates.length === 0 ? <p role="status" className="text-sm">No matching catalog item found. Check the catalog details before trying again.</p> : <>
        <label className="block text-sm">Catalog match
          <select className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={target} disabled={busy || confirmed} onChange={event => setTarget(event.target.value)}>
            <option value="">Choose a match to review</option>
            {proposal.candidates.map(item => <option key={item.object_id} value={item.object_id}>{item.title}{item.artist_name ? ` · ${item.artist_name}` : ""} ({item.object_id})</option>)}
          </select>
        </label>
        <Button type="button" disabled={busy || confirmed || !target || !proposal.match_method} onClick={() => void confirm()}>Confirm match</Button>
      </>}
    </div>}
    {confirmed && <p role="status" className="text-sm">Spotify match saved.</p>}
  </section>;
}
