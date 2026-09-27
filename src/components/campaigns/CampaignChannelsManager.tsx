"use client";

import { useMemo, useState } from "react";
import { RadioPluggingCockpit } from "../radio-plugging/RadioPluggingCockpit";

import { Button } from "@/components/ui/button";
type RadioCampaign = NonNullable<Parameters<typeof RadioPluggingCockpit>[0]["current"]>;
type RadioStationOption = Parameters<typeof RadioPluggingCockpit>[0]["allStations"][number];

type AudienceMember = {
  id: string;
  name: string;
  detail: string;
  status: "included" | "excluded";
  reason: string;
};

type AudienceSelection = {
  campaign_audience_id: string;
  preview: {
    audience_id: string;
    audience_name: string;
    audience_description: string | null;
    counts: {
      included_contacts: number;
      excluded_contacts: number;
      included_stations: number;
      excluded_stations: number;
      explicit_contact_members: number;
      explicit_station_members: number;
    };
    included_stations: AudienceMember[];
    excluded_stations: AudienceMember[];
  };
} | null;

type DeliveryPreviewRecipient = {
  station_id: string;
  station_name: string;
  recipient_name: string;
  email: string;
  status: "ready" | "skipped";
  error?: string;
  preview_subject: string;
  preview_body: string;
};

type DeliveryPreview = {
  can_send: false;
  status: "no-send";
  provider: string;
  operator_id: string | null;
  campaign: {
    id: string;
    name: string;
  } | null;
  audience: {
    id: string | null;
    name: string | null;
  } | null;
  template_id: string | null;
  preview_subject: string;
  preview_body: string;
  recipients: DeliveryPreviewRecipient[];
  ready_count: number;
  skipped_count: number;
  deduped_count?: number;
  reviewed_email?: { id: string; version: number; approval_hash: string | null } | null;
  reviewed_page?: { id: string; version: number; content_hash: string; status: "reviewed" | "published"; slug: string | null } | null;
  audience_selection?: { id: string; name: string } | null;
  audience_counts?: { included_stations: number; excluded_stations: number; included_contacts: number; excluded_contacts: number; explicit_contact_members: number; explicit_station_members: number } | null;
  excluded_stations?: AudienceMember[];
  preview_hash?: string | null;
  blockers?: Array<{ code: string; message: string }>;
};

export default function CampaignChannelsManager({
  campaignId,
  radioCampaign,
  allStations,
  audienceSelection,
  canMutate,
}: {
  campaignId: string;
  radioCampaign: RadioCampaign | null;
  allStations: RadioStationOption[];
  audienceSelection: AudienceSelection;
  canMutate: boolean;
}) {
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<DeliveryPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const previewableStationIds = useMemo(
    () => audienceSelection
      ? [...new Set([
          ...audienceSelection.preview.included_stations.map((station) => station.id),
          ...audienceSelection.preview.excluded_stations.map((station) => station.id),
        ])]
      : [],
    [audienceSelection],
  );

  const readyRecipients = preview?.recipients.filter((recipient) => recipient.status === "ready") ?? [];
  const skippedRecipients = preview?.recipients.filter((recipient) => recipient.status === "skipped") ?? [];
  const firstReadyRecipient = readyRecipients[0] ?? null;

  async function handleGeneratePreview() {
    if (!canMutate) return;
    if (previewableStationIds.length === 0) {
      setError("Add at least one non-terminal target station before previewing the radio channel.");
      return;
    }

    setIsPreviewing(true);
    setError("");
    setPreview(null);
    try {
      const response = await fetch("/api/email/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          station_ids: previewableStationIds,
          campaign_id: campaignId,
          radio_update: true,
          preview_only: true,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to generate delivery preview");
      }
      setPreview(payload as DeliveryPreview);
    } catch (previewError: unknown) {
      setError(previewError instanceof Error ? previewError.message : "Unable to generate delivery preview");
    } finally {
      setIsPreviewing(false);
    }
  }


  return (
    <div className="space-y-6">
      <RadioPluggingCockpit campaigns={[]} current={radioCampaign} allStations={allStations} canMutate={canMutate} embedded />

      <section className="grid divide-y border-y border-border xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:divide-x xl:divide-y-0">
        <div className="bg-card p-5 xl:pr-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Saved audience targeting</h3>
              <p className="mt-1 text-sm text-muted-foreground">This reuses the saved audience and eligibility/exclusion rules already attached to the campaign.</p>
            </div>
            <a href={`?tab=audience`} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Open Audience tab</a>
          </div>

          {audienceSelection ? (
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm font-medium">{audienceSelection.preview.audience_name}</p>
                <p className="text-sm text-muted-foreground">{audienceSelection.preview.audience_description || "No audience description"}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <AudienceCount label="Included stations" value={audienceSelection.preview.counts.included_stations} />
                <AudienceCount label="Excluded stations" value={audienceSelection.preview.counts.excluded_stations} />
              </div>
              <details open>
                <summary className="cursor-pointer text-sm font-medium">Included stations</summary>
                <ul className="mt-2 grid gap-2 text-sm">
                  {audienceSelection.preview.included_stations.length === 0 ? (
                    <li className="text-muted-foreground">No stations are currently included by this audience.</li>
                  ) : (
                    audienceSelection.preview.included_stations.map((station) => (
                      <li key={`audience-included-${station.id}`} className="rounded-lg border border-border/80 px-3 py-2">
                        <span className="font-medium">{station.name}</span>
                        <span className="text-muted-foreground"> {"—"} {station.detail}</span>
                      </li>
                    ))
                  )}
                </ul>
              </details>
              <details>
                <summary className="cursor-pointer text-sm font-medium">Excluded stations</summary>
                <ul className="mt-2 grid gap-2 text-sm">
                  {audienceSelection.preview.excluded_stations.length === 0 ? (
                    <li className="text-muted-foreground">No stations are currently excluded by this audience.</li>
                  ) : (
                    audienceSelection.preview.excluded_stations.map((station) => (
                      <li key={`audience-excluded-${station.id}`} className="rounded-lg border border-border/80 px-3 py-2">
                        <span className="font-medium">{station.name}</span>
                        <span className="text-muted-foreground"> {"—"} {station.reason}</span>
                      </li>
                    ))
                  )}
                </ul>
              </details>
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
              No saved audience is linked to this campaign yet. Use the Audience tab to attach one before reviewing recipient inclusion/exclusion reasons here.
            </p>
          )}
        </div>

        <div className="bg-card p-5 xl:pl-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">Operator-controlled delivery review</h3>
              <p className="mt-1 text-sm text-muted-foreground">Preview campaign content and recipients here. Opening, filtering, selecting, and previewing never sends.</p>
            </div>
            <a href={`?tab=content`} className="rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted">Open Content tab</a>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          {canMutate ? (
            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-border/80 bg-muted/20 p-4">
                <p className="text-sm font-medium">Reviewed radio email</p>
                <p className="mt-1 text-sm text-muted-foreground">The approved leadless radio email is loaded server-side from Outreach → Radio update. Client copy and version fields cannot replace it.</p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Preview scope: {previewableStationIds.length} active target station{previewableStationIds.length === 1 ? "" : "s"} from the embedded pipeline
                  {audienceSelection ? " that are still included by the saved audience targeting." : "."}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void handleGeneratePreview()}
                  disabled={isPreviewing || previewableStationIds.length === 0}
                  className="rounded-lg bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {isPreviewing ? "Reviewing…" : "Generate no-send delivery preview"}
                </Button>
              </div>

              {preview && (
                <div className="space-y-4 rounded-xl border border-border bg-background p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <AudienceCount label="Ready recipients" value={preview.ready_count} />
                    <AudienceCount label="Skipped recipients" value={preview.skipped_count} />
                  </div>

                  <div className="space-y-1 text-sm">
                    <p><span className="font-medium">Campaign:</span> {preview.campaign?.name ?? "—"}</p>
                    <p><span className="font-medium">Audience:</span> {preview.audience?.name ?? "No saved audience linked"}</p>
                    <p><span className="font-medium">Provider:</span> {preview.provider}</p>
                    <p><span className="font-medium">Operator:</span> {preview.operator_id ?? "—"}</p>
                    {firstReadyRecipient && <p><span className="font-medium">Preview recipient:</span> {firstReadyRecipient.station_name}</p>}
                  </div>

                  <div className="grid gap-2 rounded-lg border border-border/80 bg-muted/20 p-3 text-xs">
                    <p><span className="font-medium">Reviewed email:</span> {preview.reviewed_email ? `version ${preview.reviewed_email.version}` : "Not available"}</p>
                    <p><span className="font-medium">Reviewed page:</span> {preview.reviewed_page ? `v${preview.reviewed_page.version} · ${preview.reviewed_page.status}` : "Not available"}</p>
                    <p><span className="font-medium">Audience selection:</span> {preview.audience_selection?.name ?? "None"}</p>
                    {preview.audience_counts && <p><span className="font-medium">Audience counts:</span> {preview.audience_counts.included_stations} included · {preview.audience_counts.excluded_stations} excluded</p>}
                    <p><span className="font-medium">Preview hash:</span> {preview.preview_hash ?? "Not available"}</p>
                    {preview.deduped_count !== undefined && <p><span className="font-medium">Deduplicated:</span> {preview.deduped_count}</p>}
                  </div>

                  {preview.blockers && preview.blockers.length > 0 && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm" role="alert">
                      <p className="font-medium">Delivery is blocked</p>
                      <ul className="mt-1 grid gap-1 text-muted-foreground">
                        {preview.blockers.map((blocker) => <li key={blocker.code}>{blocker.message}</li>)}
                      </ul>
                    </div>
                  )}

                  <div>
                    <p className="text-sm font-medium">Subject preview</p>
                    <pre className="mt-1 rounded-lg border border-border bg-card p-3 text-xs whitespace-pre-wrap break-words">{preview.preview_subject || "—"}</pre>
                  </div>
                  <div>
                    <p className="text-sm font-medium">Body preview</p>
                    <pre className="mt-1 rounded-lg border border-border bg-card p-3 text-xs whitespace-pre-wrap break-words">{preview.preview_body || "—"}</pre>
                  </div>

                  <details open>
                    <summary className="cursor-pointer text-sm font-medium">Ready recipients</summary>
                    <ul className="mt-2 grid gap-2 text-sm">
                      {readyRecipients.length === 0 ? (
                        <li className="text-muted-foreground">No recipients are currently ready to send.</li>
                      ) : (
                        readyRecipients.map((recipient) => (
                          <li key={`ready-${recipient.station_id}`} className="rounded-lg border border-border/80 px-3 py-2">
                            <span className="font-medium">{recipient.station_name}</span>
                            <span className="text-muted-foreground"> {"—"} {recipient.email}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </details>

                  <details>
                    <summary className="cursor-pointer text-sm font-medium">Skipped recipients</summary>
                    <ul className="mt-2 grid gap-2 text-sm">
                      {skippedRecipients.length === 0 ? (
                        <li className="text-muted-foreground">No recipients were skipped.</li>
                      ) : (
                        skippedRecipients.map((recipient) => (
                          <li key={`skipped-${recipient.station_id}`} className="rounded-lg border border-border/80 px-3 py-2">
                            <span className="font-medium">{recipient.station_name}</span>
                            <span className="text-muted-foreground"> {"—"} {recipient.error ?? "Skipped"}</span>
                          </li>
                        ))
                      )}
                    </ul>
                  </details>

                  <div className="flex flex-wrap gap-2">
                    <a href={`?tab=activity`} className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
                      Open activity log
                    </a>
                  </div>
                </div>
              )}

            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
              Delivery previews and sends are limited to operators and owners because they expose recipient identity and provider state.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function AudienceCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}
