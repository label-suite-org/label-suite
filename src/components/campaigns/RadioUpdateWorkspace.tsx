import { useEffect, useMemo, useState } from "react";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import {
  campaignPublicPageContentSchema,
  type CampaignPublicPageContent,
} from "../../server/campaign-public-page-core";
import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  type CampaignDocument,
} from "../../lib/campaign-rich-text";
import { CampaignRichTextEditor } from "./CampaignRichTextEditor";
import { FountainRadioUpdatePage } from "../press/FountainRadioUpdatePage";
import type { PublicPageProjection } from "../../server/campaign-public-page-core";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

type Props = {
  campaignId: string;
  campaignName: string;
  initialData: CampaignOutreachWorkspaceData["radioUpdate"];
  canMutate: boolean;
  canPublish: boolean;
  onDogfood?: (links: {
    draftId: string | null;
    pageRevisionId: string | null;
  }) => Promise<void>;
  onAiDecisionPending?: (pending: boolean) => void;
};

type RadioData = Props["initialData"];
type Revision = NonNullable<RadioData["page"]["draft"]>;
type Draft = RadioData["radio_drafts"][number];

const EMPTY_CONTENT: CampaignPublicPageContent = {
  label_line: "True Nature",
  title: "",
  release_note: "",
  release_note_document: legacyTextToCampaignDocument(""),
  artwork_asset_id: "",
  focus_track_ids: [] as string[],
  listen_url: "",
  download_url: null as string | null,
  metadata_url: null as string | null,
  contact_name: "",
  contact_email: "",
  network_statement: "Shared with our independent radio network.",
};

export default function RadioUpdateWorkspace({
  campaignId,
  campaignName,
  initialData,
  canMutate,
  canPublish,
  onDogfood,
  onAiDecisionPending,
}: Props) {
  const initialRevision =
    initialData.page.draft ?? initialData.page.revisions[0] ?? null;
  const initialDraft =
    initialData.radio_drafts.find(
      (draft) =>
        draft.status !== "superseded" &&
        draft.context_snapshot.page_revision_id === initialRevision?.id,
    ) ?? null;
  const [activeRevision, setActiveRevision] = useState<Revision | null>(
    initialRevision,
  );
  const [pageState, setPageState] = useState(initialData.page.page);
  const [revisions, setRevisions] = useState(initialData.page.revisions);
  const [content, setContent] = useState(() =>
    parseContent(initialRevision?.content),
  );
  const [slug, setSlug] = useState(initialData.page.page?.slug ?? "");
  const [drafts, setDrafts] = useState(initialData.radio_drafts);
  const [subject, setSubject] = useState(initialDraft?.subject ?? "");
  const [body, setBody] = useState(initialDraft?.body ?? "");
  const [bodyDocument, setBodyDocument] = useState<CampaignDocument>(() =>
    draftDocument(initialDraft),
  );
  const [instruction, setInstruction] = useState("");
  const [publishConfirmation, setPublishConfirmation] = useState("");
  const [unpublishConfirmation, setUnpublishConfirmation] = useState("");
  const [approveConfirmation, setApproveConfirmation] = useState("");
  const [repairingDraft, setRepairingDraft] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [releaseNoteDecisionPending, setReleaseNoteDecisionPending] =
    useState(false);
  const [radioBodyDecisionPending, setRadioBodyDecisionPending] =
    useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<PublicPageProjection | null>(null);
  const aiDecisionPending =
    releaseNoteDecisionPending || radioBodyDecisionPending;
  useEffect(() => {
    onAiDecisionPending?.(aiDecisionPending);
  }, [aiDecisionPending, onAiDecisionPending]);
  const currentDraft = useMemo(
    () =>
      drafts.find(
        (draft) =>
          draft.status !== "superseded" &&
          draft.context_snapshot.page_revision_id === activeRevision?.id,
      ) ?? null,
    [drafts, activeRevision?.id],
  );
  const liveRevisionId = pageState?.current_published_revision_id ?? null;
  const latestRevision = activeRevision?.id ?? null;
  const hasReviewedActiveRevision =
    activeRevision?.review_status === "reviewed";
  const repairRequired = Boolean(currentDraft?.body_document_repair_required);
  const repairRequiresShortening =
    currentDraft?.body_document_repair_reason === "over_limit";
  const draftReadOnly =
    !canMutate ||
    releaseNoteDecisionPending ||
    (repairRequired && !repairingDraft);
  const repairIsAuthorable = canAuthorDraft(bodyDocument);
  const pageDirty = Boolean(
    activeRevision &&
      (canonicalContent(content) !==
        canonicalContent(parseContent(activeRevision.content)) ||
        slug !== (pageState?.slug ?? "")),
  );
  const emailDirty =
    normalizeText(subject) !== normalizeText(currentDraft?.subject ?? "") ||
    documentHash(bodyDocument) !== documentHash(draftDocument(currentDraft));

  useEffect(() => {
    let cancelled = false;
    if (
      !activeRevision ||
      activeRevision.review_status !== "reviewed" ||
      pageDirty
    ) {
      setPreview(null);
      return () => {
        cancelled = true;
      };
    }
    void apiRequest<PublicPageProjection>(
      `/api/campaigns/${campaignId}/public-page/preview?revision_id=${encodeURIComponent(activeRevision.id)}`,
      "GET",
    )
      .then((result) => {
        if (!cancelled && isPreviewProjection(result)) setPreview(result);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, activeRevision?.id, pageDirty]);

  useEffect(() => {
    setRepairingDraft(false);
  }, [currentDraft?.id, activeRevision?.id]);

  function updateContent<
    K extends Exclude<
      keyof CampaignPublicPageContent,
      "release_note" | "release_note_document"
    >,
  >(field: K, value: CampaignPublicPageContent[K]) {
    setContent((current) => ({ ...current, [field]: value }));
  }

  async function savePage() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    setBusy("page");
    setNotice(null);
    try {
      const result = await apiRequest<{
        page: NonNullable<typeof pageState>;
        revision: Revision;
      }>(`/api/campaigns/${campaignId}/public-page`, "POST", { slug, content });
      setActiveRevision(result.revision);
      setRevisions((current) => [
        result.revision,
        ...current.map((revision) =>
          revision.review_status === "draft"
            ? { ...revision, review_status: "superseded" }
            : revision,
        ),
      ]);
      setPageState(result.page);
      setSlug(result.page.slug);
      setNotice(
        `Page draft v${result.revision.version} saved. Review is the next action.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, "Could not save the page draft"));
    } finally {
      setBusy(null);
    }
  }

  async function reviewPage() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (!activeRevision) {
      setNotice("Save a page draft before review.");
      return;
    }
    setBusy("review");
    setNotice(null);
    try {
      const result = await apiRequest<{ revision: Revision }>(
        `/api/campaigns/${campaignId}/public-page/review`,
        "POST",
        { revision_id: activeRevision.id },
      );
      setActiveRevision(result.revision);
      setRevisions((current) =>
        current.map((revision) =>
          revision.id === result.revision.id ? result.revision : revision,
        ),
      );
      setNotice(`Page revision v${result.revision.version} is reviewed.`);
    } catch (error) {
      setNotice(errorMessage(error, "Could not review the page"));
    } finally {
      setBusy(null);
    }
  }

  async function publishPage() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (!activeRevision || publishConfirmation !== "publish") {
      setNotice("Type publish to confirm the owner-only page action.");
      return;
    }
    setBusy("publish");
    setNotice(null);
    try {
      const result = await apiRequest<{
        revision: Revision;
        page: NonNullable<typeof pageState>;
      }>(`/api/campaigns/${campaignId}/public-page/publish`, "POST", {
        revision_id: activeRevision.id,
        confirmation: "publish",
      });
      setActiveRevision(result.revision);
      setRevisions((current) =>
        current.map((revision) =>
          revision.id === result.revision.id ? result.revision : revision,
        ),
      );
      setPageState(result.page);
      setPublishConfirmation("");
      setNotice("Page is live. The public URL is shown below.");
    } catch (error) {
      setNotice(errorMessage(error, "Could not publish the page"));
    } finally {
      setBusy(null);
    }
  }

  async function unpublishPage() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (unpublishConfirmation !== "unpublish") {
      setNotice("Type unpublish to confirm the owner-only page action.");
      return;
    }
    setBusy("unpublish");
    setNotice(null);
    try {
      const result = await apiRequest<{ page: NonNullable<typeof pageState> }>(
        `/api/campaigns/${campaignId}/public-page/publish`,
        "POST",
        { confirmation: "unpublish" },
      );
      setPageState(result.page);
      setUnpublishConfirmation("");
      setNotice("Page is unpublished. Revision history remains available.");
    } catch (error) {
      setNotice(errorMessage(error, "Could not unpublish the page"));
    } finally {
      setBusy(null);
    }
  }

  async function generateRadioDraft() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (!activeRevision || activeRevision.review_status !== "reviewed") {
      setNotice("A reviewed page revision is required before drafting.");
      return;
    }
    if (currentDraft) {
      setNotice(
        "A saved radio draft already exists; review copy suggestions in the editor.",
      );
      return;
    }
    setBusy("generate");
    setNotice(null);
    try {
      const result = await apiRequest<Draft>(
        `/api/campaigns/${campaignId}/radio-update-drafts`,
        "POST",
        {
          page_revision_id: activeRevision.id,
          instruction: instruction.trim() || null,
        },
      );
      setDrafts((current) => [
        result,
        ...current.map((draft) =>
          draft.status === "superseded"
            ? draft
            : { ...draft, status: "superseded" as const },
        ),
      ]);
      const nextDocument = draftDocument(result);
      setSubject(result.subject ?? "");
      setBodyDocument(nextDocument);
      setBody(deriveCampaignDocument(nextDocument, 10_000).plainText);
      setNotice(
        `Radio update draft v${result.version} is ready for manual review.`,
      );
    } catch (error) {
      setNotice(
        `${errorMessage(error, "Radio drafting is unavailable")}. Manual editing remains available.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function saveRadioDraft() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (!activeRevision || activeRevision.review_status !== "reviewed") {
      setNotice("A reviewed page revision is required before saving.");
      return;
    }
    if (repairRequired && (!repairingDraft || !canAuthorDraft(bodyDocument))) {
      setNotice("Shorten and repair this draft before saving.");
      return;
    }
    setBusy("draft");
    setNotice(null);
    try {
      const result = currentDraft
        ? await apiRequest<Draft>(
            `/api/campaign-outreach-drafts/${currentDraft.id}`,
            "PATCH",
            { subject: subject || null, body, body_document: bodyDocument },
          )
        : await apiRequest<Draft>(
            `/api/campaigns/${campaignId}/radio-update-drafts/manual`,
            "POST",
            {
              page_revision_id: activeRevision.id,
              subject: subject || null,
              body,
              body_document: bodyDocument,
            },
          );
      setDrafts((current) => [
        result,
        ...current.map((draft) =>
          draft.id === currentDraft?.id || draft.status !== "superseded"
            ? { ...draft, status: "superseded" as const }
            : draft,
        ),
      ]);
      const nextDocument = draftDocument(result);
      setSubject(result.subject ?? "");
      setBodyDocument(nextDocument);
      setBody(deriveCampaignDocument(nextDocument, 10_000).plainText);
      setNotice(
        `Radio draft v${result.version} saved. Approval is the next action.`,
      );
    } catch (error) {
      setNotice(errorMessage(error, "Could not save the radio draft"));
    } finally {
      setBusy(null);
    }
  }

  async function approveRadioDraft() {
    if (aiDecisionPending) {
      setNotice(
        "Wait for the AI suggestion decision before changing this page.",
      );
      return;
    }
    if (!currentDraft || approveConfirmation !== "approve") {
      setNotice("Type approve to confirm this radio draft approval.");
      return;
    }
    if (repairRequired) {
      setNotice("Repair this draft before approval.");
      return;
    }
    setBusy("approve");
    setNotice(null);
    try {
      const result = await apiRequest<Draft>(
        `/api/campaign-outreach-drafts/${currentDraft.id}/approve`,
        "POST",
        {},
      );
      setDrafts((current) =>
        current.map((draft) =>
          draft.id === currentDraft.id
            ? { ...draft, ...result, status: "approved" as const }
            : draft,
        ),
      );
      setApproveConfirmation("");
      setNotice(
        "Radio email is approved. Delivery preview remains a separate operator handoff.",
      );
    } catch (error) {
      setNotice(errorMessage(error, "Could not approve the radio draft"));
    } finally {
      setBusy(null);
    }
  }

  function selectRevision(revision: Revision) {
    setActiveRevision(revision);
    setContent(parseContent(revision.content));
    const revisionDraft = drafts.find(
      (draft) =>
        draft.status !== "superseded" &&
        draft.context_snapshot.page_revision_id === revision.id,
    );
    setSubject(revisionDraft?.subject ?? "");
    const nextDocument = draftDocument(revisionDraft);
    setBodyDocument(nextDocument);
    setBody(revisionDraft?.body ?? readableDraftText(nextDocument));
  }

  return (
    <div
      className="min-w-0 w-full max-w-full space-y-7 overflow-x-hidden"
      aria-label="Radio update operator desk"
    >
      <header className="border-b border-border pb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Radio update lane
        </p>
        <h2 className="mt-1 text-xl font-semibold">{campaignName}</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Build one reviewed public page, then prepare a concise
          independent-radio email. No audience identity or delivery authority is
          attached.
        </p>
      </header>

      <ol
        aria-label="Radio update sequence"
        className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-3 text-xs sm:grid-cols-5"
      >
        {[
          "Page draft",
          "Page reviewed",
          "Audience preview",
          "Email reviewed",
          "Delivery preview",
        ].map((step, index) => (
          <li
            key={step}
            className={`flex gap-2 ${sequenceTone(step, activeRevision, currentDraft)}`}
          >
            <span className="tabular-nums">0{index + 1}</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      {notice && (
        <p role="status" className="border-y border-border py-2 text-xs">
          {notice}
        </p>
      )}

      <section
        aria-labelledby="radio-page-title"
        className="min-w-0 w-full max-w-full space-y-4"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2">
          <div>
            <h3 id="radio-page-title" className="text-sm font-semibold">
              Public page
            </h3>
            <p className="text-xs text-muted-foreground">
              Structured fields only ·{" "}
              {activeRevision
                ? `revision v${activeRevision.version} · ${activeRevision.review_status}`
                : "unsaved"}
            </p>
            {pageDirty && (
              <p className="mt-1 text-xs font-semibold text-amber-700">
                Unsaved page changes · save before review or publication.
              </p>
            )}
          </div>
          {liveRevisionId && (
            <span className="text-xs text-emerald-700">
              Live v{findVersion(revisions, liveRevisionId) ?? "?"}
            </span>
          )}
        </div>
        <div className="grid min-w-0 w-full max-w-full gap-4 md:grid-cols-2">
          <Field label="Slug">
            <Input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              disabled={!canMutate || aiDecisionPending}
            />
          </Field>
          <Field label="Label line">
            <Input
              value={content.label_line}
              onChange={(event) =>
                updateContent("label_line", event.target.value)
              }
              disabled={!canMutate}
            />
          </Field>
          <Field label="Title">
            <Input
              value={content.title}
              onChange={(event) => updateContent("title", event.target.value)}
              disabled={!canMutate}
            />
          </Field>
          <Field label="Contact name">
            <Input
              value={content.contact_name}
              onChange={(event) =>
                updateContent("contact_name", event.target.value)
              }
              disabled={!canMutate}
            />
          </Field>
          <Field label="Contact email">
            <Input
              type="email"
              value={content.contact_email}
              onChange={(event) =>
                updateContent("contact_email", event.target.value)
              }
              disabled={!canMutate}
            />
          </Field>
          <Field label="Listen URL">
            <Input
              type="url"
              value={content.listen_url}
              onChange={(event) =>
                updateContent("listen_url", event.target.value)
              }
              disabled={!canMutate}
            />
          </Field>
          <Field label="Download URL (optional)">
            <Input
              type="url"
              value={content.download_url ?? ""}
              onChange={(event) =>
                updateContent("download_url", event.target.value || null)
              }
              disabled={!canMutate}
            />
          </Field>
          <Field label="Metadata URL (optional)">
            <Input
              type="url"
              value={content.metadata_url ?? ""}
              onChange={(event) =>
                updateContent("metadata_url", event.target.value || null)
              }
              disabled={!canMutate}
            />
          </Field>
        </div>
        <CampaignRichTextEditor
          id="campaign-public-release-note"
          label="Release note"
          value={content.release_note_document}
          baselineKey={
            activeRevision
              ? `public-release-note:${activeRevision.id}`
              : `public-release-note:new:${campaignId}`
          }
          maxCharacters={20_000}
          readOnly={!canMutate || radioBodyDecisionPending}
          aiAvailable={
            canMutate && hasReviewedActiveRevision && !radioBodyDecisionPending
          }
          aiAssist={
            hasReviewedActiveRevision && activeRevision
              ? {
                  campaignId,
                  surface: "public_release_note",
                  references: {
                    lead_id: null,
                    draft_id: null,
                    page_revision_id: activeRevision.id,
                  },
                }
              : undefined
          }
          onAiDecisionPending={setReleaseNoteDecisionPending}
          onChange={(document, derived) =>
            setContent((current) => ({
              ...current,
              release_note_document: document,
              release_note: derived.plainText,
            }))
          }
        />
        <div className="grid min-w-0 w-full max-w-full gap-4 md:grid-cols-2">
          <Field label="Approved linked-release artwork">
            <NativeSelect
              value={content.artwork_asset_id}
              onChange={(event) =>
                updateContent("artwork_asset_id", event.target.value)
              }
              disabled={!canMutate}
            >
              <option value="">Choose approved artwork</option>
              {initialData.artwork_options.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.asset_name}
                  {asset.version ? ` · ${asset.version}` : ""}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <fieldset>
            <legend className="mb-1 block text-xs font-semibold">
              Focus tracks
            </legend>
            <div className="divide-y divide-border border-y border-border">
              {initialData.tracks.map((track) => (
                <Label
                  key={track.id}
                  className="flex gap-2 py-2 text-sm font-normal"
                >
                  <Checkbox
                    checked={content.focus_track_ids.includes(track.id)}
                    onCheckedChange={() =>
                      updateContent(
                        "focus_track_ids",
                        content.focus_track_ids.includes(track.id)
                          ? content.focus_track_ids.filter(
                              (id) => id !== track.id,
                            )
                          : [...content.focus_track_ids, track.id],
                      )
                    }
                    disabled={!canMutate}
                  />
                  {track.title}
                </Label>
              ))}
              {!initialData.tracks.length && (
                <p className="py-2 text-xs text-muted-foreground">
                  No linked release tracks.
                </p>
              )}
            </div>
          </fieldset>
        </div>
        <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
          Network statement:{" "}
          <span className="font-medium text-foreground">
            Shared with our independent radio network.
          </span>
        </p>
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <Field label="Owner publish confirmation">
            <Input
              value={publishConfirmation}
              onChange={(event) => setPublishConfirmation(event.target.value)}
              placeholder="Type publish"
              disabled={!canPublish}
            />
          </Field>
          <Field label="Owner unpublish confirmation">
            <Input
              value={unpublishConfirmation}
              onChange={(event) => setUnpublishConfirmation(event.target.value)}
              placeholder="Type unpublish"
              disabled={!canPublish}
            />
          </Field>
        </div>
        <div className="flex min-w-0 w-full max-w-full flex-wrap gap-2">
          <Button
            type="button"
            onClick={savePage}
            disabled={!canMutate || busy !== null || aiDecisionPending}
          >
            {busy === "page" ? "Saving…" : "Save page draft"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={reviewPage}
            disabled={
              !canMutate ||
              busy !== null ||
              !activeRevision ||
              pageDirty ||
              aiDecisionPending
            }
          >
            {busy === "review" ? "Reviewing…" : "Mark page reviewed"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={publishPage}
            disabled={
              !canPublish ||
              busy !== null ||
              activeRevision?.review_status !== "reviewed" ||
              pageDirty ||
              aiDecisionPending
            }
          >
            {busy === "publish"
              ? "Publishing…"
              : canPublish
                ? "Publish (owner)"
                : "Owner publish only"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={unpublishPage}
            disabled={
              !canPublish ||
              busy !== null ||
              pageState?.status !== "published" ||
              aiDecisionPending
            }
          >
            {busy === "unpublish" ? "Unpublishing…" : "Unpublish (owner)"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {revisions.length > 0 && (
            <Label className="font-normal">
              Revision{" "}
              <NativeSelect
                size="sm"
                className="ml-1 w-auto"
                value={activeRevision?.id ?? ""}
                disabled={pageDirty || emailDirty || aiDecisionPending}
                onChange={(event) => {
                  const revision = revisions.find(
                    (candidate) => candidate.id === event.target.value,
                  );
                  if (revision) selectRevision(revision);
                }}
              >
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    v{revision.version} · {revision.review_status}
                  </option>
                ))}
              </NativeSelect>
            </Label>
          )}
          {(pageDirty || emailDirty) && (
            <span className="text-amber-700">
              Save current edits before switching revisions.
            </span>
          )}
          {activeRevision?.id === liveRevisionId &&
            pageState?.status === "published" &&
            pageState.slug &&
            (aiDecisionPending ? (
              <span className="font-medium text-muted-foreground">
                Open live page locked while deciding
              </span>
            ) : (
              <a
                href={`/press/${encodeURIComponent(pageState.slug)}`}
                className="font-medium text-emerald-700 underline"
              >
                Open live page
              </a>
            ))}
          {activeRevision?.review_status === "reviewed" &&
            activeRevision.id !== liveRevisionId && (
              <span className="text-muted-foreground">
                Reviewed preview is available in this editor; it is not public.
              </span>
            )}
        </div>
        {preview && (
          <div
            aria-label="Authenticated preview · not public"
            className="mt-4 w-full max-w-full overflow-hidden rounded border border-border"
          >
            <p className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-semibold">
              Preview · not public · reviewed revision
            </p>
            <FountainRadioUpdatePage page={{ ...preview, preview: true }} />
          </div>
        )}
      </section>

      <section
        aria-labelledby="radio-email-title"
        className="min-w-0 w-full max-w-full space-y-4 border-t border-border pt-5"
      >
        <div className="border-b border-border pb-2">
          <h3 id="radio-email-title" className="text-sm font-semibold">
            Radio email draft
          </h3>
          <p className="text-xs text-muted-foreground">
            Recipient target: Independent radio network · no personalization ·
            no delivery control
          </p>
        </div>
        {repairRequired && !repairingDraft ? (
          <div role="alert" className="border border-amber-700 p-2 text-xs">
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
                }
              }}
              disabled={!canMutate || busy !== null}
            >
              Repair and edit draft
            </Button>
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <Field label="Subject">
            <Input
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={draftReadOnly}
            />
          </Field>
          {currentDraft ? null : (
            <Field label="Operator instruction (optional)">
              <Input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                disabled={!canMutate}
              />
            </Field>
          )}
        </div>
        <CampaignRichTextEditor
          id="campaign-radio-email-body"
          label="Radio email body"
          value={bodyDocument}
          baselineKey={`radio-body:${currentDraft?.id ?? `new:${campaignId}`}:revision:${activeRevision?.id ?? "none"}`}
          maxCharacters={10_000}
          readOnly={draftReadOnly}
          aiAvailable={
            !draftReadOnly && Boolean(currentDraft && hasReviewedActiveRevision)
          }
          aiAssist={
            currentDraft && hasReviewedActiveRevision && activeRevision
              ? {
                  campaignId,
                  surface: "radio_update_body",
                  references: {
                    lead_id: null,
                    draft_id: currentDraft.id,
                    page_revision_id: activeRevision.id,
                  },
                }
              : undefined
          }
          onAiDecisionPending={setRadioBodyDecisionPending}
          onChange={(document, derived) => {
            setBodyDocument(document);
            setBody(derived.plainText);
          }}
        />
        <div className="flex flex-wrap gap-2">
          {currentDraft ? null : (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={generateRadioDraft}
                disabled={
                  !canMutate ||
                  busy !== null ||
                  aiDecisionPending ||
                  !hasReviewedActiveRevision
                }
              >
                {busy === "generate"
                  ? "Creating…"
                  : "Create saved first radio version"}
              </Button>
              <p className="mt-1 text-xs text-muted-foreground">
                Creates a persisted radio draft version for manual review; it
                does not deliver email.
              </p>
            </div>
          )}
          <Button
            type="button"
            onClick={saveRadioDraft}
            disabled={
              !canMutate ||
              busy !== null ||
              aiDecisionPending ||
              !hasReviewedActiveRevision ||
              !body.trim() ||
              (repairRequired && (!repairingDraft || !repairIsAuthorable))
            }
          >
            {busy === "draft" ? "Saving…" : "Save manual version"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={approveRadioDraft}
            disabled={
              !canMutate ||
              busy !== null ||
              aiDecisionPending ||
              !hasReviewedActiveRevision ||
              !currentDraft ||
              !body.trim() ||
              emailDirty ||
              repairRequired
            }
          >
            {busy === "approve" ? "Approving…" : "Approve email draft"}
          </Button>
        </div>
        {emailDirty && (
          <p className="text-xs font-semibold text-amber-700">
            Unsaved email changes · save a new version before approval.
          </p>
        )}
        <Field label="Approval confirmation">
          <Input
            value={approveConfirmation}
            onChange={(event) => setApproveConfirmation(event.target.value)}
            placeholder="Type approve"
            disabled={!canMutate}
          />
        </Field>
        {currentDraft && (
          <p className="text-xs text-muted-foreground">
            Draft v{currentDraft.version} · {currentDraft.status} · page
            revision{" "}
            {String(
              currentDraft.context_snapshot.page_revision_id ?? "unknown",
            )}
          </p>
        )}
      </section>

      <section
        aria-labelledby="radio-audience-title"
        className="min-w-0 w-full max-w-full border-t border-border pt-5"
      >
        <h3 id="radio-audience-title" className="text-sm font-semibold">
          Audience preview
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Independent-radio target only. No station, contact, or audience rows
          are loaded into this lane.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Dogfood context: page revision{" "}
          <span className="font-medium text-foreground">
            {latestRevision ?? "none"}
          </span>{" "}
          · radio draft{" "}
          <span className="font-medium text-foreground">
            {currentDraft?.id ?? "none"}
          </span>
        </p>
        {onDogfood && (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="mt-3 h-auto p-0 underline"
            onClick={() =>
              onDogfood({
                draftId: currentDraft?.id ?? null,
                pageRevisionId: latestRevision,
              })
            }
            disabled={!canMutate || aiDecisionPending}
          >
            Log radio lane finding
          </Button>
        )}
      </section>
    </div>
  );
}
function parseContent(value: unknown) {
  const parsed = campaignPublicPageContentSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...EMPTY_CONTENT };
}

function sequenceTone(
  step: string,
  revision: Revision | null,
  draft: Draft | null,
) {
  if (step === "Page reviewed" && revision?.review_status === "reviewed")
    return "font-medium text-emerald-700";
  if (step === "Email reviewed" && draft?.status === "approved")
    return "font-medium text-emerald-700";
  if (step === "Page draft" && revision) return "font-medium text-foreground";
  return "text-muted-foreground";
}

function findVersion(revisions: readonly Revision[], id: string) {
  return revisions.find((revision) => revision.id === id)?.version ?? null;
}

function normalizeText(value: string) {
  return value.replace(/\r\n?/g, "\n").trim();
}

function draftDocument(draft: Draft | null | undefined): CampaignDocument {
  try {
    return deriveCampaignDocument(
      draft?.body_document ?? legacyTextToCampaignDocument(draft?.body ?? ""),
      10_000,
    ).document;
  } catch {
    return legacyTextToCampaignDocument(draft?.body ?? "");
  }
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

function documentHash(document: CampaignDocument) {
  return JSON.stringify(document);
}

function canonicalContent(value: unknown) {
  const parsed = campaignPublicPageContentSchema.safeParse(value);
  return parsed.success ? stableStringify(parsed.data) : "invalid";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function isPreviewProjection(value: unknown): value is PublicPageProjection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PublicPageProjection>;
  return Boolean(
    candidate.content &&
      Array.isArray(candidate.tracks) &&
      typeof candidate.artworkUrl === "string",
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="block text-xs font-semibold">
      {label}
      <span className="mt-1 block">{children}</span>
    </Label>
  );
}

async function apiRequest<T>(
  url: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => null)) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok)
    throw new Error(
      payload?.error ||
        payload?.message ||
        `Request failed (${response.status})`,
    );
  return payload;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
