import type { APIRoute } from "astro";
import { handleApiError, json } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import { db } from "../../lib/db";
import { works } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { HttpError } from "../../server/errors";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await request.json();
    if (!body.title || typeof body.title !== "string" || body.title.trim().length === 0) {
      throw new HttpError("Title is required", 400);
    }
    const id = crypto.randomUUID();
    await db.insert(works).values({
      id,
      org_id: orgId,
      title: body.title.trim(),
      isrc: body.isrc || null,
      iswc: body.iswc || null,
      audio_url: body.audio_url || null,
      duration: body.duration ? Number(body.duration) : null,
      genre: body.genre || null,
    });
    return json({ id, ok: true }, 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await request.json();
    if (!body.id) throw new HttpError("ID is required", 400);

    const existing = (await db.select().from(works).where(and(eq(works.id, body.id), eq(works.org_id, orgId))))[0];
    if (!existing) throw new HttpError("Work not found", 404);

    const updates: Record<string, unknown> = { updated_at: new Date() };
    if (body.title !== undefined) updates.title = body.title.trim() || existing.title;
    if (body.isrc !== undefined) updates.isrc = body.isrc || null;
    if (body.iswc !== undefined) updates.iswc = body.iswc || null;
    if (body.audio_url !== undefined) updates.audio_url = body.audio_url || null;
    if (body.duration !== undefined) updates.duration = body.duration ? Number(body.duration) : null;
    if (body.genre !== undefined) updates.genre = body.genre || null;

    await db.update(works).set(updates).where(and(eq(works.id, body.id), eq(works.org_id, orgId)));
    return json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
};

export const DELETE: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const body = await request.json();
    if (!body.id) throw new HttpError("ID is required", 400);

    const existing = (await db.select().from(works).where(and(eq(works.id, body.id), eq(works.org_id, orgId))))[0];
    if (!existing) throw new HttpError("Work not found", 404);

    await db.delete(works).where(and(eq(works.id, body.id), eq(works.org_id, orgId)));
    return json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
};
