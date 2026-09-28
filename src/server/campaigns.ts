import { z } from "zod";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { artists, campaign_stations, campaigns, ops_tasks, releases } from "../db/schema";
import { db } from "../lib/db";
import {
  deriveCampaignDocument,
  legacyTextToCampaignDocument,
  type CampaignDocument,
  type CampaignDocumentDerived,
} from "../lib/campaign-rich-text";
import { ConflictError, NotFoundError } from "./errors";
import {
  hasOwn,
  idSchema,
  nullableInteger,
  nullableNumber,
  nullableText,
} from "./validation";

function campaignDocumentSchemaForLimit(characterLimit: 10_000 | 20_000) {
  return z.unknown().transform((value, context): CampaignDocument => {
    try {
      return deriveCampaignDocument(value, characterLimit).document;
    } catch (error) {
      context.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid campaign document",
      });
      return z.NEVER;
    }
  });
}

const campaignDocumentSchema = campaignDocumentSchemaForLimit(20_000).optional();

const campaignBaseSchema = {
  campaign_name: z.string().trim().min(1, "Campaign name is required"),
  linked_release_id: nullableText,
  linked_artist_id: nullableText,
  campaign_type: nullableText,
  start_date: nullableText,
  end_date: nullableText,
  status: nullableText,
  owner: nullableText,
  goal: nullableText,
  brief: nullableText,
  goal_document: campaignDocumentSchema,
  budget_planned: nullableNumber({ min: 0 }),
  budget_actual: nullableNumber({ min: 0 }),
  kpi_summary: nullableText,
  notes: nullableText,
  notes_document: campaignDocumentSchema,
  performance_rating: nullableInteger({ min: 0, max: 5 }),
  main_platform: nullableText,
};

export const createCampaignSchema = z.object({
  id: idSchema.optional(),
  ...campaignBaseSchema,
  linked_release_id: idSchema,
  linked_artist_id: idSchema,
});

export const updateCampaignSchema = z.object({
  id: idSchema,
  expected_revision: z.number().int().positive(),
  ...Object.fromEntries(
    Object.entries(campaignBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
  linked_release_id: idSchema.optional(),
  linked_artist_id: idSchema.optional(),
}).superRefine((value, ctx) => {
  if (hasOwn(value, "linked_release_id") && !value.linked_artist_id) ctx.addIssue({ code: "custom", path: ["linked_artist_id"], message: "Artist is required when editing Campaign links" });
  if (hasOwn(value, "linked_artist_id") && !value.linked_release_id) ctx.addIssue({ code: "custom", path: ["linked_release_id"], message: "Release is required when editing Campaign links" });
});

export const deleteCampaignSchema = z.object({
  id: idSchema,
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type DeleteCampaignInput = z.infer<typeof deleteCampaignSchema>;

export interface CampaignDocumentDisplay {
  html: string;
  plainText: string;
  usedFallback: boolean;
}

export function renderCampaignDocumentForDisplay(
  document: unknown,
  compatibilityText: string | null,
): CampaignDocumentDisplay {
  try {
    const derived = deriveCampaignDocument(document, 20_000);
    return { html: derived.html, plainText: derived.plainText, usedFallback: false };
  } catch {
    const plainText = compatibilityText ?? "";
    return { html: escapeHtml(plainText), plainText, usedFallback: true };
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function campaignDocumentJson(document: CampaignDocument): Record<string, unknown> {
  return document as unknown as Record<string, unknown>;
}

function deriveRichTextField(
  input: Record<string, unknown>,
  documentKey: "goal_document" | "notes_document",
  textKey: "goal" | "notes",
  required: boolean,
): CampaignDocumentDerived | null {
  if (hasOwn(input, documentKey)) {
    return deriveCampaignDocument(input[documentKey], 20_000);
  }
  if (hasOwn(input, textKey)) {
    return deriveCampaignDocument(input[textKey] ?? "", 20_000);
  }
  return required ? deriveCampaignDocument("", 20_000) : null;
}

function withCampaignDocuments<T extends {
  goal: string | null;
  goal_document: Record<string, unknown> | null;
  notes: string | null;
  notes_document: Record<string, unknown> | null;
}>(campaign: T) {
  return {
    ...campaign,
    goal_document: campaign.goal_document ?? legacyTextToCampaignDocument(campaign.goal ?? ""),
    notes_document: campaign.notes_document ?? legacyTextToCampaignDocument(campaign.notes ?? ""),
  };
}

export async function getCampaignDetail(orgId: string, id: string) {
  const rows = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      owner: campaigns.owner,
      goal: campaigns.goal,
      brief: campaigns.brief,
      final_report: campaigns.final_report,
      final_report_finalized_at: campaigns.final_report_finalized_at,
      goal_document: campaigns.goal_document,
      budget_planned: campaigns.budget_planned,
      budget_actual: campaigns.budget_actual,
      kpi_summary: campaigns.kpi_summary,
      notes: campaigns.notes,
      notes_document: campaigns.notes_document,
      performance_rating: campaigns.performance_rating,
      main_platform: campaigns.main_platform,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      release_title: releases.title,
      artist_name: artists.name,
      updated_at: campaigns.updated_at,
      revision: campaigns.revision,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(campaigns.id, id), eq(campaigns.org_id, orgId)));

  const campaign = rows[0];
  if (!campaign) return null;

  return withCampaignDocuments(campaign);
}

export async function listCampaigns(orgId: string) {
  const rows = await db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      linked_release_id: campaigns.linked_release_id,
      linked_artist_id: campaigns.linked_artist_id,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      owner: campaigns.owner,
      goal: campaigns.goal,
      brief: campaigns.brief,
      goal_document: campaigns.goal_document,
      budget_planned: campaigns.budget_planned,
      notes: campaigns.notes,
      notes_document: campaigns.notes_document,
      performance_rating: campaigns.performance_rating,
      main_platform: campaigns.main_platform,
      release_title: releases.title,
      cover_art_url: releases.cover_art_url,
      artist_name: artists.name,
      updated_at: campaigns.updated_at,
      revision: campaigns.revision,
    })
    .from(campaigns)
    .leftJoin(releases, and(eq(campaigns.linked_release_id, releases.id), eq(releases.org_id, orgId)))
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(eq(campaigns.org_id, orgId))
    .orderBy(desc(campaigns.created_at));

  return rows.map(withCampaignDocuments);
}

export async function listCampaignsForRelease(orgId: string, releaseId: string) {
  return db
    .select({
      id: campaigns.id,
      campaign_name: campaigns.campaign_name,
      campaign_type: campaigns.campaign_type,
      status: campaigns.status,
      start_date: campaigns.start_date,
      end_date: campaigns.end_date,
      owner: campaigns.owner,
      budget_planned: campaigns.budget_planned,
      performance_rating: campaigns.performance_rating,
      main_platform: campaigns.main_platform,
      artist_name: artists.name,
    })
    .from(campaigns)
    .leftJoin(artists, and(eq(campaigns.linked_artist_id, artists.id), eq(artists.org_id, orgId)))
    .where(and(eq(campaigns.org_id, orgId), eq(campaigns.linked_release_id, releaseId)))
    .orderBy(desc(campaigns.start_date), desc(campaigns.created_at));
}

export async function listCampaignsForEventSeams(orgId: string, options: { artistId?: string | null; releaseId?: string | null }) {
  const rows = await listCampaigns(orgId);
  const artistId = options.artistId ?? null;
  const releaseId = options.releaseId ?? null;

  return rows.filter((campaign) => (artistId && campaign.linked_artist_id === artistId) || (releaseId && campaign.linked_release_id === releaseId));
}

export async function listCampaignOptions(orgId: string) {
  return db
    .select({ id: campaigns.id, name: campaigns.campaign_name })
    .from(campaigns)
    .where(eq(campaigns.org_id, orgId))
    .orderBy(asc(campaigns.campaign_name));
}

export async function createCampaign(orgId: string, input: CreateCampaignInput) {
  const id = input.id ?? crypto.randomUUID();
  const goal = deriveRichTextField(input, "goal_document", "goal", true)!;
  const notes = deriveRichTextField(input, "notes_document", "notes", true)!;
  await requireCampaignArtistAndRelease(orgId, input.linked_artist_id, input.linked_release_id);

  await db.insert(campaigns).values({
    id,
    org_id: orgId,
    campaign_name: input.campaign_name,
    linked_release_id: input.linked_release_id ?? null,
    linked_artist_id: input.linked_artist_id ?? null,
    campaign_type: input.campaign_type ?? null,
    start_date: input.start_date ?? null,
    end_date: input.end_date ?? null,
    status: input.status ?? "planning",
    owner: input.owner ?? null,
    goal: goal.plainText,
    goal_document: campaignDocumentJson(goal.document),
    brief: input.brief ?? null,
    budget_planned: input.budget_planned ?? null,
    budget_actual: input.budget_actual ?? null,
    kpi_summary: input.kpi_summary ?? null,
    notes: notes.plainText,
    notes_document: campaignDocumentJson(notes.document),
    performance_rating: input.performance_rating ?? null,
    main_platform: input.main_platform ?? null,
    revision: 1,
  }).onConflictDoNothing({ target: campaigns.id });

  return { id, ok: true };
}

async function requireCampaignArtistAndRelease(orgId: string, artistId: string, releaseId: string) {
  const [artistRows, releaseRows] = await Promise.all([
    db.select({ id: artists.id }).from(artists).where(and(eq(artists.id, artistId), eq(artists.org_id, orgId))).limit(1),
    db.select({ id: releases.id, artist_id: releases.artist_id }).from(releases).where(and(eq(releases.id, releaseId), eq(releases.org_id, orgId))).limit(1),
  ]);
  if (!artistRows.length) throw new NotFoundError("Artist not found in active workspace");
  if (!releaseRows.length) throw new NotFoundError("Release not found in active workspace");
  if (releaseRows[0].artist_id && releaseRows[0].artist_id !== artistId) throw new ConflictError("Campaign Artist must match the Release Artist");
}

export async function updateCampaign(orgId: string, input: UpdateCampaignInput) {
  if (hasOwn(input, "linked_artist_id") || hasOwn(input, "linked_release_id")) {
    if (!input.linked_artist_id || !input.linked_release_id) throw new ConflictError("Campaign Artist and Release are required when editing catalog links");
    await requireCampaignArtistAndRelease(orgId, input.linked_artist_id, input.linked_release_id);
  }
  const updates: Partial<typeof campaigns.$inferInsert> = { updated_at: new Date(), revision: sql`${campaigns.revision} + 1` as unknown as number };
  const goal = deriveRichTextField(input, "goal_document", "goal", false);
  const notes = deriveRichTextField(input, "notes_document", "notes", false);

  if (hasOwn(input, "campaign_name")) updates.campaign_name = input.campaign_name as string;
  if (hasOwn(input, "linked_release_id")) updates.linked_release_id = input.linked_release_id as string | null;
  if (hasOwn(input, "linked_artist_id")) updates.linked_artist_id = input.linked_artist_id as string | null;
  if (hasOwn(input, "campaign_type")) updates.campaign_type = input.campaign_type as string | null;
  if (hasOwn(input, "start_date")) updates.start_date = input.start_date as string | null;
  if (hasOwn(input, "end_date")) updates.end_date = input.end_date as string | null;
  if (hasOwn(input, "status")) updates.status = input.status as string | null;
  if (hasOwn(input, "owner")) updates.owner = input.owner as string | null;
  if (goal) {
    updates.goal = goal.plainText;
    updates.goal_document = campaignDocumentJson(goal.document);
  }
  if (hasOwn(input, "brief")) updates.brief = input.brief as string | null;
  if (hasOwn(input, "budget_planned")) updates.budget_planned = input.budget_planned as number | null;
  if (hasOwn(input, "budget_actual")) updates.budget_actual = input.budget_actual as number | null;
  if (hasOwn(input, "kpi_summary")) updates.kpi_summary = input.kpi_summary as string | null;
  if (notes) {
    updates.notes = notes.plainText;
    updates.notes_document = campaignDocumentJson(notes.document);
  }
  if (hasOwn(input, "performance_rating")) updates.performance_rating = input.performance_rating as number | null;
  if (hasOwn(input, "main_platform")) updates.main_platform = input.main_platform as string | null;

  const updated = await db
    .update(campaigns)
    .set(updates)
    .where(and(eq(campaigns.id, input.id), eq(campaigns.org_id, orgId), eq(campaigns.revision, input.expected_revision)))
    .returning({ id: campaigns.id });

  if (!updated.length) {
    throw new ConflictError("Campaign changed since it was loaded. Reload before saving again.");
  }

  return { ok: true };
}

export async function deleteCampaign(orgId: string, input: DeleteCampaignInput) {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, input.id), eq(campaigns.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Campaign not found");
    }

    await tx.delete(campaign_stations).where(and(eq(campaign_stations.campaign_id, input.id), eq(campaign_stations.org_id, orgId)));
    await tx.update(ops_tasks).set({ linked_campaign_id: null }).where(and(eq(ops_tasks.linked_campaign_id, input.id), eq(ops_tasks.org_id, orgId)));
    await tx.delete(campaigns).where(and(eq(campaigns.id, input.id), eq(campaigns.org_id, orgId)));

    return { ok: true };
  });
}
