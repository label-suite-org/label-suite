import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../../server/api";
import { requireCapability } from "../../../server/tenant";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../../lib/db";
import { email_templates } from "../../../db/schema";

const templateSourceReferencesSchema = z.object({
  release_id: z.string().nullable().optional(),
  artist_id: z.string().nullable().optional(),
  document_ids: z.array(z.string()).default([]),
  media_asset_ids: z.array(z.string()).default([]),
}).strict();

function normalizeTemplateSourceReferences(input: z.infer<typeof templateSourceReferencesSchema> | undefined) {
  return {
    release_id: input?.release_id ?? null,
    artist_id: input?.artist_id ?? null,
    document_ids: input?.document_ids ?? [],
    media_asset_ids: input?.media_asset_ids ?? [],
  };
}

export const prerender = false;

// ─── Schemas ────────────────────────────────────────────

const createTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, "Template name is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  source_references: templateSourceReferencesSchema.optional(),
  description: z.string().optional(),
  is_default: z.boolean().optional(),
});

const updateTemplateSchema = z.object({
  id: z.string().min(1, "Template ID is required"),
  name: z.string().min(1).optional(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  source_references: templateSourceReferencesSchema.optional(),
  description: z.string().optional(),
  is_default: z.boolean().optional(),
});

// ─── GET: list all templates ────────────────────────────

export const GET: APIRoute = async ({ locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const rows = await db
      .select()
      .from(email_templates)
      .where(eq(email_templates.org_id, orgId));
    return json(rows, 200);
  } catch (err) {
    return handleApiError(err);
  }
};

// ─── POST: create template ──────────────────────────────

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, createTemplateSchema);

    const id = body.id ?? crypto.randomUUID();
    const sourceReferences = normalizeTemplateSourceReferences(body.source_references);

    await db.insert(email_templates).values({
      id,
      org_id: orgId,
      name: body.name,
      subject: body.subject,
      body: body.body,
      description: body.description ?? null,
      is_default: body.is_default ?? false,
      review_status: "draft",
      reviewed_at: null,
      reviewed_by: null,
      source_version: null,
      source_references: sourceReferences,
      current_version: 1,
    });

    return json({ id, ok: true }, 201);
  } catch (err) {
    return handleApiError(err);
  }
};

// ─── PUT: update template ───────────────────────────────

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, updateTemplateSchema);

    const existingRows = await db
      .select({
        subject: email_templates.subject,
        body: email_templates.body,
        current_version: email_templates.current_version,
        review_status: email_templates.review_status,
        source_references: email_templates.source_references,
      })
      .from(email_templates)
      .where(and(eq(email_templates.id, body.id), eq(email_templates.org_id, orgId)));

    const existing = existingRows[0];
    if (!existing) {
      return json({ error: "Template not found" }, 404);
    }

    const sourceChanged = body.source_references !== undefined;
    const subjectChanged = body.subject !== undefined && body.subject !== existing.subject;
    const bodyChanged = body.body !== undefined && body.body !== existing.body;
    const contentChanged = sourceChanged || subjectChanged || bodyChanged;

    const nextVersion = contentChanged ? (existing.current_version ?? 1) + 1 : existing.current_version;
    const clearReviewMetadata = contentChanged ? {
      reviewed_at: null,
      reviewed_by: null,
      source_version: null,
      review_status: "draft",
    } : {};

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.subject !== undefined) updates.subject = body.subject;
    if (body.body !== undefined) updates.body = body.body;
    if (body.description !== undefined) updates.description = body.description;
    if (body.is_default !== undefined) updates.is_default = body.is_default;
    if (body.source_references !== undefined) {
      updates.source_references = normalizeTemplateSourceReferences(body.source_references);
    }
    if (contentChanged) updates.current_version = nextVersion;
    Object.assign(updates, clearReviewMetadata);

    await db
      .update(email_templates)
      .set(updates)
      .where(and(eq(email_templates.id, body.id), eq(email_templates.org_id, orgId)));

    return json({ ok: true }, 200);
  } catch (err) {
    return handleApiError(err);
  }
};

// ─── DELETE: delete template ────────────────────────────

const deleteTemplateSchema = z.object({
  id: z.string().min(1, "Template ID is required"),
});

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await parseJson(request, deleteTemplateSchema);

    await db
      .delete(email_templates)
      .where(and(eq(email_templates.id, body.id), eq(email_templates.org_id, orgId)));

    return json({ ok: true }, 200);
  } catch (err) {
    return handleApiError(err);
  }
};
