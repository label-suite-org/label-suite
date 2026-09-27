"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  type CampaignDocument,
} from "../../lib/campaign-rich-text";
import { CampaignRichTextEditor } from "./CampaignRichTextEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface Campaign {
  id: string;
  campaign_name: string;
  linked_release_id?: string | null;
  linked_artist_id?: string | null;
  campaign_type?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  owner?: string | null;
  goal?: string | null;
  brief?: string | null;
  goal_document?: unknown;
  budget_planned?: number | null;
  budget_actual?: number | null;
  kpi_summary?: string | null;
  notes?: string | null;
  notes_document?: unknown;
  performance_rating?: number | null;
  main_platform?: string | null;
  revision?: number | null;
}

export function CampaignForm({
  initial,
  onClose,
  releases,
  artists,
  onAiDecisionPending,
}: {
  initial?: Campaign | null;
  onClose: () => void;
  releases?: Array<{ id: string; title: string }>;
  artists?: Array<{ id: string; name: string }>;
  onAiDecisionPending?: (pending: boolean) => void;
}) {
  const isEdit = !!initial;
  const [campaignName, setCampaignName] = useState(
    initial?.campaign_name || "",
  );
  const [linkedReleaseId, setLinkedReleaseId] = useState(
    initial?.linked_release_id || "",
  );
  const [linkedArtistId, setLinkedArtistId] = useState(
    initial?.linked_artist_id || "",
  );
  const [campaignType, setCampaignType] = useState(
    initial?.campaign_type || "",
  );
  const [startDate, setStartDate] = useState(initial?.start_date || "");
  const [endDate, setEndDate] = useState(initial?.end_date || "");
  const [status, setStatus] = useState(initial?.status || "planning");
  const [owner, setOwner] = useState(initial?.owner || "");
  const [goalInitial] = useState(() =>
    initialCampaignDocument(initial?.goal_document, initial?.goal),
  );
  const [goalDocument, setGoalDocument] = useState<CampaignDocument>(
    goalInitial.document,
  );
  const [goalRepairRequired, setGoalRepairRequired] = useState(
    goalInitial.repairRequired,
  );
  const [brief, setBrief] = useState(initial?.brief || "");
  const [budgetPlanned, setBudgetPlanned] = useState(
    initial?.budget_planned?.toString() || "",
  );
  const [budgetActual, setBudgetActual] = useState(
    initial?.budget_actual?.toString() || "",
  );
  const [kpiSummary, setKpiSummary] = useState(initial?.kpi_summary || "");
  const [notesInitial] = useState(() =>
    initialCampaignDocument(initial?.notes_document, initial?.notes),
  );
  const [notesDocument, setNotesDocument] = useState<CampaignDocument>(
    notesInitial.document,
  );
  const [notesRepairRequired, setNotesRepairRequired] = useState(
    notesInitial.repairRequired,
  );
  const [performanceRating, setPerformanceRating] = useState(
    initial?.performance_rating?.toString() || "",
  );
  const [mainPlatform, setMainPlatform] = useState(
    initial?.main_platform || "",
  );
  const [loading, setLoading] = useState(false);
  const [goalAiDecisionPending, setGoalAiDecisionPending] = useState(false);
  const [notesAiDecisionPending, setNotesAiDecisionPending] = useState(false);
  const [error, setError] = useState("");
  const aiDecisionPending = goalAiDecisionPending || notesAiDecisionPending;
  useEffect(() => {
    onAiDecisionPending?.(aiDecisionPending);
  }, [aiDecisionPending, onAiDecisionPending]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (aiDecisionPending)
        throw new Error("Wait for the AI suggestion decision before saving.");
      if (isEdit && !initial?.revision)
        throw new Error(
          "Campaign version is unavailable. Reload before saving.",
        );
      const body: Record<string, unknown> = {
        campaign_name: campaignName,
        linked_release_id: linkedReleaseId || null,
        linked_artist_id: linkedArtistId || null,
        campaign_type: campaignType || null,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
        owner: owner || null,
        ...(goalRepairRequired ? {} : { goal_document: goalDocument }),
        brief: brief || null,
        budget_planned: budgetPlanned ? Number(budgetPlanned) : null,
        budget_actual: budgetActual ? Number(budgetActual) : null,
        kpi_summary: kpiSummary || null,
        ...(notesRepairRequired ? {} : { notes_document: notesDocument }),
        performance_rating: performanceRating
          ? Number(performanceRating)
          : null,
        main_platform: mainPlatform || null,
        ...(isEdit ? { expected_revision: initial!.revision } : {}),
      };
      const res = await fetch("/api/campaigns", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { ...body, id: initial!.id } : body),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(
          data.error || `Failed to ${isEdit ? "update" : "create"} campaign`,
        );
      }
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const fieldClass = "w-full text-sm";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>Campaign Name *</Label>
        <Input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          required
          className={fieldClass}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Campaign Type</Label>
          <NativeSelect
            value={campaignType}
            onChange={(e) => setCampaignType(e.target.value)}
            className={fieldClass}
          >
            <option value="">— Select —</option>
            <option value="digital">Digital</option>
            <option value="radio">Radio</option>
            <option value="tv">TV</option>
            <option value="print">Print</option>
            <option value="social">Social Media</option>
            <option value="event">Event</option>
            <option value="other">Other</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label>Status</Label>
          <NativeSelect
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={fieldClass}
          >
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Linked Release *</Label>
          <NativeSelect
            required
            value={linkedReleaseId}
            onChange={(e) => setLinkedReleaseId(e.target.value)}
            className={fieldClass}
          >
            <option value="">— Select —</option>
            {(releases || []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label>Linked Artist *</Label>
          <NativeSelect
            required
            value={linkedArtistId}
            onChange={(e) => setLinkedArtistId(e.target.value)}
            className={fieldClass}
          >
            <option value="">— Select —</option>
            {(artists || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Start Date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label>End Date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Owner</Label>
          <Input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Main Platform</Label>
          <NativeSelect
            value={mainPlatform}
            onChange={(e) => setMainPlatform(e.target.value)}
            className={fieldClass}
          >
            <option value="">— Select —</option>
            <option value="Spotify">Spotify</option>
            <option value="Apple Music">Apple Music</option>
            <option value="Instagram">Instagram</option>
            <option value="TikTok">TikTok</option>
            <option value="YouTube">YouTube</option>
            <option value="Facebook">Facebook</option>
            <option value="Twitter/X">Twitter/X</option>
            <option value="Radio">Radio</option>
            <option value="TV">TV</option>
            <option value="Print">Print</option>
            <option value="Other">Other</option>
          </NativeSelect>
        </div>
      </div>
      <CampaignRichTextEditor
        id="campaign-goal"
        label="Campaign goal"
        value={goalDocument}
        baselineKey={`campaign:${initial?.id ?? "new"}`}
        maxCharacters={20_000}
        readOnly={goalRepairRequired || notesAiDecisionPending}
        aiAvailable={isEdit && !notesAiDecisionPending}
        aiAssist={
          initial?.id
            ? {
                campaignId: initial.id,
                surface: "campaign_goal",
                references: {
                  lead_id: null,
                  draft_id: null,
                  page_revision_id: null,
                },
              }
            : undefined
        }
        onAiDecisionPending={setGoalAiDecisionPending}
        onChange={setGoalDocument}
      />
      <div className="space-y-1.5">
        <Label>Campaign brief</Label>
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={20_000}
          className="min-h-24 w-full text-sm"
        />
      </div>
      {goalRepairRequired ? (
        <p role="alert" className="text-xs text-amber-700">
          Stored goal rich text needs repair. Legacy text remains read-only
          until an intentional repair save replaces it.
          <Button
            type="button"
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0 underline"
            onClick={() => setGoalRepairRequired(false)}
          >
            Repair goal rich text
          </Button>
        </p>
      ) : null}
      {initial?.id ? null : (
        <p className="text-xs text-muted-foreground">
          Context-aware AI becomes available after the first save.
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label>Budget Planned</Label>
          <Input
            type="number"
            step="0.01"
            value={budgetPlanned}
            onChange={(e) => setBudgetPlanned(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Budget Actual</Label>
          <Input
            type="number"
            step="0.01"
            value={budgetActual}
            onChange={(e) => setBudgetActual(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Performance (1-10)</Label>
          <Input
            type="number"
            min={1}
            max={10}
            value={performanceRating}
            onChange={(e) => setPerformanceRating(e.target.value)}
            className={fieldClass}
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>KPI Summary</Label>
        <Input
          value={kpiSummary}
          onChange={(e) => setKpiSummary(e.target.value)}
          className={fieldClass}
        />
      </div>
      <CampaignRichTextEditor
        id="campaign-notes"
        label="Campaign notes"
        value={notesDocument}
        baselineKey={`campaign:${initial?.id ?? "new"}`}
        maxCharacters={20_000}
        readOnly={notesRepairRequired || goalAiDecisionPending}
        aiAvailable={isEdit && !goalAiDecisionPending}
        aiAssist={
          initial?.id
            ? {
                campaignId: initial.id,
                surface: "campaign_notes",
                references: {
                  lead_id: null,
                  draft_id: null,
                  page_revision_id: null,
                },
              }
            : undefined
        }
        onAiDecisionPending={setNotesAiDecisionPending}
        onChange={setNotesDocument}
      />
      {notesRepairRequired ? (
        <p role="alert" className="text-xs text-amber-700">
          Stored notes rich text needs repair. Legacy text remains read-only
          until an intentional repair save replaces it.
          <Button
            type="button"
            variant="link"
            size="sm"
            className="ml-2 h-auto p-0 underline"
            onClick={() => setNotesRepairRequired(false)}
          >
            Repair notes rich text
          </Button>
        </p>
      ) : null}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2 justify-end">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (!aiDecisionPending) onClose();
          }}
          disabled={aiDecisionPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={loading || aiDecisionPending}>
          {loading ? "Saving..." : isEdit ? "Save Changes" : "Create Campaign"}
        </Button>
      </div>
    </form>
  );
}

function initialCampaignDocument(
  document: unknown,
  legacyText?: string | null,
): { document: CampaignDocument; repairRequired: boolean } {
  if (document !== undefined && document !== null) {
    try {
      return {
        document: deriveCampaignDocument(document, 20_000).document,
        repairRequired: false,
      };
    } catch {
      return {
        document: legacyTextToCampaignDocument(legacyText ?? ""),
        repairRequired: true,
      };
    }
  }
  return {
    document: legacyTextToCampaignDocument(legacyText ?? ""),
    repairRequired: false,
  };
}
