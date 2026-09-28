"use client";

import { useEffect, useState } from "react";
import { type FormEvent } from "react";

import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
type ContentSourceOption = {
  id: string;
  name: string;
};

type CampaignContentTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  is_default: boolean | null;
  review_status: string;
  source_version: number | null;
  current_version: number;
};

type CampaignContentSelection = {
  reviewed_template_id: string | null;
  content_source_references: {
    release_id: string | null;
    artist_id: string | null;
    document_ids: string[];
    media_asset_ids: string[];
  };
};

type CampaignContentContext = {
  campaign: {
    id: string;
    campaign_name: string;
    linked_release_id: string | null;
    linked_artist_id: string | null;
  };
  templates: CampaignContentTemplate[];
  selection: CampaignContentSelection | null;
  source_options: {
    documents: ContentSourceOption[];
    media_assets: ContentSourceOption[];
  };
};

type CampaignContentPayload = {
  template_id: string | null;
  source_references: {
    release_id: string | null;
    artist_id: string | null;
    document_ids: string[];
    media_asset_ids: string[];
  };
};

type CampaignContentPreview = {
  can_send: false;
  status: "no-send";
  campaign_id: string;
  template_id: string;
  preview_subject: string;
  preview_body: string;
  blockers: Array<{ code: string; message: string }>;
  provenance: {
    campaign: {
      id: string;
      name: string;
      linked_release_id: string | null;
      linked_artist_id: string | null;
      linked_audience_id: string | null;
    };
    operator: {
      id: string | null;
    };
    provider: string;
    recipient: {
      audience_id: string | null;
      audience_name: string | null;
      source_references: {
        release_id: string | null;
        artist_id: string | null;
        document_ids: string[];
        media_asset_ids: string[];
      };
    };
  };
  template_version: number | null;
  reviewed_version: number | null;
};

type CampaignContentManagerProps = {
  campaignId: string;
  canMutate: boolean;
};

function asErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Action failed";
}

function formatSourceList(values: string[]): string {
  return values.length === 0 ? "—" : values.join(", ");
}

function formatSourceReferences(
  releaseId: string | null,
  artistId: string | null,
  documents: string[],
  mediaAssets: string[],
): string[] {
  return [
    `release_id: ${releaseId ?? "—"}`,
    `artist_id: ${artistId ?? "—"}`,
    `document_ids: ${formatSourceList(documents)}`,
    `media_asset_ids: ${formatSourceList(mediaAssets)}`,
  ];
}

export default function CampaignContentManager({ campaignId, canMutate }: CampaignContentManagerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [context, setContext] = useState<CampaignContentContext | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedMediaAssetIds, setSelectedMediaAssetIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<CampaignContentPreview | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  useEffect(() => {
    void loadContext();
  }, []);

  async function loadContext() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/content`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to load campaign content context");
      }
      const next = await response.json() as CampaignContentContext;
      setContext(next);
      setSelectedTemplateId(next.selection?.reviewed_template_id ?? "");
      setSelectedDocumentIds(next.selection?.content_source_references.document_ids ?? []);
      setSelectedMediaAssetIds(next.selection?.content_source_references.media_asset_ids ?? []);
    } catch (loadError: unknown) {
      setError(asErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  function collectPayload(): CampaignContentPayload {
    return {
      template_id: selectedTemplateId || null,
      source_references: {
        release_id: context?.campaign.linked_release_id ?? null,
        artist_id: context?.campaign.linked_artist_id ?? null,
        document_ids: selectedDocumentIds,
        media_asset_ids: selectedMediaAssetIds,
      },
    };
  }

  function getTemplateStateLabel(template: CampaignContentTemplate): string {
    const reviewed = template.review_status === "reviewed";
    const stale = reviewed && template.source_version !== template.current_version;
    if (!reviewed) return "Draft";
    if (stale) return "Reviewed (stale)";
    return "Reviewed";
  }

  function collectSourceReferencesPayload(): {
    release_id: string | null;
    artist_id: string | null;
    document_ids: string[];
    media_asset_ids: string[];
  } {
    return {
      release_id: context?.campaign.linked_release_id ?? null,
      artist_id: context?.campaign.linked_artist_id ?? null,
      document_ids: selectedDocumentIds,
      media_asset_ids: selectedMediaAssetIds,
    };
  }

  async function handlePreview(event: FormEvent) {
    event.preventDefault();
    if (!campaignId || !context) return;

    setIsSaving(true);
      setError("");
      setPreview(null);
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload()),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to generate preview");
      }
      setPreview(await response.json() as CampaignContentPreview);
    } catch (error: unknown) {
      setError(asErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!canMutate || !campaignId || !context) return;

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(collectPayload()),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to save campaign content settings");
      }
      await loadContext();
      await handlePreview({ preventDefault: () => void 0 } as FormEvent);
    } catch (error: unknown) {
      setError(asErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReview(event: FormEvent) {
    event.preventDefault();
    if (!canMutate || !campaignId || !selectedTemplateId || !context) return;

    setIsReviewing(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          template_id: selectedTemplateId,
          source_references: collectSourceReferencesPayload(),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Failed to review template");
      }
      await loadContext();
      await handlePreview({ preventDefault: () => void 0 } as FormEvent);
    } catch (error: unknown) {
      setError(asErrorMessage(error));
    } finally {
      setIsReviewing(false);
    }
  }

  if (loading) {
    return <section className="space-y-4"><p className="text-sm text-muted-foreground">Loading reviewed template context…</p></section>;
  }

  if (!context) {
    return <section className="space-y-4"><p className="text-sm text-red-600">{error || "Unable to load campaign content context."}</p></section>;
  }

  return (
    <section className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <label className="block text-sm font-medium text-foreground mb-2" htmlFor="campaign-content-template">
          Reviewed template
        </label>
        <NativeSelect
          id="campaign-content-template"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          disabled={!canMutate}
        >
          <option value="">No template selected</option>
          {context.templates.map((template) => (
            <option key={template.id} value={template.id}>
              {`${template.name} (${getTemplateStateLabel(template)})`}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Source documents</h3>
        <div className="mt-2 space-y-2">
          {context.source_options.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents are linked to this release.</p>
          ) : (
            context.source_options.documents.map((document) => (
              <label key={document.id} className="flex items-center gap-2 text-sm">
                <Input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedDocumentIds.includes(document.id)}
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setSelectedDocumentIds((current) => nextChecked
                      ? [...new Set([...current, document.id])]
                      : current.filter((id) => id !== document.id));
                  }}
                  disabled={!canMutate}
                />
                {document.name}
              </label>
            ))
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <h3 className="text-sm font-semibold">Source media assets</h3>
        <div className="mt-2 space-y-2">
          {context.source_options.media_assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No media assets are linked to this release.</p>
          ) : (
            context.source_options.media_assets.map((asset) => (
              <label key={asset.id} className="flex items-center gap-2 text-sm">
                <Input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={selectedMediaAssetIds.includes(asset.id)}
                  onChange={(event) => {
                    const nextChecked = event.target.checked;
                    setSelectedMediaAssetIds((current) => nextChecked
                      ? [...new Set([...current, asset.id])]
                      : current.filter((id) => id !== asset.id));
                  }}
                  disabled={!canMutate}
                />
                {asset.name}
              </label>
            ))
          )}
        </div>
      </div>

      <form className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={(event) => void handlePreview(event)}
          className="rounded-md bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={isSaving || !canMutate}
        >
          Generate no-send preview
        </Button>
        <Button
          type="button"
          onClick={(event) => void handleReview(event)}
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          disabled={isReviewing || isSaving || !canMutate || !selectedTemplateId}
          title="Review the selected template with current source selections."
        >
          {isReviewing ? "Reviewing..." : "Review selected template"}
        </Button>
        <Button
          type="button"
          onClick={(event) => void handleSave(event)}
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          disabled={!canMutate || isSaving || isReviewing}
        >
          Persist reviewed template selection
        </Button>
      </form>

      {preview ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <h3 className="text-sm font-semibold">No-send preview</h3>
          <p className="mt-1 text-xs text-muted-foreground">This preview is intentionally not sent.</p>
          <p className="mt-1 text-sm"><span className="text-muted-foreground">Template:</span> {preview.template_id || "none"}</p>
          <p className="mt-1 text-sm font-medium">Subject</p>
          <pre className="mt-1 rounded-md border border-border bg-background p-2 text-xs whitespace-pre-wrap break-words">{preview.preview_subject || "—"}</pre>
          <p className="mt-3 text-sm font-medium">Body</p>
          <pre className="mt-1 rounded-md border border-border bg-background p-2 text-xs whitespace-pre-wrap break-words">{preview.preview_body || "—"}</pre>

          <div className="mt-3 space-y-1 text-sm">
            <p className="font-semibold">Provenance</p>
            <p>
              <span className="text-muted-foreground">Campaign:</span> {preview.provenance.campaign.name} ({preview.provenance.campaign.id})
            </p>
            <p>
              <span className="text-muted-foreground">Operator:</span> {preview.provenance.operator.id ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Provider:</span> {preview.provenance.provider}
            </p>
            <p>
              <span className="text-muted-foreground">Audience:</span> {preview.provenance.recipient.audience_name ?? "—"}
              {preview.provenance.recipient.audience_id ? ` (${preview.provenance.recipient.audience_id})` : ""}
            </p>
            {formatSourceReferences(
              preview.provenance.recipient.source_references.release_id,
              preview.provenance.recipient.source_references.artist_id,
              preview.provenance.recipient.source_references.document_ids,
              preview.provenance.recipient.source_references.media_asset_ids,
            ).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>

          {preview.blockers.length > 0 ? (
            <div className="mt-3">
              <p className="text-sm font-semibold text-red-700">Blockers (send blocked)</p>
              <ul className="mt-1 space-y-1">
                {preview.blockers.map((blocker) => (
                  <li key={`${blocker.code}-${blocker.message}`} className="text-xs text-red-600">
                    {blocker.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-3 text-sm text-emerald-700">No blockers</p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            template version {preview.template_version ?? "n/a"} · reviewed version {preview.reviewed_version ?? "n/a"}
          </p>
        </div>
      ) : null}
    </section>
  );
}
