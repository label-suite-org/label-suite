import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { handleApiError, json, parseJson } from "../../../server/api";
import { getCampaignAudienceForCampaign, type CampaignAudienceSelection } from "../../../server/campaign-audiences";
import type { CampaignContentSourceReferences } from "../../../server/campaign-content";
import { normalizeSourceReferences } from "../../../server/campaign-content";
import { HttpError } from "../../../server/errors";
import { requireCapability } from "../../../server/tenant";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { resolveTemplatePlaceholders } from "../../../server/campaign-templates";
import { isCampaignPublicPageRevisionFresh } from "../../../server/campaign-public-page";
import { hashDraftContent, normalizeCampaignDraftBody } from "../../../server/campaign-communicator";
import { isCampaignPublicPageContentHashValid } from "../../../server/campaign-public-page-core";
import { getCampaignEmailProvider, sendEmailThroughCampaignProvider } from "../../../server/email";
import { db } from "../../../lib/db";
import { artists, campaign_audiences, campaign_outreach_drafts, campaign_public_page_revisions, campaign_public_pages, campaign_stations, campaigns, documents, email_logs, email_templates, media_assets, radio_stations, releases } from "../../../db/schema";

export const prerender = false;

const BATCH_COMPLIANCE_BLOCKER = {
  code: "batch_compliance_unavailable" as const,
  message: "Batch compliance is unavailable until suppression and unsubscribe controls are reviewed",
};

const sendCommonSchema = z.object({
  station_ids: z.array(z.string()).min(1, "Select at least one station"),
  campaign_id: z.string().optional(),
  template_id: z.string().optional(),
  sender_email: z.string().email().optional(),
});
const sendSchema = z.union([
  sendCommonSchema.extend({
    radio_update: z.literal(true),
    campaign_id: z.string().min(1, "Campaign is required"),
    subject: z.string().optional(),
    body: z.string().optional(),
    preview_only: z.boolean().optional(),
  }),
  sendCommonSchema.extend({
    radio_update: z.literal(false).optional(),
    subject: z.string().min(1, "Subject is required"),
    body: z.string().min(1, "Body is required"),
    preview_only: z.boolean().optional(),
  }),
]);

type DeliveryBlocker = { code: "batch_compliance_unavailable" | "reviewed_radio_email_required" | "reviewed_public_page_required" | "saved_audience_required" | "radio_email_placeholders"; message: string };

interface SendTemplateRecord {
  id: string;
  review_status: string;
  source_version: number | null;
  current_version: number;
  source_references: CampaignContentSourceReferences;
}

interface CampaignSendContext {
  id: string;
  campaign_name: string;
  linked_release_id: string | null;
  linked_artist_id: string | null;
  release_title: string | null;
  release_status: string | null;
  artist_name: string | null;
  campaign_audience_id: string | null;
  campaign_audience_name: string | null;
  content_provider: string | null;
  content_operator_id: string | null;
  reviewed_template_id: string | null;
  content_source_version: number | null;
  content_source_references: CampaignContentSourceReferences;
}

interface DeliveryRecipientPreview {
  station_id: string;
  station_name: string;
  recipient_name: string;
  email: string;
  status: "ready" | "skipped";
  error?: string;
  preview_subject: string;
  preview_body: string;
}

interface AudienceStationScope {
  included_station_ids: Set<string>;
  excluded_station_reasons: Map<string, string>;
}

interface GovernedRadioContent {
  draft: { id: string; version: number; approval_hash: string | null; subject: string; body: string } | null;
  page: { id: string; version: number; content_hash: string; status: "reviewed" | "published"; slug: string | null } | null;
  copy_has_placeholders: boolean;
}

function isAdditiveSchemaUnavailable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = value.code ?? value.cause?.code;
  const message = (value.message ?? value.cause?.message ?? "").toLowerCase();
  const additiveRelation = /campaign_outreach_drafts|campaign_public_page_revisions|campaign_public_pages/.test(message);
  const additiveColumn = /approval_hash|body_document|context_snapshot|content_hash|current_published_revision_id|current_draft_revision_id|page_id/.test(message);
  return (code === "42P01" && additiveRelation) || (code === "42703" && additiveRelation && additiveColumn);
}

export function isPublicPageContentHashValid(content: unknown, contentHash: string | null | undefined) {
  return isCampaignPublicPageContentHashValid(content, contentHash);
}

export function hasRadioPlaceholderTokens(subject: string, body: string) {
  return /{{[^}]+}}/.test(`${subject} ${body}`);
}

async function validateTemplateForSend(orgId: string, templateId: string) {
  const rows = await db
    .select({
      id: email_templates.id,
      review_status: email_templates.review_status,
      source_version: email_templates.source_version,
      current_version: email_templates.current_version,
      source_references: email_templates.source_references,
    })
    .from(email_templates)
    .where(and(eq(email_templates.org_id, orgId), eq(email_templates.id, templateId)));

  const template = rows[0];
  if (!template) {
    throw new HttpError("Template not found", 404);
  }

  if (template.review_status !== "reviewed") {
    throw new HttpError("Template is not reviewed", 409);
  }

  if (template.source_version == null || template.source_version !== template.current_version) {
    throw new HttpError("Template is stale and requires re-review", 409);
  }

  return {
    ...template,
    source_references: normalizeSourceReferences(template.source_references),
  } satisfies SendTemplateRecord;
}

async function resolveGovernedRadioContent(orgId: string, campaignId: string): Promise<GovernedRadioContent> {
  try {
    const draftRows = await db
      .select({
        id: campaign_outreach_drafts.id,
        version: campaign_outreach_drafts.version,
        approval_hash: campaign_outreach_drafts.approval_hash,
        subject: campaign_outreach_drafts.subject,
        body: campaign_outreach_drafts.body,
        body_document: campaign_outreach_drafts.body_document,
        context_snapshot: campaign_outreach_drafts.context_snapshot,
      })
      .from(campaign_outreach_drafts)
      .where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
        eq(campaign_outreach_drafts.scope, "radio_update"),
        isNull(campaign_outreach_drafts.lead_id),
        eq(campaign_outreach_drafts.status, "approved"),
      ));
    const draft = [...draftRows].sort((left, right) => right.version - left.version).find((row) => {
      if (typeof row.subject !== "string" || !row.subject.trim() || typeof row.body !== "string" || !row.body.trim() || typeof row.approval_hash !== "string" || !row.approval_hash.trim()) return false;
      try {
        return hashDraftContent(row.subject, row.body_document ?? row.body) === row.approval_hash;
      } catch {
        return false;
      }
    });
    if (!draft) return { draft: null, page: null, copy_has_placeholders: false };

    const snapshot = draft.context_snapshot && typeof draft.context_snapshot === "object"
      ? draft.context_snapshot as Record<string, unknown>
      : {};
    const pageRevisionId = typeof snapshot.page_revision_id === "string" ? snapshot.page_revision_id : null;
    const normalizedDraft = normalizeCampaignDraftBody({ body_document: draft.body_document ?? undefined, body: draft.body }, 20_000);
    if (!pageRevisionId) return {
      draft: { id: draft.id, version: draft.version, approval_hash: draft.approval_hash, subject: draft.subject!.trim(), body: normalizedDraft.body },
      page: null,
      copy_has_placeholders: hasRadioPlaceholderTokens(draft.subject!, normalizedDraft.body),
    };

    const pageRows = await db
      .select({
        id: campaign_public_page_revisions.id,
        version: campaign_public_page_revisions.version,
        content_hash: campaign_public_page_revisions.content_hash,
        content: campaign_public_page_revisions.content,
        review_status: campaign_public_page_revisions.review_status,
        page_id: campaign_public_page_revisions.page_id,
        page_status: campaign_public_pages.status,
        slug: campaign_public_pages.slug,
        current_published_revision_id: campaign_public_pages.current_published_revision_id,
      })
      .from(campaign_public_page_revisions)
      .innerJoin(campaign_public_pages, eq(campaign_public_pages.id, campaign_public_page_revisions.page_id))
      .where(and(
        eq(campaign_public_page_revisions.id, pageRevisionId),
        eq(campaign_public_page_revisions.org_id, orgId),
        eq(campaign_public_pages.org_id, orgId),
        eq(campaign_public_pages.campaign_id, campaignId),
        eq(campaign_public_page_revisions.review_status, "reviewed"),
      ));
    const pageRow = pageRows[0];
    const snapshotVersion = typeof snapshot.page_revision_version === "number" ? snapshot.page_revision_version : null;
    const snapshotHash = typeof snapshot.page_content_hash === "string" ? snapshot.page_content_hash : null;
    const contentHashMatches = isPublicPageContentHashValid(pageRow?.content, pageRow?.content_hash);
    const snapshotMatches = snapshotVersion === pageRow?.version && snapshotHash === pageRow?.content_hash && contentHashMatches;
    const fresh = pageRow && snapshotMatches ? await isCampaignPublicPageRevisionFresh(orgId, campaignId, pageRow.id) : false;
    const page = pageRow && pageRow.content_hash && snapshotMatches && fresh
      ? {
          id: pageRow.id,
          version: pageRow.version,
          content_hash: pageRow.content_hash,
          status: pageRow.current_published_revision_id === pageRow.id && pageRow.page_status === "published" ? "published" as const : "reviewed" as const,
          slug: pageRow.slug,
        }
      : null;
    return {
      draft: { id: draft.id, version: draft.version, approval_hash: draft.approval_hash, subject: draft.subject!.trim(), body: normalizedDraft.body },
      page,
      copy_has_placeholders: hasRadioPlaceholderTokens(draft.subject!, normalizedDraft.body),
    };
  } catch (error) {
    if (isAdditiveSchemaUnavailable(error)) {
      // Older installations may not have the additive radio-update tables yet.
      return { draft: null, page: null, copy_has_placeholders: false };
    }
    throw error;
  }
}

async function hasPersistedRadioLane(orgId: string, campaignId: string): Promise<boolean> {
  try {
    const pageRows = await db
      .select({ id: campaign_public_pages.id, org_id: campaign_public_pages.org_id, campaign_id: campaign_public_pages.campaign_id })
      .from(campaign_public_pages)
      .where(and(eq(campaign_public_pages.org_id, orgId), eq(campaign_public_pages.campaign_id, campaignId)));
    if (pageRows.some((row) => row.id && (row.org_id == null || row.org_id === orgId) && (row.campaign_id == null || row.campaign_id === campaignId))) return true;
  } catch (error) {
    if (!isAdditiveSchemaUnavailable(error)) throw error;
  }

  try {
    const draftRows = await db
      .select({ id: campaign_outreach_drafts.id, org_id: campaign_outreach_drafts.org_id, campaign_id: campaign_outreach_drafts.campaign_id, lead_id: campaign_outreach_drafts.lead_id })
      .from(campaign_outreach_drafts)
      .where(and(
        eq(campaign_outreach_drafts.org_id, orgId),
        eq(campaign_outreach_drafts.campaign_id, campaignId),
        eq(campaign_outreach_drafts.scope, "radio_update"),
        isNull(campaign_outreach_drafts.lead_id),
      ));
    return draftRows.some((row) => row.id && (row.org_id == null || row.org_id === orgId) && (row.campaign_id == null || row.campaign_id === campaignId) && (row.lead_id == null));
  } catch (error) {
    if (isAdditiveSchemaUnavailable(error)) return false;
    throw error;
  }
}

function deduplicateRecipientPreviews(recipients: DeliveryRecipientPreview[]) {
  const seenEmails = new Set<string>();
  return [...recipients].sort((left, right) => {
    const leftKey = `${left.email.trim().toLowerCase()}:${left.station_id}`;
    const rightKey = `${right.email.trim().toLowerCase()}:${right.station_id}`;
    return leftKey.localeCompare(rightKey);
  }).map((recipient) => {
    if (recipient.status !== "ready") return recipient;
    const normalizedEmail = recipient.email.trim().toLowerCase();
    if (!normalizedEmail || seenEmails.has(normalizedEmail)) {
      return {
        ...recipient,
        status: "skipped" as const,
        error: normalizedEmail ? "Duplicate recipient email" : recipient.error,
      };
    }
    seenEmails.add(normalizedEmail);
    return recipient;
  });
}

function buildPreviewHash(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function hashAudiencePreview(preview: CampaignAudienceSelection["preview"] | null) {
  if (!preview) return null;
  return {
    audience_id: preview.audience_id,
    counts: preview.counts,
    included_stations: [...preview.included_stations].sort((a, b) => a.id.localeCompare(b.id)),
    excluded_stations: [...preview.excluded_stations].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function sourceReferencesMatch(left: CampaignContentSourceReferences, right: CampaignContentSourceReferences) {
  return JSON.stringify(normalizeSourceReferences(left)) === JSON.stringify(normalizeSourceReferences(right));
}

function assertCampaignTemplateSelection(
  campaign: CampaignSendContext,
  templateId: string,
  template: SendTemplateRecord,
) {
  if (campaign.reviewed_template_id !== templateId) {
    throw new HttpError("Campaign reviewed template selection is out of sync and requires re-save", 409);
  }

  if (campaign.content_source_version == null || campaign.content_source_version !== template.source_version) {
    throw new HttpError("Campaign reviewed template version is stale and requires re-save", 409);
  }

  if (!sourceReferencesMatch(campaign.content_source_references, template.source_references)) {
    throw new HttpError("Campaign reviewed source references are stale and require re-save", 409);
  }
}

async function collectCampaignPlaceholderValues(
  orgId: string,
  campaign: CampaignSendContext,
): Promise<Record<string, string>> {
  const refs = normalizeSourceReferences(campaign.content_source_references);
  const releaseId = refs.release_id ?? campaign.linked_release_id;
  const artistId = refs.artist_id ?? campaign.linked_artist_id;

  const [releaseRows, artistRows, documentRows, mediaRows] = await Promise.all([
    releaseId
      ? db
          .select({ title: releases.title, status: releases.status })
          .from(releases)
          .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)))
      : Promise.resolve([]),
    artistId
      ? db
          .select({ name: artists.name })
          .from(artists)
          .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)))
      : Promise.resolve([]),
    refs.document_ids.length
      ? db
          .select({ name: documents.name, created_at: documents.created_at })
          .from(documents)
          .where(and(eq(documents.org_id, orgId), inArray(documents.id, refs.document_ids)))
      : Promise.resolve([]),
    refs.media_asset_ids.length
      ? db
          .select({ name: media_assets.asset_name, created_at: media_assets.created_at })
          .from(media_assets)
          .where(and(eq(media_assets.org_id, orgId), inArray(media_assets.id, refs.media_asset_ids)))
      : Promise.resolve([]),
  ]);

  const firstDocument = [...documentRows]
    .sort((left, right) => {
      const leftTime = left.created_at?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = right.created_at?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    })[0];
  const firstMediaAsset = [...mediaRows]
    .sort((left, right) => {
      const leftTime = left.created_at?.getTime() ?? Number.POSITIVE_INFINITY;
      const rightTime = right.created_at?.getTime() ?? Number.POSITIVE_INFINITY;
      return leftTime - rightTime;
    })[0];

  return {
    campaign_name: campaign.campaign_name,
    release_title: releaseRows[0]?.title ?? campaign.release_title ?? "",
    release_status: releaseRows[0]?.status ?? campaign.release_status ?? "",
    release_id: releaseId ?? "",
    artist_name: artistRows[0]?.name ?? campaign.artist_name ?? "",
    artist_id: artistId ?? "",
    document_name: firstDocument?.name ?? "",
    media_asset_name: firstMediaAsset?.name ?? "",
  };
}

async function buildRecipientPreviews(
  orgId: string,
  stationIds: string[],
  payload: z.infer<typeof sendSchema>,
  campaignContext: CampaignSendContext | null,
  campaignValues: Record<string, string> | null,
  audienceStationScope: AudienceStationScope | null,
  exactContent: { subject: string; body: string } | null = null,
  radioMode = false,
) {
  const recipients: DeliveryRecipientPreview[] = [];
  const ledgerSubject = radioMode ? exactContent?.subject ?? "" : payload.subject ?? "";
  const ledgerBody = radioMode ? exactContent?.body ?? "" : payload.body ?? "";

  for (const stationId of stationIds) {
    const stations = await db
      .select({
        id: radio_stations.id,
        email: radio_stations.email,
        name: radio_stations.name,
        dj_name: radio_stations.dj_name,
        call_sign: radio_stations.call_sign,
        city: radio_stations.city,
      })
      .from(radio_stations)
      .where(and(eq(radio_stations.id, stationId), eq(radio_stations.org_id, orgId)));

    const station = stations[0];
    if (!station) {
      recipients.push({
        station_id: stationId,
        station_name: stationId,
        recipient_name: stationId,
        email: "",
        status: "skipped",
        error: "Station unavailable in this workspace",
        preview_subject: ledgerSubject,
        preview_body: ledgerBody,
      });
      continue;
    }

    if (audienceStationScope && !audienceStationScope.included_station_ids.has(station.id)) {
      recipients.push({
        station_id: station.id,
        station_name: station.name,
        recipient_name: station.dj_name || station.name,
        email: station.email ?? "",
        status: "skipped",
        error: audienceStationScope.excluded_station_reasons.get(station.id) ?? "Not included by saved audience targeting",
        preview_subject: ledgerSubject,
        preview_body: ledgerBody,
      });
      continue;
    }

    if (!station.email) {
      recipients.push({
        station_id: stationId,
        station_name: station.name,
        recipient_name: station.dj_name || station.name,
        email: "",
        status: "skipped",
        error: "No email address",
        preview_subject: ledgerSubject,
        preview_body: ledgerBody,
      });
      continue;
    }

    if (radioMode) {
      if (!exactContent) {
        recipients.push({
          station_id: station.id,
          station_name: station.name,
          recipient_name: station.dj_name || station.name,
          email: station.email,
          status: "skipped",
          error: "Reviewed radio email required",
          preview_subject: "",
          preview_body: "",
        });
      } else {
        recipients.push({
          station_id: station.id,
          station_name: station.name,
          recipient_name: station.dj_name || station.name,
          email: station.email,
          status: "ready",
          preview_subject: exactContent.subject,
          preview_body: exactContent.body,
        });
      }
      continue;
    }

    const vars = {
      station_name: station.name,
      dj_name: station.dj_name ?? "",
      call_sign: station.call_sign ?? "",
      city: station.city ?? "",
      campaign_name: campaignValues?.campaign_name ?? campaignContext?.campaign_name ?? "",
      artist_name: campaignValues?.artist_name ?? campaignContext?.artist_name ?? "",
      release_title: campaignValues?.release_title ?? campaignContext?.release_title ?? "",
      release_id: campaignValues?.release_id ?? campaignContext?.linked_release_id ?? "",
      artist_id: campaignValues?.artist_id ?? campaignContext?.linked_artist_id ?? "",
      document_name: campaignValues?.document_name ?? "",
      media_asset_name: campaignValues?.media_asset_name ?? "",
      release_status: campaignValues?.release_status ?? campaignContext?.release_status ?? "",
    };
    const subjectResolution = resolveTemplatePlaceholders(payload.subject ?? "", vars);
    const bodyResolution = resolveTemplatePlaceholders(payload.body ?? "", vars);
    const missingPlaceholders = Array.from(new Set([
      ...subjectResolution.missingPlaceholders,
      ...bodyResolution.missingPlaceholders,
    ])).sort();

    if (missingPlaceholders.length > 0) {
      recipients.push({
        station_id: station.id,
        station_name: station.name,
        recipient_name: station.dj_name || station.name,
        email: station.email,
        status: "skipped",
        error: `Missing template values: ${missingPlaceholders.join(", ")}`,
        preview_subject: subjectResolution.renderedText,
        preview_body: bodyResolution.renderedText,
      });
      continue;
    }

    recipients.push({
      station_id: station.id,
      station_name: station.name,
      recipient_name: station.dj_name || station.name,
      email: station.email,
      status: "ready",
      preview_subject: subjectResolution.renderedText,
      preview_body: bodyResolution.renderedText,
    });
  }

  return recipients;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, sendSchema);
    const operatorId = typeof locals.user?.id === "string" ? locals.user.id : null;
    if (!operatorId) {
      throw new HttpError("Authenticated operator required", 401);
    }
    if (body.radio_update && !body.preview_only) {
      throw new HttpError(BATCH_COMPLIANCE_BLOCKER.message, 409, BATCH_COMPLIANCE_BLOCKER.code);
    }
    if (body.radio_update && (!body.campaign_id || !body.preview_only)) {
      throw new HttpError("Radio preview requires a campaign and preview_only mode", 400);
    }
    const explicitRadioUpdate = body.radio_update === true;
    let campaignContext = body.campaign_id ? await getCampaignContext(orgId, body.campaign_id) : null;
    if (body.campaign_id && !campaignContext) {
      throw new HttpError("Campaign not found", 404);
    }
    const persistedRadioLane = !explicitRadioUpdate && campaignContext
      ? await hasPersistedRadioLane(orgId, campaignContext.id)
      : false;
    if (persistedRadioLane) {
      throw new HttpError(BATCH_COMPLIANCE_BLOCKER.message, 409, BATCH_COMPLIANCE_BLOCKER.code);
    }
    let preloadedGovernedRadioContent: GovernedRadioContent = { draft: null, page: null, copy_has_placeholders: false };
    const template = explicitRadioUpdate
      ? null
      : body.template_id
        ? await validateTemplateForSend(orgId, body.template_id)
        : null;
    const wantsRadioUpdate = Boolean(campaignContext && explicitRadioUpdate);
    if (wantsRadioUpdate) {
      preloadedGovernedRadioContent = await resolveGovernedRadioContent(orgId, campaignContext!.id);
    }
    if (!wantsRadioUpdate && !preloadedGovernedRadioContent.draft && !template && (!body.subject || !body.body)) {
      throw new HttpError("Reviewed radio email is required", 409, "reviewed_radio_email_required");
    }
    if (template && campaignContext) {
      assertCampaignTemplateSelection(campaignContext, template.id, template);
    }
    const campaignValues = wantsRadioUpdate || !campaignContext ? null : await collectCampaignPlaceholderValues(orgId, campaignContext);
    const campaignAudienceSelection = campaignContext?.campaign_audience_id
      ? await getCampaignAudienceForCampaign(orgId, campaignContext.id)
      : null;
    const audienceStationScope = campaignAudienceSelection
      ? {
          included_station_ids: new Set(campaignAudienceSelection.preview.included_stations.map((station) => station.id)),
          excluded_station_reasons: new Map(
            campaignAudienceSelection.preview.excluded_stations.map((station) => [station.id, station.reason] as const),
          ),
        } satisfies AudienceStationScope
      : wantsRadioUpdate
        ? { included_station_ids: new Set<string>(), excluded_station_reasons: new Map<string, string>() }
        : null;
    const providerId = body.preview_only && campaignContext
      ? campaignContext.content_provider ?? "not_resolved"
      : getCampaignEmailProvider().id;
    const effectivePayload = preloadedGovernedRadioContent.draft
      ? { ...body, subject: preloadedGovernedRadioContent.draft.subject, body: preloadedGovernedRadioContent.draft.body }
      : wantsRadioUpdate
        ? { ...body, subject: "", body: "" }
        : body;
    let previewRecipients = await buildRecipientPreviews(
      orgId,
      body.station_ids,
      effectivePayload,
      campaignContext,
      campaignValues,
      audienceStationScope,
      preloadedGovernedRadioContent.draft && !preloadedGovernedRadioContent.copy_has_placeholders
        ? { subject: preloadedGovernedRadioContent.draft.subject, body: preloadedGovernedRadioContent.draft.body }
        : null,
      wantsRadioUpdate,
    );
    if (wantsRadioUpdate) {
      previewRecipients = deduplicateRecipientPreviews(previewRecipients);
    }
    const governedRadioContent = preloadedGovernedRadioContent;
    // Radio recipients already carry the exact reviewed copy; no station placeholder resolution occurs.

    if (body.preview_only) {
      const firstReadyRecipient = previewRecipients.find((recipient) => recipient.status === "ready");
      const blockers: DeliveryBlocker[] = wantsRadioUpdate
        ? [
            ...(governedRadioContent.draft ? [] : [{ code: "reviewed_radio_email_required" as const, message: "Approve the reviewed leadless radio email before previewing batch delivery" }]),
            ...(governedRadioContent.copy_has_placeholders ? [{ code: "radio_email_placeholders" as const, message: "The approved radio email contains placeholder tokens and must be revised" }] : []),
            ...(governedRadioContent.page ? [] : [{ code: "reviewed_public_page_required" as const, message: "Review the exact radio public-page revision before previewing batch delivery" }]),
            ...(campaignAudienceSelection ? [] : [{ code: "saved_audience_required" as const, message: "Attach a saved audience before previewing radio delivery" }]),
            { code: BATCH_COMPLIANCE_BLOCKER.code, message: BATCH_COMPLIANCE_BLOCKER.message },
          ]
        : [];
      const previewHash = wantsRadioUpdate ? buildPreviewHash({
        campaign_id: campaignContext?.id ?? null,
        audience_id: campaignAudienceSelection?.campaign_audience_id ?? null,
        audience: hashAudiencePreview(campaignAudienceSelection?.preview ?? null),
        recipients: previewRecipients
          .map((recipient) => ({ station_id: recipient.station_id, email: recipient.email.trim().toLowerCase(), status: recipient.status, error: recipient.error ?? null }))
          .sort((a, b) => `${a.email}:${a.station_id}`.localeCompare(`${b.email}:${b.station_id}`)),
        reviewed_email: governedRadioContent.draft
          ? { id: governedRadioContent.draft.id, version: governedRadioContent.draft.version, approval_hash: governedRadioContent.draft.approval_hash, subject: governedRadioContent.draft.subject, body: governedRadioContent.draft.body }
          : null,
        reviewed_page: governedRadioContent.page,
      }) : null;
      return json({
        can_send: false,
        status: "no-send",
        provider: providerId,
        operator_id: operatorId,
        campaign: campaignContext ? {
          id: campaignContext.id,
          name: campaignContext.campaign_name,
        } : null,
        audience: campaignContext ? {
          id: campaignContext.campaign_audience_id,
          name: campaignContext.campaign_audience_name,
        } : null,
        template_id: governedRadioContent.draft?.id ?? body.template_id ?? null,
        ...(wantsRadioUpdate ? {
          reviewed_email: governedRadioContent.draft ? { id: governedRadioContent.draft.id, version: governedRadioContent.draft.version, approval_hash: governedRadioContent.draft.approval_hash } : null,
          reviewed_page: governedRadioContent.page,
          audience_selection: campaignAudienceSelection ? { id: campaignAudienceSelection.campaign_audience_id, name: campaignAudienceSelection.preview.audience_name } : null,
          audience_counts: campaignAudienceSelection?.preview.counts ?? null,
          excluded_stations: campaignAudienceSelection?.preview.excluded_stations ?? [],
          preview_hash: previewHash,
          blockers,
          deduped_count: previewRecipients.filter((recipient) => recipient.status === "skipped" && recipient.error === "Duplicate recipient email").length,
        } : {}),
        preview_subject: firstReadyRecipient?.preview_subject ?? "",
        preview_body: firstReadyRecipient?.preview_body ?? "",
        recipients: previewRecipients,
        ready_count: previewRecipients.filter((recipient) => recipient.status === "ready").length,
        skipped_count: previewRecipients.filter((recipient) => recipient.status === "skipped").length,
      }, 200);
    }

    const results: Array<{ station_id: string; station_name: string; email: string; status: string; error?: string }> = [];

    for (const recipient of previewRecipients) {
      if (recipient.status !== "ready") {
        results.push({
          station_id: recipient.station_id,
          station_name: recipient.station_name,
          email: recipient.email,
          status: "skipped",
          error: recipient.error,
        });
        continue;
      }

      const result = await sendEmailThroughCampaignProvider({
        subject: recipient.preview_subject,
        htmlBody: recipient.preview_body,
        toEmail: recipient.email,
        toName: recipient.recipient_name,
        senderEmail: body.sender_email,
      });

      await db.insert(email_logs).values({
        id: crypto.randomUUID(),
        org_id: orgId,
        campaign_id: body.campaign_id ?? null,
        station_id: recipient.station_id,
        template_id: body.template_id ?? null,
        subject: recipient.preview_subject,
        body: recipient.preview_body,
        status: result.status,
        provider: providerId,
        operator_id: operatorId,
        sender_email: body.sender_email ?? null,
        error_message: result.error ?? null,
        brevo_message_id: result.messageId || null,
      });

      if (body.campaign_id) {
        const now = new Date();
        const followUpAt = new Date(now);
        followUpAt.setDate(now.getDate() + 7);
        await db.insert(campaign_stations).values({
          id: crypto.randomUUID(),
          org_id: orgId,
          campaign_id: body.campaign_id,
          station_id: recipient.station_id,
          status: result.status === "sent" ? "sent" : "selected",
          last_contacted_at: result.status === "sent" ? now : null,
          follow_up_at: result.status === "sent" ? followUpAt : null,
          updated_at: now,
        }).onConflictDoUpdate({
          target: [campaign_stations.org_id, campaign_stations.campaign_id, campaign_stations.station_id],
          set: {
            status: result.status === "sent" ? "sent" : "selected",
            last_contacted_at: result.status === "sent" ? now : null,
            follow_up_at: result.status === "sent" ? followUpAt : null,
            updated_at: now,
          },
        });
      }

      results.push({
        station_id: recipient.station_id,
        station_name: recipient.station_name,
        email: recipient.email,
        status: result.status,
        error: result.error,
      });
    }

    return json({ results, total: results.filter((r) => r.status === "sent").length }, 200);
  } catch (err) {
    if (err instanceof HttpError && err.code) {
      return json({ error: err.message, code: err.code }, err.status);
    }
    return handleApiError(err);
  }
};

async function getCampaignContext(orgId: string, campaignId: string) {
  const rows = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      release_title: releases.title,
      release_status: releases.status,
      artist_name: artists.name,
      campaign_audience_id: campaigns.campaign_audience_id,
      campaign_audience_name: campaign_audiences.name,
      content_provider: campaigns.content_provider,
      content_operator_id: campaigns.content_operator_id,
      reviewed_template_id: campaigns.reviewed_template_id,
      content_source_version: campaigns.content_source_version,
      content_source_references: campaigns.content_source_references,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(campaign_audiences, and(eq(campaigns.campaign_audience_id, campaign_audiences.id), eq(campaign_audiences.org_id, orgId)))
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));

  const campaign = rows[0];
  if (!campaign) return null;

  return {
    ...campaign,
    content_source_references: normalizeSourceReferences(campaign.content_source_references),
  } satisfies CampaignSendContext;
}
