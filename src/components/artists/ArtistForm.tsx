"use client";

import { useId, useState, type SubmitEvent } from "react";
import { deriveCampaignDocument } from "../../lib/campaign-rich-text";
import { normalizeReviewedRichText, type ReviewedRichTextState } from "../../lib/reviewed-rich-text";
import { CampaignRichTextEditor } from "../campaigns/CampaignRichTextEditor";

import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
export interface ContactOption {
  id: string;
  name: string;
}

export interface Artist {
  id: string;
  name: string;
  image_url?: string | null;
  bio?: string | null;
  bio_document?: unknown;
  bio_review_status?: string | null;
  bio_reviewed_hash?: string | null;
  pro?: string | null;
  spotify_id?: string | null;
  spotify_followers?: number | null;
  spotify_popularity?: number | null;
  ipi?: string | null;
  instagram?: string | null;
  tiktok?: string | null;
  relationship?: "roster" | "collaborator" | null;
  contact_id?: string | null;
}

export type ArtistFocusField = "bio" | "pro" | "ipi" | "spotify_id" | "instagram" | "tiktok";

export function ArtistForm({
  initial,
  contactOptions,
  onClose,
  focusField,
}: {
  initial?: Artist | null;
  contactOptions?: ContactOption[];
  onClose: () => void;
  focusField?: ArtistFocusField;
}) {
  const formId = useId();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name || "");
  const [imageUrl, setImageUrl] = useState(initial?.image_url || "");
  const initialBio = normalizeReviewedRichText(initial?.bio_document, initial?.bio, {
    reviewStatus: initial?.bio_review_status === "reviewed" ? "reviewed" : "draft",
    reviewedHash: initial?.bio_reviewed_hash ?? null,
  });
  const [bioDocument, setBioDocument] = useState(initialBio.document);
  const [bio, setBio] = useState(initialBio.plainText);
  const [bioDirty, setBioDirty] = useState(false);
  const [bioState, setBioState] = useState<ReviewedRichTextState>(initialBio.state);
  const [reviewingBio, setReviewingBio] = useState(false);
  const [bioFallback, setBioFallback] = useState(initialBio.usedFallback);
  const [pro, setPro] = useState(initial?.pro || "");
  const [spotifyId, setSpotifyId] = useState(initial?.spotify_id || "");
  const [ipi, setIpi] = useState(initial?.ipi || "");
  const [instagram, setInstagram] = useState(initial?.instagram || "");
  const [tiktok, setTiktok] = useState(initial?.tiktok || "");
  const [relationship, setRelationship] = useState(initial?.relationship || "");
  const [contactId, setContactId] = useState(initial?.contact_id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const safeContactOptions = contactOptions ?? [];

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name,
        image_url: imageUrl || null,
        pro,
        spotify_id: spotifyId,
        ipi,
        instagram,
        tiktok,
        relationship: relationship || null,
        contact_id: contactId || null,
      };
      if (!isEdit || (bioDirty && !bioFallback)) {
        body.bio = bio;
        body.bio_document = bioDocument;
      }
      const res = await fetch("/api/artists", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to ${isEdit ? "update" : "create"} artist`);
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function reviewBio() {
    if (!initial || bioDirty || bioFallback || bioState === "missing") return;
    setReviewingBio(true);
    setError("");
    try {
      const response = await fetch(`/api/artists/${encodeURIComponent(initial.id)}/bio/review`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Failed to review biography");
      }
      setBioState("reviewed");
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review biography");
    } finally {
      setReviewingBio(false);
    }
  }

  function replaceInvalidBio() {
    if (!bioFallback) return;
    setBioFallback(false);
    setBioDirty(true);
    setBioState(bio.trim() ? "draft" : "missing");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 text-left">
      <div>
        <label htmlFor={`${formId}-name`} className="block text-sm font-medium text-foreground mb-1">Name *</label>
        <Input id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} required
          className="w-full" />
      </div>
      <div>
        <label htmlFor={`${formId}-image`} className="block text-sm font-medium text-foreground mb-1">Artist image (optional)</label>
        <Input id={`${formId}-image`} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://... or artists/.../photo.jpg"
          className="w-full" />
      </div>
      <details open={isEdit || Boolean(focusField)} className="border-y border-border py-3">
        <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Profile details (optional)</summary>
        <p className="mt-2 text-sm text-muted-foreground">Bio, links, rights information, and contacts. You can add these later.</p>
        <div className="mt-4 space-y-4">
      <div>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-foreground">Bio</span>
          <span className="text-xs font-medium capitalize text-muted-foreground" data-testid="artist-bio-state">{bioState}</span>
        </div>
        <CampaignRichTextEditor
          id="artist-bio"
          label="Bio"
          autoFocus={focusField === "bio"}
          value={bioDocument}
          baselineKey={initial ? `${initial.id}:${initial.bio_reviewed_hash ?? "draft"}` : "new"}
          maxCharacters={20_000}
          placeholder="Write the artist biography…"
          readOnly={bioFallback}
          onChange={(document, derived) => {
            setBioDocument(document);
            setBio(derived.plainText);
            setBioDirty(true);
            setBioFallback(false);
            setBioState(derived.plainText.trim() ? "draft" : "missing");
          }}
        />
        {bioFallback ? (
          <div className="mt-2 space-y-2 text-xs text-amber-700" role="alert">
            <p>This stored biography is invalid. It is shown safely and cannot be edited or reviewed until it is explicitly replaced.</p>
            <Button variant="outline"
              type="button"
              onClick={replaceInvalidBio}
              className="rounded border border-amber-300 bg-amber-50 px-3 py-1.5 font-medium text-amber-900"
            >
              Replace invalid biography
            </Button>
          </div>
        ) : null}
        {isEdit ? (
          <Button variant="outline"
            type="button"
            onClick={reviewBio}
            disabled={reviewingBio || bioDirty || bioFallback || bioState === "missing" || bioState === "reviewed"}
            className="mt-2 rounded border border-neutral-300 px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {bioFallback ? "Replace invalid biography first" : bioDirty ? "Save before review" : reviewingBio ? "Reviewing…" : bioState === "reviewed" ? "Reviewed" : "Mark biography reviewed"}
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-pro`} className="block text-sm font-medium text-foreground mb-1">PRO</label>
          <Input id={`${formId}-pro`} value={pro} onChange={(e) => setPro(e.target.value)} placeholder="ASCAP, KODA..." autoFocus={focusField === "pro"}
            className="w-full" />
        </div>
        <div>
          <label htmlFor={`${formId}-spotify-id`} className="block text-sm font-medium text-foreground mb-1">Spotify ID</label>
          <Input id={`${formId}-spotify-id`} value={spotifyId} onChange={(e) => setSpotifyId(e.target.value)} autoFocus={focusField === "spotify_id"}
            className="w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-ipi`} className="block text-sm font-medium text-foreground mb-1">IPI</label>
          <Input id={`${formId}-ipi`} value={ipi} onChange={(e) => setIpi(e.target.value)} autoFocus={focusField === "ipi"}
            className="w-full" />
        </div>
        <div>
          <label htmlFor={`${formId}-instagram`} className="block text-sm font-medium text-foreground mb-1">Instagram</label>
          <Input id={`${formId}-instagram`} value={instagram} onChange={(e) => setInstagram(e.target.value)} autoFocus={focusField === "instagram"}
            className="w-full" />
        </div>
      </div>
      <div>
        <label htmlFor={`${formId}-tiktok`} className="block text-sm font-medium text-foreground mb-1">TikTok</label>
        <Input id={`${formId}-tiktok`} value={tiktok} onChange={(e) => setTiktok(e.target.value)} autoFocus={focusField === "tiktok"}
          className="w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${formId}-relationship`} className="block text-sm font-medium text-foreground mb-1">Roster relationship</label>
          <Select id={`${formId}-relationship`} aria-label="Roster relationship" placeholder="Unclassified" value={relationship} onValueChange={value => setRelationship(value ?? "")} className="w-full" options={[
            { value: "", label: "Unclassified" }, { value: "roster", label: "Roster" }, { value: "collaborator", label: "Collaborator" },
          ]} />
        </div>
        <div>
          <label htmlFor={`${formId}-contact`} className="block text-sm font-medium text-foreground mb-1">Primary contact</label>
          <Select id={`${formId}-contact`} aria-label="Primary contact" placeholder="None" value={contactId} onValueChange={value => setContactId(value ?? "")} className="w-full" options={[
            { value: "", label: "None" }, ...safeContactOptions.map(contact => ({ value: contact.id, label: contact.name })),
          ]} />
        </div>
      </div>
        </div>
      </details>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" type="button" onClick={onClose} className="px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900">Cancel</Button>
        <Button type="submit" disabled={loading}
          >
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Artist"}
        </Button>
      </div>
    </form>
  );
}
