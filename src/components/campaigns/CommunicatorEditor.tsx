import { useEffect, useMemo, useState } from "react";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
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

type Lead = CampaignOutreachWorkspaceData["leads"][number];
type Prompt = CampaignOutreachWorkspaceData["prompt"];

type Props = {
  lead: Lead;
  prompt: Prompt;
  canMutate: boolean;
  busy: boolean;
  aiUnavailable: boolean;
  onSavePrompt: (prompt: string) => void;
  onGenerateDraft: (instruction: string) => void;
  onSaveDraft: (
    draftId: string,
    subject: string | null,
    body: string,
    bodyDocument: CampaignDocument,
  ) => void;
  onApproveDraft: (draftId: string) => void;
  onRecordSent: (
    draftId: string,
    channel: string,
    sentAt: string,
    destination: string,
    followUpAt?: string | null,
  ) => void;
  onAiDecisionPending?: (pending: boolean) => void;
};

export default function CommunicatorEditor({
  lead,
  prompt,
  canMutate,
  busy,
  aiUnavailable,
  onSavePrompt,
  onGenerateDraft,
  onSaveDraft,
  onApproveDraft,
  onRecordSent,
  onAiDecisionPending,
}: Props) {
  const [promptText, setPromptText] = useState(prompt?.prompt ?? "");
  const [instruction, setInstruction] = useState("");
  const [repairingDraft, setRepairingDraft] = useState(false);
  const [restoredRepairReason, setRestoredRepairReason] = useState<
    "malformed" | "over_limit" | null
  >(null);
  const currentDraft =
    [...lead.draft_versions].sort(
      (left, right) => right.version - left.version,
    )[0] ?? null;
  const approvedDraft =
    currentDraft?.status === "approved" ? currentDraft : null;
  const repairRequired = Boolean(
    currentDraft?.body_document_repair_required || restoredRepairReason,
  );
  const repairRequiresShortening =
    currentDraft?.body_document_repair_reason === "over_limit" ||
    restoredRepairReason === "over_limit";
  const draftReadOnly = !canMutate || (repairRequired && !repairingDraft);
  const [subject, setSubject] = useState(currentDraft?.subject ?? "");
  const [body, setBody] = useState(currentDraft?.body ?? "");
  const [bodyDocument, setBodyDocument] = useState<CampaignDocument>(() =>
    draftDocument(currentDraft),
  );
  const [bodyEditorRevision, setBodyEditorRevision] = useState(0);
  const [channel, setChannel] = useState("email");
  const [sentAt, setSentAt] = useState("");
  const [destination, setDestination] = useState("");
  const [followUpMode, setFollowUpMode] = useState("suggested");
  const [followUpAt, setFollowUpAt] = useState("");
  useEffect(
    () => setPromptText(prompt?.prompt ?? ""),
    [prompt?.id, prompt?.version],
  );
  useEffect(() => {
    setSubject(currentDraft?.subject ?? "");
    const nextDocument = draftDocument(currentDraft);
    setBodyDocument(nextDocument);
    setBody(currentDraft?.body ?? readableDraftText(nextDocument));
    setBodyEditorRevision((revision) => revision + 1);
    setRepairingDraft(false);
    setRestoredRepairReason(null);
  }, [currentDraft?.id, currentDraft?.body]);
  const currentDraftDocument = useMemo(
    () => draftDocument(currentDraft),
    [currentDraft],
  );
  const repairIsAuthorable = canAuthorDraft(bodyDocument);
  const emailDirty =
    normalizeText(subject) !== normalizeText(currentDraft?.subject ?? "") ||
    documentHash(bodyDocument) !== documentHash(currentDraftDocument);
  return (
    <section
      aria-labelledby="communicator-title"
      className="border-t border-border pt-5"
    >
      <div>
        <h3 id="communicator-title" className="font-semibold">
          Communicator
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Manual editor with assisted generation. It cannot send or claim
          delivery.
        </p>
      </div>
      <Label className="mt-3 block text-xs font-medium">
        Campaign voice prompt
        <Textarea
          readOnly={!canMutate}
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          rows={3}
          className="mt-1 w-full resize-y"
        />
      </Label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!canMutate || busy || !promptText.trim()}
        onClick={() => onSavePrompt(promptText)}
        className="mt-2"
      >
        Save prompt
      </Button>

      {currentDraft ? null : (
        <Label className="mt-4 block text-xs font-medium">
          One-off draft instruction
          <Input
            readOnly={!canMutate}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            className="mt-1 h-9"
          />
        </Label>
      )}
      {currentDraft ? null : (
        <div className="mt-2">
          <Button
            type="button"
            size="sm"
            disabled={!canMutate || busy || aiUnavailable}
            onClick={() => onGenerateDraft(instruction)}
          >
            Create saved first draft
          </Button>
          <p className="mt-1 text-xs text-muted-foreground">
            Creates a persisted first draft version for manual review; it does
            not send outreach.
          </p>
        </div>
      )}

      <div className="mt-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold">Draft editor</p>
          <span className="text-[11px] text-muted-foreground">
            {currentDraft
              ? `Version ${currentDraft.version} · ${currentDraft.status}`
              : "No draft yet"}
          </span>
        </div>
        {repairRequired && !repairingDraft ? (
          <div
            role="alert"
            className="mt-2 border border-amber-700 p-2 text-xs"
          >
            Stored rich text needs repair.{" "}
            {repairRequiresShortening
              ? "This readable historical copy exceeds the 10,000-character authoring limit; shorten it before saving or approval."
              : "Legacy copy is read-only until an intentional repair save replaces the malformed document."}
            <span className="mt-2 block whitespace-pre-wrap">{body}</span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="ml-2 h-auto p-0 underline"
              onClick={() => {
                setRepairingDraft(true);
                if (repairRequiresShortening) {
                  const empty = legacyTextToCampaignDocument("");
                  setBodyDocument(empty);
                  setBody("");
                  setBodyEditorRevision((revision) => revision + 1);
                }
              }}
              disabled={!canMutate || busy}
            >
              Repair and edit draft
            </Button>
          </div>
        ) : null}
        <Label className="mt-2 block text-xs font-medium">
          Subject
          <Input
            readOnly={draftReadOnly}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1 h-9"
          />
        </Label>
        <CampaignRichTextEditor
          key={bodyEditorRevision}
          id="campaign-outreach-body"
          label="Outreach body"
          value={bodyDocument}
          baselineKey={
            currentDraft
              ? `focused-draft:${currentDraft.id}`
              : `focused-bootstrap:${lead.id}`
          }
          maxCharacters={10_000}
          readOnly={draftReadOnly}
          aiAvailable={
            !draftReadOnly && !aiUnavailable && Boolean(currentDraft)
          }
          aiAssist={
            currentDraft
              ? {
                  campaignId: lead.campaign_id,
                  surface: "focused_outreach_body",
                  references: {
                    lead_id: lead.id,
                    draft_id: currentDraft.id,
                    page_revision_id: null,
                  },
                }
              : undefined
          }
          onAiDecisionPending={onAiDecisionPending}
          onChange={(document, derived) => {
            setBodyDocument(document);
            setBody(derived.plainText);
          }}
        />
        {emailDirty && (
          <p className="text-xs font-semibold text-amber-700">
            Unsaved outreach changes · save a new version before approval.
          </p>
        )}
        {currentDraft && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !canMutate ||
                busy ||
                !body.trim() ||
                (repairRequired && (!repairingDraft || !repairIsAuthorable))
              }
              onClick={() =>
                onSaveDraft(
                  currentDraft.id,
                  subject.trim() || null,
                  body,
                  bodyDocument,
                )
              }
            >
              Save as new draft
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                !canMutate ||
                busy ||
                currentDraft.status !== "draft" ||
                emailDirty ||
                repairRequired
              }
              onClick={() => onApproveDraft(currentDraft.id)}
            >
              Approve draft
            </Button>
          </div>
        )}
        {lead.draft_versions.length > 1 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Version history
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[...lead.draft_versions]
                .sort((left, right) => right.version - left.version)
                .filter((draft) => draft.id !== currentDraft?.id)
                .map((draft) => (
                  <Button
                    key={draft.id}
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={!canMutate || busy}
                    onClick={() => {
                      const restored = draftDocument(draft);
                      setSubject(draft.subject ?? "");
                      setBodyDocument(restored);
                      setBody(draft.body ?? readableDraftText(restored));
                      setRestoredRepairReason(
                        draft.body_document_repair_reason ??
                          (canAuthorDraft(restored) ? null : "over_limit"),
                      );
                      setRepairingDraft(false);
                      setBodyEditorRevision((revision) => revision + 1);
                    }}
                  >
                    Restore version {draft.version} as new draft
                  </Button>
                ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-xs font-semibold">Record an external manual send</p>
        <p className="mt-1 text-xs text-muted-foreground">
          This records what happened elsewhere; it does not deliver a message.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <Label className="text-xs font-medium">
            Channel
            <NativeSelect
              value={channel}
              disabled={!canMutate || busy}
              onChange={(event) => setChannel(event.target.value)}
              className="mt-1 h-9 w-full"
            >
              <option value="email">Email</option>
              <option value="instagram_dm">Instagram DM</option>
              <option value="soundcloud_message">SoundCloud message</option>
              <option value="other">Other</option>
            </NativeSelect>
          </Label>
          <Label className="text-xs font-medium">
            Sent at
            <Input
              aria-label="Sent at"
              type="datetime-local"
              value={sentAt}
              disabled={!canMutate || busy}
              onChange={(event) => setSentAt(event.target.value)}
              className="mt-1 h-9 w-full"
            />
          </Label>
          <Label className="text-xs font-medium">
            Destination
            <Input
              aria-label="Destination used"
              value={destination}
              disabled={!canMutate || busy}
              onChange={(event) => setDestination(event.target.value)}
              className="mt-1 h-9 w-full"
            />
          </Label>
          <Label className="text-xs font-medium">
            Follow-up
            <NativeSelect
              value={followUpMode}
              disabled={!canMutate || busy}
              onChange={(event) => setFollowUpMode(event.target.value)}
              className="mt-1 h-9 w-full"
            >
              <option value="suggested">Suggest 14 days</option>
              <option value="custom">Choose date</option>
              <option value="none">No follow-up</option>
            </NativeSelect>
          </Label>
          {followUpMode === "custom" && (
            <Label className="text-xs font-medium sm:col-span-2">
              Follow-up at
              <Input
                type="datetime-local"
                value={followUpAt}
                onChange={(event) => setFollowUpAt(event.target.value)}
                className="mt-1 h-9 w-full"
              />
            </Label>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            !canMutate ||
            busy ||
            lead.pipeline_stage !== "ready" ||
            !approvedDraft ||
            lead.ready_blockers.length > 0 ||
            !sentAt ||
            (followUpMode === "custom" && !followUpAt)
          }
          onClick={() =>
            approvedDraft &&
            onRecordSent(
              approvedDraft.id,
              channel,
              toIso(sentAt),
              destination.trim(),
              followUpMode === "suggested"
                ? undefined
                : followUpMode === "none"
                  ? null
                  : toIso(followUpAt),
            )
          }
          className="mt-3"
        >
          Record sent
        </Button>
      </div>
    </section>
  );
}

function toIso(value: string) {
  return new Date(value).toISOString();
}

function draftDocument(
  draft: Lead["draft_versions"][number] | null | undefined,
): CampaignDocument {
  try {
    return deriveCampaignDocument(
      draft?.body_document ?? legacyTextToCampaignDocument(draft?.body ?? ""),
      10_000,
    ).document;
  } catch {
    return legacyTextToCampaignDocument(draft?.body ?? "");
  }
}

function documentHash(document: CampaignDocument) {
  return JSON.stringify(document);
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function canAuthorDraft(document: CampaignDocument) {
  try {
    deriveCampaignDocument(document, 10_000);
    return true;
  } catch {
    return false;
  }
}

function readableDraftText(document: CampaignDocument) {
  try {
    return deriveCampaignDocument(document, 20_000).plainText;
  } catch {
    return "";
  }
}
