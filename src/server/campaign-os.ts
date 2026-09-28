import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  budget_line_items,
  campaign_creator_deliverables,
  campaign_creator_engagements,
  campaign_posts,
  campaign_territories,
  campaigns,
  contacts,
} from "../db/schema";
import { db } from "../lib/db";
import { HttpError, NotFoundError } from "./errors";
import { idSchema, nullableNumber, nullableText } from "./validation";

const isoCountryCode = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code");
const dateTime = z.string().datetime().nullable().optional();
const url = z.string().url().max(2_000);
const contactStatuses = new Set(["permission_confirmed", "contacted", "negotiating", "agreed", "delivering", "complete"]);

function hasRecordedPermission(value: { outreach_permission_status: string; outreach_permission_basis?: string | null; outreach_permission_recorded_at?: string | Date | null; outreach_permission_revoked_at?: string | Date | null }) {
  return value.outreach_permission_status === "permitted" && !!value.outreach_permission_basis && !!value.outreach_permission_recorded_at && !value.outreach_permission_revoked_at;
}

const campaignEngagementFields = {
  contact_id: idSchema,
  status: z.enum(["identified", "qualified", "permission_confirmed", "contacted", "negotiating", "agreed", "delivering", "complete", "declined", "not_a_fit"]).default("identified"),
  relationship_notes: nullableText,
  outreach_channel: z.string().trim().min(1).max(100).default("email"),
  outreach_permission_status: z.enum(["unknown", "permitted", "revoked", "do_not_contact"]).default("unknown"),
  outreach_permission_basis: nullableText,
  outreach_permission_recorded_at: dateTime,
  outreach_permission_revoked_at: dateTime,
  agreed_rate: nullableNumber({ min: 0 }),
  agreed_currency: nullableText,
  budget_line_id: nullableText,
};
export const campaignEngagementSchema = z.object(campaignEngagementFields).superRefine((value, ctx) => {
  if (value.outreach_permission_status === "permitted" && !value.outreach_permission_basis) {
    ctx.addIssue({ code: "custom", path: ["outreach_permission_basis"], message: "Permission basis is required when outreach is permitted" });
  }
});

export const createCampaignEngagementSchema = z.object({ ...campaignEngagementFields, id: idSchema.optional() }).superRefine((value, ctx) => {
  if (value.outreach_permission_status === "permitted" && !value.outreach_permission_basis) {
    ctx.addIssue({ code: "custom", path: ["outreach_permission_basis"], message: "Permission basis is required when outreach is permitted" });
  }
  if (value.outreach_permission_status === "permitted" && !value.outreach_permission_recorded_at) {
    ctx.addIssue({ code: "custom", path: ["outreach_permission_recorded_at"], message: "Permission recorded time is required when outreach is permitted" });
  }
  if (value.outreach_permission_status === "permitted" && value.outreach_permission_revoked_at) {
    ctx.addIssue({ code: "custom", path: ["outreach_permission_revoked_at"], message: "Revoked permission cannot be used for outreach" });
  }
  if (value.outreach_permission_status === "revoked" && !value.outreach_permission_revoked_at) {
    ctx.addIssue({ code: "custom", path: ["outreach_permission_revoked_at"], message: "Revocation time is required" });
  }
  if (contactStatuses.has(value.status) && !hasRecordedPermission(value)) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Recorded outreach permission is required before contact" });
  }
});
export const updateCampaignEngagementSchema = z.object(campaignEngagementFields).partial().extend({
  id: idSchema,
  status: campaignEngagementFields.status.unwrap().optional(),
  outreach_channel: campaignEngagementFields.outreach_channel.unwrap().optional(),
  outreach_permission_status: campaignEngagementFields.outreach_permission_status.unwrap().optional(),
});
export const createCampaignDeliverableSchema = z.object({
  id: idSchema.optional(),
  engagement_id: idSchema,
  description: z.string().trim().min(1).max(5_000),
  due_date: dateTime,
  approval_status: z.enum(["pending", "approved", "changes_requested", "rejected"]).default("pending"),
  evidence_url: z.string().url().max(2_000).nullable().optional(),
  notes: nullableText,
});
export const createCampaignPostSchema = z.object({
  id: idSchema.optional(),
  engagement_id: nullableText,
  url,
  platform: z.string().trim().min(1).max(100),
  published_at: dateTime,
  metrics_captured_at: dateTime,
  manual_metrics: z.record(z.string().min(1).max(100), z.number().finite().min(0)).default({}),
  notes: nullableText,
});
export const setCampaignTerritoriesSchema = z.object({ country_codes: z.array(isoCountryCode).max(100) });
export const finalizeCampaignReportSchema = z.object({ report: z.string().trim().min(1).max(20_000) });

async function requireCampaign(orgId: string, campaignId: string) {
  const rows = await db.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Campaign not found");
}

async function requireEngagement(orgId: string, campaignId: string, engagementId: string) {
  const rows = await db.select({ id: campaign_creator_engagements.id, contact_id: campaign_creator_engagements.contact_id, status: campaign_creator_engagements.status, outreach_channel: campaign_creator_engagements.outreach_channel, outreach_permission_status: campaign_creator_engagements.outreach_permission_status, outreach_permission_basis: campaign_creator_engagements.outreach_permission_basis, outreach_permission_recorded_at: campaign_creator_engagements.outreach_permission_recorded_at, outreach_permission_revoked_at: campaign_creator_engagements.outreach_permission_revoked_at }).from(campaign_creator_engagements)
    .where(and(eq(campaign_creator_engagements.id, engagementId), eq(campaign_creator_engagements.campaign_id, campaignId), eq(campaign_creator_engagements.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Creator Engagement not found");
  return rows[0];
}

async function requireContact(orgId: string, contactId: string) {
  const rows = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Contact not found in active workspace");
}

async function requireBudgetLine(orgId: string, campaignId: string, budgetLineId: string | null | undefined) {
  if (!budgetLineId) return null;
  const rows = await db.select({ id: budget_line_items.id, campaign_id: budget_line_items.campaign_id }).from(budget_line_items)
    .where(and(eq(budget_line_items.id, budgetLineId), eq(budget_line_items.org_id, orgId))).limit(1);
  if (!rows.length || (rows[0].campaign_id && rows[0].campaign_id !== campaignId)) throw new NotFoundError("Budget Line not found for this Campaign");
  return budgetLineId;
}

export async function getCampaignOsWorkspace(orgId: string, campaignId: string) {
  await requireCampaign(orgId, campaignId);
  const [territories, engagements, posts, budgetLines] = await Promise.all([
    db.select({ id: campaign_territories.id, country_code: campaign_territories.country_code }).from(campaign_territories)
      .where(and(eq(campaign_territories.org_id, orgId), eq(campaign_territories.campaign_id, campaignId))).orderBy(asc(campaign_territories.country_code)),
    db.select({
      id: campaign_creator_engagements.id, contact_id: campaign_creator_engagements.contact_id, contact_name: contacts.name,
      status: campaign_creator_engagements.status, relationship_notes: campaign_creator_engagements.relationship_notes,
      outreach_channel: campaign_creator_engagements.outreach_channel, outreach_permission_status: campaign_creator_engagements.outreach_permission_status,
      outreach_permission_basis: campaign_creator_engagements.outreach_permission_basis, outreach_permission_recorded_at: campaign_creator_engagements.outreach_permission_recorded_at,
      outreach_permission_revoked_at: campaign_creator_engagements.outreach_permission_revoked_at, agreed_rate: campaign_creator_engagements.agreed_rate,
      agreed_currency: campaign_creator_engagements.agreed_currency, budget_line_id: campaign_creator_engagements.budget_line_id,
    }).from(campaign_creator_engagements).innerJoin(contacts, and(eq(campaign_creator_engagements.contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .where(and(eq(campaign_creator_engagements.org_id, orgId), eq(campaign_creator_engagements.campaign_id, campaignId))).orderBy(asc(contacts.name)),
    db.select().from(campaign_posts).where(and(eq(campaign_posts.org_id, orgId), eq(campaign_posts.campaign_id, campaignId))).orderBy(desc(campaign_posts.published_at)),
    db.select({ id: budget_line_items.id, name: budget_line_items.name, planned_amount: budget_line_items.planned_amount, amount: budget_line_items.amount, committed_amount: budget_line_items.committed_amount, paid_amount: budget_line_items.paid_amount, status: budget_line_items.status })
      .from(budget_line_items).where(and(eq(budget_line_items.org_id, orgId), eq(budget_line_items.campaign_id, campaignId))),
  ]);
  const engagementIds = engagements.map((engagement) => engagement.id);
  const deliverables = engagementIds.length
    ? await db.select().from(campaign_creator_deliverables).where(and(eq(campaign_creator_deliverables.org_id, orgId), inArray(campaign_creator_deliverables.engagement_id, engagementIds))).orderBy(asc(campaign_creator_deliverables.due_date))
    : [];
  const cost = budgetLines.reduce((total, line) => ({
    planned: total.planned + Number(line.planned_amount ?? line.amount ?? 0),
    committed: total.committed + Number(line.committed_amount ?? 0),
    paid: total.paid + Number(line.paid_amount ?? 0),
  }), { planned: 0, committed: 0, paid: 0 });
  return { territories, engagements, deliverables, posts, budgetLines, cost };
}

export async function createCampaignEngagement(orgId: string, campaignId: string, input: z.infer<typeof createCampaignEngagementSchema>) {
  await requireCampaign(orgId, campaignId);
  await requireContact(orgId, input.contact_id);
  const budgetLineId = await requireBudgetLine(orgId, campaignId, input.budget_line_id);
  const id = input.id ?? crypto.randomUUID();
  await db.insert(campaign_creator_engagements).values({ ...input, id, org_id: orgId, campaign_id: campaignId, budget_line_id: budgetLineId,
    outreach_permission_recorded_at: input.outreach_permission_recorded_at ? new Date(input.outreach_permission_recorded_at) : null,
    outreach_permission_revoked_at: input.outreach_permission_revoked_at ? new Date(input.outreach_permission_revoked_at) : null,
  });
  if (budgetLineId) await db.update(budget_line_items).set({ campaign_id: campaignId }).where(and(eq(budget_line_items.id, budgetLineId), eq(budget_line_items.org_id, orgId)));
  return { id, ok: true };
}

export async function updateCampaignEngagement(orgId: string, campaignId: string, input: z.infer<typeof updateCampaignEngagementSchema>) {
  const current = await requireEngagement(orgId, campaignId, input.id);
  const permission = {
    outreach_permission_status: input.outreach_permission_status ?? current.outreach_permission_status,
    outreach_permission_basis: input.outreach_permission_basis === undefined ? current.outreach_permission_basis : input.outreach_permission_basis,
    outreach_permission_recorded_at: input.outreach_permission_recorded_at === undefined ? current.outreach_permission_recorded_at : input.outreach_permission_recorded_at,
    outreach_permission_revoked_at: input.outreach_permission_revoked_at === undefined ? current.outreach_permission_revoked_at : input.outreach_permission_revoked_at,
  };
  const permissionChanged = input.outreach_permission_status !== undefined || input.outreach_permission_basis !== undefined || input.outreach_permission_recorded_at !== undefined || input.outreach_permission_revoked_at !== undefined;
  const scopeChanged = (input.contact_id !== undefined && input.contact_id !== current.contact_id) || (input.outreach_channel !== undefined && input.outreach_channel !== current.outreach_channel);
  if (scopeChanged && ((input.outreach_permission_status === undefined && current.outreach_permission_status !== "unknown") || (input.outreach_permission_status === "permitted" && (!input.outreach_permission_basis || !input.outreach_permission_recorded_at)))) throw new HttpError("Changing Contact or channel requires an explicit permission status and fresh evidence when permitted", 409);
  if (permissionChanged && permission.outreach_permission_status === "permitted" && !hasRecordedPermission(permission)) throw new HttpError("Permitted outreach requires a basis, recorded time, and no revocation", 409);
  if (input.outreach_permission_status === "revoked" && current.outreach_permission_status !== "revoked" && !input.outreach_permission_revoked_at) throw new HttpError("Revocation time is required", 409);
  if (scopeChanged && contactStatuses.has(input.status ?? current.status) && !hasRecordedPermission(permission)) throw new HttpError("Recorded outreach permission is required before changing a contacted engagement's Contact or channel", 409);
  if (input.status && input.status !== current.status && contactStatuses.has(input.status) && !hasRecordedPermission(permission)) throw new HttpError("Recorded outreach permission is required before contact", 409);
  if (input.contact_id) await requireContact(orgId, input.contact_id);
  const budgetLineId = await requireBudgetLine(orgId, campaignId, input.budget_line_id);
  const updates: Record<string, unknown> = { ...input, updated_at: new Date() };
  delete updates.id;
  if (input.budget_line_id !== undefined) updates.budget_line_id = budgetLineId;
  for (const field of ["outreach_permission_recorded_at", "outreach_permission_revoked_at"] as const) if (input[field] !== undefined) updates[field] = input[field] ? new Date(input[field]!) : null;
  await db.update(campaign_creator_engagements).set(updates).where(and(eq(campaign_creator_engagements.id, input.id), eq(campaign_creator_engagements.org_id, orgId), eq(campaign_creator_engagements.campaign_id, campaignId)));
  if (budgetLineId) await db.update(budget_line_items).set({ campaign_id: campaignId }).where(and(eq(budget_line_items.id, budgetLineId), eq(budget_line_items.org_id, orgId)));
  return { ok: true };
}

export async function createCampaignDeliverable(orgId: string, campaignId: string, input: z.infer<typeof createCampaignDeliverableSchema>) {
  await requireEngagement(orgId, campaignId, input.engagement_id);
  const id = input.id ?? crypto.randomUUID();
  await db.insert(campaign_creator_deliverables).values({ ...input, id, org_id: orgId, due_date: input.due_date ? new Date(input.due_date) : null });
  return { id, ok: true };
}

export async function createCampaignPost(orgId: string, campaignId: string, input: z.infer<typeof createCampaignPostSchema>) {
  await requireCampaign(orgId, campaignId);
  if (input.engagement_id) await requireEngagement(orgId, campaignId, input.engagement_id);
  const id = input.id ?? crypto.randomUUID();
  await db.insert(campaign_posts).values({ ...input, id, org_id: orgId, campaign_id: campaignId,
    published_at: input.published_at ? new Date(input.published_at) : null,
    metrics_captured_at: input.metrics_captured_at ? new Date(input.metrics_captured_at) : new Date(),
  });
  return { id, ok: true };
}

export async function setCampaignTerritories(orgId: string, campaignId: string, input: z.infer<typeof setCampaignTerritoriesSchema>) {
  await requireCampaign(orgId, campaignId);
  const countryCodes = [...new Set(input.country_codes)];
  await db.transaction(async (tx) => {
    await tx.delete(campaign_territories).where(and(eq(campaign_territories.org_id, orgId), eq(campaign_territories.campaign_id, campaignId)));
    if (countryCodes.length) await tx.insert(campaign_territories).values(countryCodes.map((country_code) => ({ id: crypto.randomUUID(), org_id: orgId, campaign_id: campaignId, country_code })));
  });
  return { ok: true };
}

export async function finalizeCampaignReport(orgId: string, campaignId: string, report: string, actorId: string) {
  const workspace = await getCampaignOsWorkspace(orgId, campaignId);
  const snapshot = { finalized_at: new Date().toISOString(), cost: workspace.cost, deliverable_count: workspace.deliverables.length, approved_deliverable_count: workspace.deliverables.filter((item) => item.approval_status === "approved").length, post_count: workspace.posts.length, manual_metrics: workspace.posts.reduce<Record<string, number>>((all, post) => {
    for (const [key, value] of Object.entries(post.manual_metrics ?? {})) all[key] = (all[key] ?? 0) + Number(value);
    return all;
  }, {}) };
  await db.update(campaigns).set({ final_report: report, final_report_snapshot: snapshot, final_report_finalized_at: new Date(), final_report_finalized_by: actorId, updated_at: new Date() })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId)));
  return { ok: true, snapshot };
}
