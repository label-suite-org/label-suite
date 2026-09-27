import { and, eq } from "drizzle-orm";
import { deriveCampaignDocument } from "../lib/campaign-rich-text";
import { z } from "zod";
import { campaigns } from "../db/schema";
import { db } from "../lib/db";
import {
  attachCampaignAudience,
  detachCampaignAudience,
  getCampaignAudienceForCampaign,
  listCampaignAudiences,
} from "./campaign-audiences";
import { getCampaignContentContext, saveCampaignContentTemplate } from "./campaign-content";
import { HttpError } from "./errors";

const MAX_TEMPLATE_OPTIONS = 25;
const MAX_AUDIENCE_MEMBERS = 25;
const NATIVE_QUERY_SENTINEL = 1;

export const nativeCampaignSectionsMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("select_template"), template_id: z.string().nullable(), expected_revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("attach_audience"), audience_id: z.string().min(1), expected_revision: z.number().int().positive() }).strict(),
  z.object({ action: z.literal("detach_audience"), expected_revision: z.number().int().positive() }).strict(),
]);

export type NativeCampaignSectionsMutation = z.infer<typeof nativeCampaignSectionsMutationSchema>;

function bounded<T>(items: T[], limit: number) {
  return { items: items.slice(0, limit), truncated: items.length > limit };
}

export function projectNativeRichDocument(value: unknown) {
  try {
    return { available: true as const, read_only: true as const, document: deriveCampaignDocument(value, 20_000).document };
  } catch {
    return { available: false as const, read_only: true as const, reason: "invalid_or_oversized_document" as const };
  }
}

function projectAudience(selection: Awaited<ReturnType<typeof getCampaignAudienceForCampaign>>) {
  if (!selection) return null;
  const preview = selection.preview;
  return {
    campaign_audience_id: selection.campaign_audience_id,
    audience_id: preview.audience_id,
    name: preview.audience_name,
    description: preview.audience_description,
    counts: preview.partial
      ? { available: false, reason: "bounded_sample_no_exact_totals" }
      : { available: true, values: preview.counts },
    included_contacts: bounded(preview.included_contacts, MAX_AUDIENCE_MEMBERS),
    excluded_contacts: bounded(preview.excluded_contacts, MAX_AUDIENCE_MEMBERS),
    included_stations: bounded(preview.included_stations, MAX_AUDIENCE_MEMBERS),
    excluded_stations: bounded(preview.excluded_stations, MAX_AUDIENCE_MEMBERS),
  };
}

export async function getNativeCampaignSections(orgId: string, campaignId: string) {
  const [campaignRows, content, audience, audienceOptions] = await Promise.all([
    db.select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      revision: campaigns.revision,
      goal_document: campaigns.goal_document,
      notes_document: campaigns.notes_document,
      brief_document: campaigns.brief_document,
      updated_at: campaigns.updated_at,
    }).from(campaigns).where(and(eq(campaigns.org_id, orgId), eq(campaigns.id, campaignId))).limit(1),
    getCampaignContentContext(orgId, campaignId, { templateLimit: MAX_TEMPLATE_OPTIONS, includeSourceOptions: false }),
    getCampaignAudienceForCampaign(orgId, campaignId, { memberSampleLimit: MAX_AUDIENCE_MEMBERS + NATIVE_QUERY_SENTINEL }),
    listCampaignAudiences(orgId, { limit: MAX_TEMPLATE_OPTIONS }),
  ]);
  const campaign = campaignRows[0];
  if (!campaign) throw new HttpError("Campaign not found", 404);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.campaign_name,
      revision: campaign.revision,
      updated_at: campaign.updated_at,
    },
    content: {
      selection: content.selection ? {
        reviewed_template_id: content.selection.reviewed_template_id,
        channel: content.selection.content_channel,
        provider: content.selection.content_provider,
        source_version: content.selection.content_source_version,
        source_references: content.selection.content_source_references,
        template: content.selection.template ? {
          id: content.selection.template.id,
          name: content.selection.template.name,
          subject: content.selection.template.subject,
          body: content.selection.template.body,
          channel: content.selection.template.channel,
          current_version: content.selection.template.current_version,
          review_status: content.selection.template.review_status,
        } : null,
      } : null,
      template_options: bounded(content.templates.map((template) => ({
        id: template.id,
        name: template.name,
        subject: template.subject,
        channel: template.channel,
        current_version: template.current_version,
        review_status: template.review_status,
        source_version: template.source_version,
      })), MAX_TEMPLATE_OPTIONS),
      rich_content: {
        read_only: true,
        goal_document: projectNativeRichDocument(campaign.goal_document),
        notes_document: projectNativeRichDocument(campaign.notes_document),
        brief_document: projectNativeRichDocument(campaign.brief_document),
      },
    },
    audience: {
      selection: projectAudience(audience),
      options: bounded(audienceOptions.map((option) => ({
        id: option.id,
        name: option.name,
        description: option.description,
        membership_rules: option.membership_rules,
        updated_at: option.updated_at,
      })), MAX_TEMPLATE_OPTIONS),
    },
    channels: {
      available: false,
      reason: "not_configured",
      message: "Campaign channel configuration is not available in this API.",
    },
    boundaries: { can_send: false, send_performed: false, editable: ["select_template", "attach_audience", "detach_audience"] },
  };
}

export async function mutateNativeCampaignSections(
  orgId: string,
  campaignId: string,
  raw: NativeCampaignSectionsMutation,
  actorUserId: string,
) {
  const input = nativeCampaignSectionsMutationSchema.parse(raw);
  const audit = { actorUserId, eventType: `campaign.sections.${input.action}`, metadata: { action: input.action, no_send: true } };
  let result: { ok: boolean; revision?: number };
  if (input.action === "select_template") {
    result = await saveCampaignContentTemplate(orgId, campaignId, { template_id: input.template_id }, actorUserId, {
      expectedRevision: input.expected_revision,
      audit,
    });
  } else if (input.action === "attach_audience") {
    result = await attachCampaignAudience(orgId, campaignId, { audience_id: input.audience_id }, {
      expectedRevision: input.expected_revision,
      audit,
    });
  } else {
    result = await detachCampaignAudience(orgId, campaignId, {
      expectedRevision: input.expected_revision,
      audit,
    });
  }

  return {
    campaign: { id: campaignId, revision: result.revision ?? input.expected_revision },
    action: input.action,
    consequences: {
      scope: input.action === "select_template" ? "content template selection only" : "campaign audience selection only",
      can_send: false,
      send_performed: false,
      channel_changes: "none",
      recipient_delivery_changes: "none",
    },
  };
}
