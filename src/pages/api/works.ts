import type { APIRoute } from "astro";
import { handleApiError, json, parseJson } from "../../server/api";
import { requireCapability } from "../../server/tenant";
import { db } from "../../lib/db";
import { works } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { HttpError } from "../../server/errors";

import { createWork, createWorkSchema, updateWork, updateWorkSchema } from "../../server/works";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, createWorkSchema);
    return json(await createWork(orgId, input, locals.user?.id ?? null), 201);
  } catch (err) {
    return handleApiError(err);
  }
};

export const PUT: APIRoute = async ({ request, locals }) => {
  try {
    const orgId = requireCapability(locals, "operations.mutate");
    const input = await parseJson(request, updateWorkSchema);
    return json(await updateWork(orgId, input, locals.user?.id ?? null));
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
