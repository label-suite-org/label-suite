import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { dsp_pitch_releases, dsp_pitches } from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableText } from "./validation";

export const createDspPitchSchema = z.object({
  id: idSchema.optional(),
  release_id: idSchema,
  platform: nullableText,
  status: nullableText,
  sent_date: nullableText,
  response: nullableText,
});

export const updateDspPitchSchema = z.object({
  id: idSchema,
  platform: nullableText,
  status: nullableText,
  sent_date: nullableText,
  response: nullableText,
});

export type CreateDspPitchInput = z.infer<typeof createDspPitchSchema>;
export type UpdateDspPitchInput = z.infer<typeof updateDspPitchSchema>;

export async function createDspPitch(orgId: string, input: CreateDspPitchInput) {
  return db.transaction(async (tx) => {
    const id = input.id ?? crypto.randomUUID();

    await tx.insert(dsp_pitches).values({
      id,
      org_id: orgId,
      release_id: input.release_id,
      platform: input.platform ?? "Spotify",
      status: input.status ?? "draft",
      sent_date: input.sent_date ? new Date(input.sent_date) : null,
      response: input.response ?? null,
    }).onConflictDoNothing({ target: dsp_pitches.id });

    await linkDspPitchToRelease(tx, orgId, id, input.release_id);

    return { id, ok: true };
  });
}

export async function listDspPitchesForRelease(
  orgId: string,
  releaseId: string,
  options: { limit?: number } = {},
) {
  const query = db
    .select({
      id: dsp_pitches.id,
      platform: dsp_pitches.platform,
      status: dsp_pitches.status,
      sent_date: dsp_pitches.sent_date,
      response: dsp_pitches.response,
    })
    .from(dsp_pitch_releases)
    .innerJoin(dsp_pitches, and(
      eq(dsp_pitch_releases.dsp_pitch_id, dsp_pitches.id),
      eq(dsp_pitches.org_id, orgId),
    ))
    .where(and(
      eq(dsp_pitch_releases.org_id, orgId),
      eq(dsp_pitch_releases.release_id, releaseId),
    ))
    .orderBy(sql`${dsp_pitches.sent_date} desc nulls last`, desc(dsp_pitches.created_at));

  return options.limit === undefined ? query : query.limit(options.limit);
}

export async function updateDspPitch(orgId: string, input: UpdateDspPitchInput) {
  const updates: Partial<typeof dsp_pitches.$inferInsert> = {};

  if (hasOwn(input, "platform")) updates.platform = input.platform as string | null;
  if (hasOwn(input, "status")) updates.status = input.status as string | null;
  if (hasOwn(input, "sent_date")) {
    updates.sent_date = input.sent_date ? new Date(input.sent_date) : null;
  }
  if (hasOwn(input, "response")) updates.response = input.response as string | null;

  const updated = await db
    .update(dsp_pitches)
    .set(updates)
    .where(and(eq(dsp_pitches.id, input.id), eq(dsp_pitches.org_id, orgId)))
    .returning({ id: dsp_pitches.id });

  if (!updated.length) {
    throw new NotFoundError("DSP pitch not found");
  }

  return { ok: true };
}

async function linkDspPitchToRelease(
  client: Pick<typeof db, "insert">,
  orgId: string,
  pitchId: string,
  releaseId: string,
): Promise<void> {
  await client.insert(dsp_pitch_releases).values({
    id: `${pitchId}:${releaseId}`,
    org_id: orgId,
    dsp_pitch_id: pitchId,
    release_id: releaseId,
  }).onConflictDoNothing({
    target: [
      dsp_pitch_releases.org_id,
      dsp_pitch_releases.dsp_pitch_id,
      dsp_pitch_releases.release_id,
    ],
  });
}
