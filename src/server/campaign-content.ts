import { z } from "zod";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../lib/db";
import {
  artists,
  campaigns,
  campaign_audiences,
  documents,
  email_templates,
  media_assets,
  releases,
} from "../db/schema";
import { HttpError } from "./errors";
import { resolveTemplatePlaceholders } from "./campaign-templates";
import { recordAuditEvent } from "./integrations";

export interface CampaignContentSourceReferences {
  release_id: string | null;
  artist_id: string | null;
  document_ids: string[];
  media_asset_ids: string[];
}

export interface CampaignContentTemplateReference {
  id: string;
  name: string;
  subject: string;
  body: string;
  description: string | null;
  is_default: boolean | null;
  channel: string;
  current_version: number;
  review_status: string;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  source_version: number | null;
  source_references: CampaignContentSourceReferences;
}

export interface CampaignContentTemplateSelection {
  reviewed_template_id: string | null;
  template: CampaignContentTemplateReference | null;
  content_channel: string;
  content_provider: string;
  content_operator_id: string | null;
  content_source_version: number | null;
  content_source_references: CampaignContentSourceReferences;
}

export interface CampaignContentCampaign {
  id: string;
  campaign_name: string;
  linked_release_id: string | null;
  linked_artist_id: string | null;
  release_title: string | null;
  release_status: string | null;
  artist_name: string | null;
  campaign_audience_id: string | null;
  campaign_audience_name: string | null;
}

export interface CampaignContentSourceOption {
  id: string;
  name: string;
}

export interface CampaignContentSourceOptions {
  documents: CampaignContentSourceOption[];
  media_assets: CampaignContentSourceOption[];
}

export interface CampaignContentContext {
  campaign: CampaignContentCampaign;
  templates: CampaignContentTemplateReference[];
  selection: CampaignContentTemplateSelection | null;
  source_options: CampaignContentSourceOptions;
}

export type CampaignContentBlockerCode =
  | "template_missing"
  | "template_unreviewed"
  | "version_mismatch"
  | "source_missing"
  | "source_stale"
  | "placeholder_missing";

export interface CampaignContentBlocker {
  code: CampaignContentBlockerCode;
  message: string;
}

export interface CampaignContentPreview {
  can_send: false;
  status: "no-send";
  campaign_id: string;
  template_id: string;
  preview_subject: string;
  preview_body: string;
  blockers: CampaignContentBlocker[];
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
      source_references: CampaignContentSourceReferences;
    };
  };
  template_version: number | null;
  reviewed_version: number | null;
}

export interface CampaignContentSaveResult {
  ok: true;
  revision?: number;
}

export interface CampaignContentWriteOptions {
  expectedRevision?: number;
  audit?: {
    actorUserId: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  };
}

const sourceReferencesSchema = z.object({
  release_id: z.string().nullable().optional(),
  artist_id: z.string().nullable().optional(),
  document_ids: z.array(z.string()).default([]),
  media_asset_ids: z.array(z.string()).default([]),
}).strict();

export const saveCampaignContentPayloadSchema = z.object({
  template_id: z.string().nullable().optional(),
  source_references: sourceReferencesSchema.optional(),
});

export const previewCampaignContentPayloadSchema = saveCampaignContentPayloadSchema.extend({
  operator_id: z.string().nullable().optional(),
});

export const reviewCampaignTemplatePayloadSchema = saveCampaignContentPayloadSchema.extend({
  source_references: sourceReferencesSchema.optional(),
});

export type SaveCampaignContentPayload = z.infer<typeof saveCampaignContentPayloadSchema>;
export type PreviewCampaignContentPayload = z.infer<typeof previewCampaignContentPayloadSchema>;
export type ReviewCampaignTemplatePayload = z.infer<typeof reviewCampaignTemplatePayloadSchema>;

const TEMPLATE_PLACEHOLDER_KEYS = [
  "campaign_name",
  "artist_name",
  "release_title",
  "release_id",
  "artist_id",
  "document_name",
  "media_asset_name",
] as const;

export async function listCampaignContentTemplates(orgId: string, options: { limit?: number } = {}): Promise<CampaignContentTemplateReference[]> {
  const query = db
    .select({
      id: email_templates.id,
      name: email_templates.name,
      subject: email_templates.subject,
      body: email_templates.body,
      description: email_templates.description,
      is_default: email_templates.is_default,
      channel: email_templates.channel,
      current_version: email_templates.current_version,
      review_status: email_templates.review_status,
      reviewed_at: email_templates.reviewed_at,
      reviewed_by: email_templates.reviewed_by,
      source_version: email_templates.source_version,
      source_references: email_templates.source_references,
    })
    .from(email_templates)
    .where(eq(email_templates.org_id, orgId))
    .orderBy(sql`${email_templates.updated_at} desc nulls last`);

  const rows = options.limit === undefined ? await query : await query.limit(options.limit + 1);

  return rows.map((row) => ({
    ...row,
    is_default: row.is_default ?? false,
    reviewed_at: row.reviewed_at ?? null,
    reviewed_by: row.reviewed_by ?? null,
    source_version: row.source_version ?? null,
    source_references: normalizeSourceReferences(row.source_references),
  }));
}

async function getCampaignContentTemplateById(
  orgId: string,
  templateId: string,
): Promise<CampaignContentTemplateReference | null> {
  const rows = await db
    .select({
      id: email_templates.id,
      name: email_templates.name,
      subject: email_templates.subject,
      body: email_templates.body,
      description: email_templates.description,
      is_default: email_templates.is_default,
      channel: email_templates.channel,
      current_version: email_templates.current_version,
      review_status: email_templates.review_status,
      reviewed_at: email_templates.reviewed_at,
      reviewed_by: email_templates.reviewed_by,
      source_version: email_templates.source_version,
      source_references: email_templates.source_references,
    })
    .from(email_templates)
    .where(and(eq(email_templates.org_id, orgId), eq(email_templates.id, templateId)));

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    is_default: row.is_default ?? false,
    reviewed_at: row.reviewed_at ?? null,
    reviewed_by: row.reviewed_by ?? null,
    source_version: row.source_version ?? null,
    source_references: normalizeSourceReferences(row.source_references),
  };
}

async function requireTemplateById(orgId: string, templateId: string): Promise<CampaignContentTemplateReference> {
  const template = await getCampaignContentTemplateById(orgId, templateId);
  if (!template) {
    throw new HttpError("Template not found", 404);
  }
  return template;
}

export async function getCampaignContentContext(orgId: string, campaignId: string, options: { templateLimit?: number; includeSourceOptions?: boolean } = {}): Promise<CampaignContentContext> {
  const campaignRows = await db
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
      reviewed_template_id: campaigns.reviewed_template_id,
      content_channel: campaigns.content_channel,
      content_provider: campaigns.content_provider,
      content_operator_id: campaigns.content_operator_id,
      content_source_version: campaigns.content_source_version,
      content_source_references: campaigns.content_source_references,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .leftJoin(campaign_audiences, and(eq(campaigns.campaign_audience_id, campaign_audiences.id), eq(campaign_audiences.org_id, orgId)))
    .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)));

  const campaign = campaignRows[0];
  if (!campaign) throw new HttpError("Campaign not found", 404);

  const templates = await listCampaignContentTemplates(orgId, { limit: options.templateLimit });
  const sourceOptions = options.includeSourceOptions === false
    ? { documents: [], media_assets: [] }
    : await collectCampaignSourceOptions(orgId, campaign.linked_release_id);
  let selectedTemplate = templates.find((template) => template.id === campaign.reviewed_template_id) ?? null;
  if (!selectedTemplate && campaign.reviewed_template_id) {
    selectedTemplate = await getCampaignContentTemplateById(orgId, campaign.reviewed_template_id);
  }

  return {
    campaign: {
      id: campaign.id,
      campaign_name: campaign.campaign_name,
      linked_release_id: campaign.linked_release_id,
      linked_artist_id: campaign.linked_artist_id,
      release_title: campaign.release_title,
      release_status: campaign.release_status,
      artist_name: campaign.artist_name,
      campaign_audience_id: campaign.campaign_audience_id,
      campaign_audience_name: campaign.campaign_audience_name,
    },
    templates,
    selection: campaign.reviewed_template_id ? {
      reviewed_template_id: campaign.reviewed_template_id,
      template: selectedTemplate,
      content_channel: campaign.content_channel ?? "email",
      content_provider: campaign.content_provider ?? "brevo",
      content_operator_id: campaign.content_operator_id,
      content_source_version: campaign.content_source_version,
      content_source_references: normalizeSourceReferences(campaign.content_source_references),
    } : null,
    source_options: sourceOptions,
  };
}

export async function saveCampaignContentTemplate(
  orgId: string,
  campaignId: string,
  input: SaveCampaignContentPayload,
  operatorId?: string | null,
  options: CampaignContentWriteOptions = {},
): Promise<CampaignContentSaveResult> {
  const payload = saveCampaignContentPayloadSchema.parse(input);

  const campaignRows = await db
    .select({
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
    })
    .from(campaigns)
    .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)));

  const campaign = campaignRows[0];
  if (!campaign) {
    throw new HttpError("Campaign not found", 404);
  }

  if (!payload.template_id) {
    return writeCampaignContentSelection(orgId, campaignId, {
      reviewed_template_id: null,
      content_channel: "email",
      content_provider: "brevo",
      content_operator_id: operatorId ?? null,
      content_source_version: null,
      content_source_references: {
        release_id: campaign.linked_release_id,
        artist_id: campaign.linked_artist_id,
        document_ids: [],
        media_asset_ids: [],
      },
    }, options);
  }

  const templateRows = await db
    .select({
      id: email_templates.id,
      channel: email_templates.channel,
      current_version: email_templates.current_version,
      review_status: email_templates.review_status,
      source_version: email_templates.source_version,
      source_references: email_templates.source_references,
    })
    .from(email_templates)
    .where(and(eq(email_templates.org_id, orgId), eq(email_templates.id, payload.template_id)));

  const template = templateRows[0];
  if (!template) {
    throw new HttpError("Template not found", 404);
  }

  if (template.review_status !== "reviewed") {
    throw new HttpError("Template is not reviewed", 409);
  }

  const requestedRefs = payload.source_references
    ? normalizeSourceReferences(payload.source_references)
    : {
      release_id: campaign.linked_release_id,
      artist_id: campaign.linked_artist_id,
      document_ids: [],
      media_asset_ids: [],
    };

  const sourceOptions = campaign.linked_release_id
    ? await collectCampaignSourceOptions(orgId, campaign.linked_release_id)
    : { documents: [], media_assets: [] };

  const blockers = await evaluateSourceReferences(
    orgId,
    campaign.linked_release_id,
    campaign.linked_artist_id,
    requestedRefs,
    normalizeSourceReferences(template.source_references),
    sourceOptions,
  );

  if (blockers.length > 0) {
    throw new HttpError(blockers[0].message, 409);
  }

  if (template.current_version !== template.source_version) {
    throw new HttpError("Template source version mismatch", 409);
  }

  return writeCampaignContentSelection(orgId, campaignId, {
    reviewed_template_id: payload.template_id,
    content_channel: template.channel,
    content_provider: "brevo",
    content_operator_id: operatorId ?? null,
    content_source_version: template.source_version,
    content_source_references: requestedRefs,
  }, options);
}

async function writeCampaignContentSelection(
  orgId: string,
  campaignId: string,
  selection: {
    reviewed_template_id: string | null;
    content_channel: string;
    content_provider: string;
    content_operator_id: string | null;
    content_source_version: number | null;
    content_source_references: CampaignContentSourceReferences;
  },
  options: CampaignContentWriteOptions,
): Promise<CampaignContentSaveResult> {
  if (options.expectedRevision === undefined && !options.audit) {
    await db
      .update(campaigns)
      .set({ ...selection, revision: sql`${campaigns.revision} + 1`, updated_at: new Date() })
      .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)));
    return { ok: true };
  }
  return db.transaction(async (tx) => {
    const where = [eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)];
    if (options.expectedRevision !== undefined) where.push(eq(campaigns.revision, options.expectedRevision));
    const rows = await tx
      .update(campaigns)
      .set({ ...selection, revision: sql`${campaigns.revision} + 1`, updated_at: new Date() })
      .where(and(...where))
      .returning({ revision: campaigns.revision });
    if (!rows.length) {
      throw new HttpError(options.expectedRevision === undefined ? "Campaign not found" : "Campaign changed; refresh and try again", options.expectedRevision === undefined ? 404 : 409);
    }
    const revision = rows[0]!.revision;
    if (options.audit) {
      await recordAuditEvent(orgId, {
        actor_user_id: options.audit.actorUserId,
        event_type: options.audit.eventType,
        object_type: "campaign",
        object_id: campaignId,
        after: { revision, reviewed_template_id: selection.reviewed_template_id },
        metadata: options.audit.metadata ?? {},
      }, tx);
    }
    return { ok: true, revision };
  });
}

export async function reviewCampaignTemplateForCampaign(
  orgId: string,
  campaignId: string,
  input: ReviewCampaignTemplatePayload,
  operatorId?: string | null,
): Promise<CampaignContentSaveResult> {
  const payload = reviewCampaignTemplatePayloadSchema.parse(input);
  if (!payload.template_id) {
    throw new HttpError("Template is required for review", 400);
  }

  const campaignRows = await db
    .select({
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
    })
    .from(campaigns)
    .where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId)));

  const campaign = campaignRows[0];
  if (!campaign) {
    throw new HttpError("Campaign not found", 404);
  }

  const template = await requireTemplateById(orgId, payload.template_id);
  const requestedRefs = payload.source_references
    ? normalizeSourceReferences(payload.source_references)
    : {
      release_id: campaign.linked_release_id,
      artist_id: campaign.linked_artist_id,
      document_ids: [],
      media_asset_ids: [],
    };

  const sourceOptions = campaign.linked_release_id
    ? await collectCampaignSourceOptions(orgId, campaign.linked_release_id)
    : { documents: [], media_assets: [] };

  const blockers = await evaluateSourceReferences(
    orgId,
    campaign.linked_release_id,
    campaign.linked_artist_id,
    requestedRefs,
    normalizeSourceReferences(template.source_references),
    sourceOptions,
  );

  if (blockers.length > 0) {
    throw new HttpError(blockers[0].message, 409);
  }

  await db
    .update(email_templates)
    .set({
      review_status: "reviewed",
      reviewed_at: new Date(),
      reviewed_by: operatorId ?? null,
      source_version: template.current_version,
      source_references: requestedRefs,
      updated_at: new Date(),
    })
    .where(and(eq(email_templates.org_id, orgId), eq(email_templates.id, template.id)));

  return { ok: true };
}

export async function previewCampaignTemplateContent(
  orgId: string,
  campaignId: string,
  input: PreviewCampaignContentPayload,
): Promise<CampaignContentPreview> {
  const payload = previewCampaignContentPayloadSchema.parse(input);
  const context = await getCampaignContentContext(orgId, campaignId);

  const template = payload.template_id
    ? context.templates.find((candidate) => candidate.id === payload.template_id) ?? null
    : context.selection?.template;

  const requestedRefs = payload.source_references
    ? normalizeSourceReferences(payload.source_references)
    : context.selection?.content_source_references ?? {
      release_id: context.campaign.linked_release_id,
      artist_id: context.campaign.linked_artist_id,
      document_ids: [],
      media_asset_ids: [],
    };

  if (!template) {
    return {
      can_send: false,
      status: "no-send",
      campaign_id: context.campaign.id,
      template_id: payload.template_id ?? context.selection?.reviewed_template_id ?? "",
      preview_subject: "",
      preview_body: "",
      blockers: [{
        code: "template_missing",
        message: "No template selected for this campaign.",
      }],
      provenance: {
        campaign: {
          id: context.campaign.id,
          name: context.campaign.campaign_name,
          linked_release_id: context.campaign.linked_release_id,
          linked_artist_id: context.campaign.linked_artist_id,
          linked_audience_id: context.campaign.campaign_audience_id,
        },
        operator: {
          id: payload.operator_id ?? null,
        },
        provider: context.selection?.content_provider ?? "brevo",
        recipient: {
          audience_id: context.campaign.campaign_audience_id,
          audience_name: context.campaign.campaign_audience_name,
          source_references: requestedRefs,
        },
      },
      template_version: null,
      reviewed_version: null,
    };
  }

  const blockers = [
    ...evaluateTemplateReviewGate(template),
    ...await evaluateSourceReferences(
      orgId,
      context.campaign.linked_release_id,
      context.campaign.linked_artist_id,
      requestedRefs,
      template.source_references,
      context.source_options,
    ),
  ];

  const sourceValues = await collectTemplateSourceValues(orgId, context.campaign, requestedRefs);
  const subject = resolveTemplatePlaceholders(template.subject, sourceValues);
  const body = resolveTemplatePlaceholders(template.body, sourceValues);

  const missingPlaceholders = new Set([...
    subject.missingPlaceholders,
    ...body.missingPlaceholders,
  ]);
  const knownMissing = Array.from(missingPlaceholders)
    .filter((key) => TEMPLATE_PLACEHOLDER_KEYS.includes(key as never))
    .sort();

  if (knownMissing.length > 0) {
    blockers.push({
      code: "placeholder_missing",
      message: `Missing source fields for placeholders: ${knownMissing.join(", ")}`,
    });
  }

  return {
    can_send: false,
    status: "no-send",
    campaign_id: context.campaign.id,
    template_id: template.id,
    preview_subject: subject.renderedText,
    preview_body: body.renderedText,
    blockers,
    provenance: {
      campaign: {
        id: context.campaign.id,
        name: context.campaign.campaign_name,
        linked_release_id: context.campaign.linked_release_id,
        linked_artist_id: context.campaign.linked_artist_id,
        linked_audience_id: context.campaign.campaign_audience_id,
      },
      operator: {
        id: payload.operator_id ?? null,
      },
      provider: context.selection?.content_provider ?? "brevo",
      recipient: {
        audience_id: context.campaign.campaign_audience_id,
        audience_name: context.campaign.campaign_audience_name,
        source_references: requestedRefs,
      },
    },
    template_version: template.current_version,
    reviewed_version: template.source_version,
  };
}

function evaluateTemplateReviewGate(template: CampaignContentTemplateReference): CampaignContentBlocker[] {
  const blockers: CampaignContentBlocker[] = [];

  if (template.review_status !== "reviewed") {
    blockers.push({ code: "template_unreviewed", message: "Template has not been reviewed." });
  }

  if (template.current_version !== template.source_version) {
    blockers.push({
      code: "version_mismatch",
      message: `Template version mismatch (current ${template.current_version}, reviewed ${template.source_version ?? "none"}).`,
    });
  }

  return blockers;
}

async function evaluateSourceReferences(
  orgId: string,
  campaignReleaseId: string | null,
  campaignArtistId: string | null,
  requested: CampaignContentSourceReferences,
  required: CampaignContentSourceReferences,
  sourceOptions: CampaignContentSourceOptions,
): Promise<CampaignContentBlocker[]> {
  const blockers: CampaignContentBlocker[] = [];
  const sourceRelease = requested.release_id ?? campaignReleaseId;
  const sourceArtist = requested.artist_id ?? campaignArtistId;

  if (!sourceRelease) {
    blockers.push({ code: "source_missing", message: "Linked release is required for content sourcing." });
  }

  if (sourceRelease && !(await releaseExists(orgId, sourceRelease))) {
    blockers.push({ code: "source_missing", message: "Selected release is missing in this workspace." });
  }

  if (sourceArtist && !(await artistExists(orgId, sourceArtist))) {
    blockers.push({ code: "source_missing", message: "Selected artist is missing in this workspace." });
  }

  if (campaignReleaseId && sourceRelease && sourceRelease !== campaignReleaseId) {
    blockers.push({
      code: "source_stale",
      message: "Source release does not match campaign-linked release.",
    });
  }

  if (campaignArtistId && sourceArtist && sourceArtist !== campaignArtistId) {
    blockers.push({
      code: "source_stale",
      message: "Source artist does not match campaign-linked artist.",
    });
  }

  const requestedDocumentIds = uniqSorted(requested.document_ids);
  const requestedMediaAssetIds = uniqSorted(requested.media_asset_ids);
  const requiredDocumentIds = uniqSorted(required.document_ids);
  const requiredMediaAssetIds = uniqSorted(required.media_asset_ids);

  if (!sameIdSet(requestedDocumentIds, requiredDocumentIds)) {
    blockers.push({
      code: "source_stale",
      message: "Source document references do not match template-reviewed references.",
    });
  }

  if (!sameIdSet(requestedMediaAssetIds, requiredMediaAssetIds)) {
    blockers.push({
      code: "source_stale",
      message: "Source media asset references do not match template-reviewed references.",
    });
  }

  if (sourceRelease) {
    const releaseId = campaignReleaseId ? requested.release_id || campaignReleaseId : "";
    const verifiedDocumentIds = await existingDocumentIds(orgId, releaseId, requested.document_ids);
    const verifiedMediaIds = await existingMediaAssetIds(orgId, releaseId, requested.media_asset_ids);

    if (uniqSorted(requested.document_ids).some((id) => !verifiedDocumentIds.includes(id))) {
      blockers.push({ code: "source_missing", message: "Some selected documents are missing in this workspace." });
    }

    if (uniqSorted(requested.media_asset_ids).some((id) => !verifiedMediaIds.includes(id))) {
      blockers.push({ code: "source_missing", message: "Some selected media assets are missing in this workspace." });
    }

    if (requested.document_ids.some((id) => !sourceOptions.documents.some((option) => option.id === id))) {
      blockers.push({
        code: "source_missing",
        message: "Some selected documents are outside this campaign source context.",
      });
    }

    if (requested.media_asset_ids.some((id) => !sourceOptions.media_assets.some((option) => option.id === id))) {
      blockers.push({
        code: "source_missing",
        message: "Some selected media assets are outside this campaign source context.",
      });
    }
  }

  return blockers;
}

async function collectCampaignSourceOptions(
  orgId: string,
  releaseId: string | null,
): Promise<CampaignContentSourceOptions> {
  if (!releaseId) {
    return { documents: [], media_assets: [] };
  }

  const [documentsRows, mediaRows] = await Promise.all([
    db
      .select({ id: documents.id, name: documents.name })
      .from(documents)
      .where(and(eq(documents.org_id, orgId), eq(documents.release_id, releaseId)))
      .orderBy(desc(documents.created_at)),
    db
      .select({ id: media_assets.id, name: media_assets.asset_name })
      .from(media_assets)
      .where(and(eq(media_assets.org_id, orgId), eq(media_assets.linked_release_id, releaseId)))
      .orderBy(desc(media_assets.created_at)),
  ]);

  return {
    documents: documentsRows.map((row) => ({ id: row.id, name: row.name })),
    media_assets: mediaRows.map((row) => ({ id: row.id, name: row.name })),
  };
}

async function collectTemplateSourceValues(
  orgId: string,
  campaign: CampaignContentCampaign,
  refs: CampaignContentSourceReferences,
): Promise<Record<string, string>> {
  const sourceReleaseId = refs.release_id ?? campaign.linked_release_id;
  const sourceArtistId = refs.artist_id ?? campaign.linked_artist_id;

  const [releaseRows, artistRows, documentRows, mediaRows] = await Promise.all([
    sourceReleaseId
      ? db
          .select({ title: releases.title, status: releases.status })
          .from(releases)
          .where(and(eq(releases.org_id, orgId), eq(releases.id, sourceReleaseId)))
      : Promise.resolve([]),
    sourceArtistId
      ? db
          .select({ name: artists.name })
          .from(artists)
          .where(and(eq(artists.org_id, orgId), eq(artists.id, sourceArtistId)))
      : Promise.resolve([]),
    refs.document_ids.length
      ? db
          .select({ name: documents.name })
          .from(documents)
          .where(and(eq(documents.org_id, orgId), inArray(documents.id, refs.document_ids)))
          .orderBy(asc(documents.created_at))
      : Promise.resolve([]),
    refs.media_asset_ids.length
      ? db
          .select({ name: media_assets.asset_name })
          .from(media_assets)
          .where(and(eq(media_assets.org_id, orgId), inArray(media_assets.id, refs.media_asset_ids)))
          .orderBy(asc(media_assets.created_at))
      : Promise.resolve([]),
  ]);

  return {
    campaign_name: campaign.campaign_name,
    campaign_type: "campaign",
    release_title: releaseRows[0]?.title ?? campaign.release_title ?? "",
    release_id: sourceReleaseId ?? "",
    artist_name: artistRows[0]?.name ?? campaign.artist_name ?? "",
    artist_id: sourceArtistId ?? "",
    document_name: documentRows[0]?.name ?? "",
    media_asset_name: mediaRows[0]?.name ?? "",
    release_status: releaseRows[0]?.status ?? campaign.release_status ?? "",
  };
}

export function normalizeSourceReferences(input: unknown): CampaignContentSourceReferences {
  if (!input || typeof input !== "object") {
    return {
      release_id: null,
      artist_id: null,
      document_ids: [],
      media_asset_ids: [],
    };
  }

  const parsed = input as {
    release_id?: unknown;
    artist_id?: unknown;
    document_ids?: unknown;
    media_asset_ids?: unknown;
  };

  return {
    release_id: typeof parsed.release_id === "string" ? parsed.release_id : null,
    artist_id: typeof parsed.artist_id === "string" ? parsed.artist_id : null,
    document_ids: parseIdArray(parsed.document_ids),
    media_asset_ids: parseIdArray(parsed.media_asset_ids),
  };
}

function parseIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqSorted(value.filter((valueEntry) => typeof valueEntry === "string" && valueEntry.trim()) as string[]);
}

async function existingDocumentIds(orgId: string, releaseId: string, ids: string[] | undefined): Promise<string[]> {
  if (!ids || ids.length === 0) return [];

  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(
      eq(documents.org_id, orgId),
      eq(documents.release_id, releaseId),
      inArray(documents.id, ids),
    ));

  return rows.map((row) => row.id);
}

async function existingMediaAssetIds(orgId: string, releaseId: string, ids: string[] | undefined): Promise<string[]> {
  if (!ids || ids.length === 0) return [];

  const rows = await db
    .select({ id: media_assets.id })
    .from(media_assets)
    .where(and(
      eq(media_assets.org_id, orgId),
      eq(media_assets.linked_release_id, releaseId),
      inArray(media_assets.id, ids),
    ));

  return rows.map((row) => row.id);
}

async function releaseExists(orgId: string, releaseId: string): Promise<boolean> {
  const rows = await db
    .select({ id: releases.id })
    .from(releases)
    .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)));

  return rows.length > 0;
}

async function artistExists(orgId: string, artistId: string): Promise<boolean> {
  const rows = await db
    .select({ id: artists.id })
    .from(artists)
    .where(and(eq(artists.org_id, orgId), eq(artists.id, artistId)));

  return rows.length > 0;
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}
