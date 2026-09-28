import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";
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
import { ConflictError, HttpError, isPostgresSerializationFailure, NotFoundError } from "./errors";
import { idSchema, nullableNumber, nullableText } from "./validation";

const isoCountryCode = z.string().regex(/^[A-Z]{2}$/, "Use a two-letter ISO country code");
const dateTime = z.string().datetime().nullable().optional();
const url = z.url({ protocol: /^https?$/ }).max(2_000);
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
const deliverableFields = {
  description: z.string().trim().min(1).max(5_000),
  due_date: dateTime,
  approval_status: z.enum(["pending", "approved", "changes_requested", "rejected"]),
  evidence_url: url.nullable().optional(),
  notes: nullableText,
};
export const createCampaignDeliverableSchema = z.object({ id: idSchema.optional(), engagement_id: idSchema, ...deliverableFields, approval_status: deliverableFields.approval_status.default("pending") });
export const updateCampaignDeliverableSchema = z.object(deliverableFields).partial().extend({ id: idSchema, expected_updated_at: z.string().datetime().nullable() });
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

async function requireCampaign(orgId: string, campaignId: string, database: Pick<typeof db, "select"> = db) {
  const rows = await database.select({ id: campaigns.id, final_report: campaigns.final_report, final_report_snapshot: campaigns.final_report_snapshot, final_report_finalized_at: campaigns.final_report_finalized_at }).from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Campaign not found");
  return rows[0];
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

async function claimBudgetLine(orgId: string, campaignId: string, budgetLineId: string | null | undefined, database: Pick<typeof db, "select" | "update">) {
  if (!budgetLineId) return null;
  const rows = await database.select({ id: budget_line_items.id, campaign_id: budget_line_items.campaign_id }).from(budget_line_items)
    .where(and(eq(budget_line_items.id, budgetLineId), eq(budget_line_items.org_id, orgId))).limit(1).for("update");
  if (!rows.length || (rows[0].campaign_id && rows[0].campaign_id !== campaignId)) throw new NotFoundError("Budget Line not found for this Campaign");
  const otherLinks = await database.select({ id: campaign_creator_engagements.id }).from(campaign_creator_engagements)
    .where(and(eq(campaign_creator_engagements.org_id, orgId), eq(campaign_creator_engagements.budget_line_id, budgetLineId), ne(campaign_creator_engagements.campaign_id, campaignId))).limit(1);
  if (otherLinks.length) throw new NotFoundError("Budget Line not found for this Campaign");
  if (!rows[0].campaign_id) await database.update(budget_line_items).set({ campaign_id: campaignId })
    .where(and(eq(budget_line_items.id, budgetLineId), eq(budget_line_items.org_id, orgId), isNull(budget_line_items.campaign_id)));
  return budgetLineId;
}

export async function getCampaignOsWorkspace(orgId: string, campaignId: string, database: Pick<typeof db, "select"> = db) {
  const campaign = await requireCampaign(orgId, campaignId, database);
  const [territories, engagements, posts, availableBudgetLines] = await Promise.all([
    database.select({ id: campaign_territories.id, country_code: campaign_territories.country_code }).from(campaign_territories)
      .where(and(eq(campaign_territories.org_id, orgId), eq(campaign_territories.campaign_id, campaignId))).orderBy(asc(campaign_territories.country_code)),
    database.select({
      id: campaign_creator_engagements.id, contact_id: campaign_creator_engagements.contact_id, contact_name: contacts.name,
      status: campaign_creator_engagements.status, relationship_notes: campaign_creator_engagements.relationship_notes,
      outreach_channel: campaign_creator_engagements.outreach_channel, outreach_permission_status: campaign_creator_engagements.outreach_permission_status,
      outreach_permission_basis: campaign_creator_engagements.outreach_permission_basis, outreach_permission_recorded_at: campaign_creator_engagements.outreach_permission_recorded_at,
      outreach_permission_revoked_at: campaign_creator_engagements.outreach_permission_revoked_at, agreed_rate: campaign_creator_engagements.agreed_rate,
      agreed_currency: campaign_creator_engagements.agreed_currency, budget_line_id: campaign_creator_engagements.budget_line_id,
    }).from(campaign_creator_engagements).innerJoin(contacts, and(eq(campaign_creator_engagements.contact_id, contacts.id), eq(contacts.org_id, orgId)))
      .where(and(eq(campaign_creator_engagements.org_id, orgId), eq(campaign_creator_engagements.campaign_id, campaignId))).orderBy(asc(contacts.name)),
    database.select().from(campaign_posts).where(and(eq(campaign_posts.org_id, orgId), eq(campaign_posts.campaign_id, campaignId))).orderBy(desc(campaign_posts.published_at)),
    database.select({ id: budget_line_items.id, name: budget_line_items.name, campaign_id: budget_line_items.campaign_id, planned_amount: budget_line_items.planned_amount, amount: budget_line_items.amount, committed_amount: budget_line_items.committed_amount, paid_amount: budget_line_items.paid_amount, status: budget_line_items.status })
      .from(budget_line_items).where(and(eq(budget_line_items.org_id, orgId), or(eq(budget_line_items.campaign_id, campaignId), isNull(budget_line_items.campaign_id)))).orderBy(asc(budget_line_items.name)),
  ]);
  const linkedBudgetIds = new Set(engagements.map((engagement) => engagement.budget_line_id).filter(Boolean));
  const budgetLines = availableBudgetLines.filter((line) => line.campaign_id === campaignId && linkedBudgetIds.has(line.id));
  const budgetLineOptions = availableBudgetLines.map(({ id, name, campaign_id }) => ({ id, name, campaign_id }));
  const engagementIds = engagements.map((engagement) => engagement.id);
  const deliverables = engagementIds.length
    ? await database.select().from(campaign_creator_deliverables).where(and(eq(campaign_creator_deliverables.org_id, orgId), inArray(campaign_creator_deliverables.engagement_id, engagementIds))).orderBy(asc(campaign_creator_deliverables.due_date))
    : [];
  const cost = budgetLines.reduce((total, line) => ({
    planned: total.planned + Number(line.planned_amount ?? line.amount ?? 0),
    committed: total.committed + Number(line.committed_amount ?? 0),
    paid: total.paid + Number(line.paid_amount ?? 0),
  }), { planned: 0, committed: 0, paid: 0 });
  return { territories, engagements, deliverables, posts, budgetLines, budgetLineOptions, cost, report: { narrative: campaign.final_report, snapshot: campaign.final_report_snapshot, finalized_at: campaign.final_report_finalized_at } };
}

export async function createCampaignEngagement(orgId: string, campaignId: string, input: z.infer<typeof createCampaignEngagementSchema>) {
  await requireCampaign(orgId, campaignId);
  await requireContact(orgId, input.contact_id);
  const id = input.id ?? crypto.randomUUID();
  await db.transaction(async (tx) => {
    const budgetLineId = await claimBudgetLine(orgId, campaignId, input.budget_line_id, tx);
    await tx.insert(campaign_creator_engagements).values({ ...input, id, org_id: orgId, campaign_id: campaignId, budget_line_id: budgetLineId,
      outreach_permission_recorded_at: input.outreach_permission_recorded_at ? new Date(input.outreach_permission_recorded_at) : null,
      outreach_permission_revoked_at: input.outreach_permission_revoked_at ? new Date(input.outreach_permission_revoked_at) : null,
    });
  });
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
  if (input.outreach_permission_status === "permitted" && current.outreach_permission_status !== "permitted" && (!input.outreach_permission_basis || !input.outreach_permission_recorded_at)) throw new HttpError("Newly permitted outreach requires a fresh basis and recorded time", 409);
  if (permissionChanged && permission.outreach_permission_status === "permitted" && !hasRecordedPermission(permission)) throw new HttpError("Permitted outreach requires a basis, recorded time, and no revocation", 409);
  if (input.outreach_permission_status === "revoked" && current.outreach_permission_status !== "revoked" && !input.outreach_permission_revoked_at) throw new HttpError("Revocation time is required", 409);
  if (scopeChanged && contactStatuses.has(input.status ?? current.status) && !hasRecordedPermission(permission)) throw new HttpError("Recorded outreach permission is required before changing a contacted engagement's Contact or channel", 409);
  if (input.status && input.status !== current.status && contactStatuses.has(input.status) && !hasRecordedPermission(permission)) throw new HttpError("Recorded outreach permission is required before contact", 409);
  if (input.contact_id) await requireContact(orgId, input.contact_id);
  const updates: Record<string, unknown> = { ...input, updated_at: new Date() };
  delete updates.id;
  for (const field of ["outreach_permission_recorded_at", "outreach_permission_revoked_at"] as const) if (input[field] !== undefined) updates[field] = input[field] ? new Date(input[field]!) : null;
  await db.transaction(async (tx) => {
    if (input.budget_line_id !== undefined) updates.budget_line_id = await claimBudgetLine(orgId, campaignId, input.budget_line_id, tx);
    const saved = await tx.update(campaign_creator_engagements).set(updates).where(and(eq(campaign_creator_engagements.id, input.id), eq(campaign_creator_engagements.org_id, orgId), eq(campaign_creator_engagements.campaign_id, campaignId))).returning({ id: campaign_creator_engagements.id });
    if (!saved.length) throw new NotFoundError("Creator Engagement not found");
  });
  return { ok: true };
}

export async function createCampaignDeliverable(orgId: string, campaignId: string, input: z.infer<typeof createCampaignDeliverableSchema>) {
  await requireEngagement(orgId, campaignId, input.engagement_id);
  const id = input.id ?? crypto.randomUUID();
  await db.insert(campaign_creator_deliverables).values({ ...input, id, org_id: orgId, due_date: input.due_date ? new Date(input.due_date) : null });
  return { id, ok: true };
}

export async function updateCampaignDeliverable(orgId: string, campaignId: string, input: z.infer<typeof updateCampaignDeliverableSchema>) {
  const rows = await db.select({ engagement_id: campaign_creator_deliverables.engagement_id, updated_at: campaign_creator_deliverables.updated_at })
    .from(campaign_creator_deliverables).where(and(eq(campaign_creator_deliverables.id, input.id), eq(campaign_creator_deliverables.org_id, orgId))).limit(1);
  if (!rows.length) throw new NotFoundError("Deliverable not found");
  await requireEngagement(orgId, campaignId, rows[0].engagement_id);
  const { id, expected_updated_at, due_date, ...fields } = input;
  const expected = expected_updated_at ? new Date(expected_updated_at) : null;
  // ponytail: JSON dates have millisecond precision; use a revision column if writers need finer concurrency.
  const updatedAt = new Date(Math.max(Date.now(), (rows[0].updated_at?.getTime() ?? 0) + 1));
  const updated = await db.update(campaign_creator_deliverables).set({ ...fields,
    ...(due_date !== undefined ? { due_date: due_date ? new Date(due_date) : null } : {}),
    updated_at: updatedAt,
  }).where(and(eq(campaign_creator_deliverables.id, id), eq(campaign_creator_deliverables.org_id, orgId), eq(campaign_creator_deliverables.engagement_id, rows[0].engagement_id),
    expected ? and(gte(campaign_creator_deliverables.updated_at, expected), lt(campaign_creator_deliverables.updated_at, new Date(expected.getTime() + 1))) : isNull(campaign_creator_deliverables.updated_at)))
    .returning({ id: campaign_creator_deliverables.id });
  if (!updated.length) throw new ConflictError("Deliverable changed since it was loaded. Reload before saving again.");
  return { ok: true };
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
  try {
    return await db.transaction(async (tx) => {
      const workspace = await getCampaignOsWorkspace(orgId, campaignId, tx);
      const finalizedAt = new Date();
      const snapshot = { finalized_at: finalizedAt.toISOString(), cost: workspace.cost, deliverable_count: workspace.deliverables.length, approved_deliverable_count: workspace.deliverables.filter((item) => item.approval_status === "approved").length, post_count: workspace.posts.length, manual_metrics: workspace.posts.reduce<Record<string, number>>((all, post) => {
        for (const [key, value] of Object.entries(post.manual_metrics ?? {})) all[key] = (all[key] ?? 0) + Number(value);
        return all;
      }, {}), creator_delivery: workspace.engagements.map((engagement) => ({
        contact_name: engagement.contact_name, status: engagement.status,
        deliverables: workspace.deliverables.filter((item) => item.engagement_id === engagement.id).map((item) => ({ description: item.description, approval_status: item.approval_status, evidence_url: item.evidence_url })),
      })), post_evidence: workspace.posts.map((post) => ({
        url: post.url, platform: post.platform, published_at: post.published_at, metrics_captured_at: post.metrics_captured_at,
        manual_metrics: post.manual_metrics, notes: post.notes,
      })), budget_lines: workspace.budgetLines.map((line) => ({
        name: line.name, planned_amount: line.planned_amount ?? line.amount, committed_amount: line.committed_amount, paid_amount: line.paid_amount,
      })) };
      const saved = await tx.update(campaigns).set({ final_report: report, final_report_snapshot: snapshot, final_report_finalized_at: finalizedAt, final_report_finalized_by: actorId, updated_at: finalizedAt })
        .where(and(eq(campaigns.id, campaignId), eq(campaigns.org_id, orgId), isNull(campaigns.final_report_snapshot), isNull(campaigns.final_report_finalized_at))).returning({ id: campaigns.id });
      if (!saved.length) throw new ConflictError("Campaign report has already been finalised");
      return { ok: true, snapshot };
    }, { isolationLevel: "repeatable read" });
  } catch (error) {
    if (isPostgresSerializationFailure(error)) {
      throw new ConflictError("Campaign changed while finalising; refresh and try again");
    }
    throw error;
  }
}
