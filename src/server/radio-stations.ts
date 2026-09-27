import { z } from "zod";
import { and, asc, eq, sql } from "drizzle-orm";
import { campaign_stations, radio_stations } from "../db/schema";
import { db } from "../lib/db";
import { ConflictError, NotFoundError } from "./errors";
import { hasOwn, idSchema, nullableText } from "./validation";

const radioStationBaseSchema = {
  name: z.string().trim().min(1, "Station name is required"),
  call_sign: nullableText,
  frequency: nullableText,
  city: nullableText,
  state: nullableText,
  country: nullableText,
  email: nullableText,
  phone: nullableText,
  website: nullableText,
  dj_name: nullableText,
  tier: nullableText,
  notes: nullableText,
};

export const createRadioStationSchema = z.object({
  id: idSchema.optional(),
  ...radioStationBaseSchema,
});

export const updateRadioStationSchema = z.object({
  id: idSchema,
  ...Object.fromEntries(
    Object.entries(radioStationBaseSchema).map(([key, schema]) => [key, schema.optional()]),
  ),
});

export const deleteRadioStationSchema = z.object({
  id: idSchema,
});

export type CreateRadioStationInput = z.infer<typeof createRadioStationSchema>;
export type UpdateRadioStationInput = z.infer<typeof updateRadioStationSchema>;
export type DeleteRadioStationInput = z.infer<typeof deleteRadioStationSchema>;

export async function listRadioStations(orgId: string) {
  return db
    .select()
    .from(radio_stations)
    .where(eq(radio_stations.org_id, orgId))
    .orderBy(asc(radio_stations.name));
}

export async function createRadioStation(orgId: string, input: CreateRadioStationInput) {
  const id = input.id ?? crypto.randomUUID();

  await db.insert(radio_stations).values({
    id,
    org_id: orgId,
    name: input.name,
    call_sign: input.call_sign ?? null,
    frequency: input.frequency ?? null,
    city: input.city ?? null,
    state: input.state ?? null,
    country: input.country ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    website: input.website ?? null,
    dj_name: input.dj_name ?? null,
    tier: input.tier ?? null,
    notes: input.notes ?? null,
  }).onConflictDoNothing({ target: radio_stations.id });

  return { id, ok: true };
}

export async function updateRadioStation(orgId: string, input: UpdateRadioStationInput) {
  const updates: Partial<typeof radio_stations.$inferInsert> = { updated_at: new Date() };

  for (const field of Object.keys(radioStationBaseSchema)) {
    if (hasOwn(input, field)) {
      updates[field as keyof typeof updates] = input[field as keyof typeof input] as never;
    }
  }

  const updated = await db
    .update(radio_stations)
    .set(updates)
    .where(and(eq(radio_stations.id, input.id), eq(radio_stations.org_id, orgId)))
    .returning({ id: radio_stations.id });

  if (!updated.length) {
    throw new NotFoundError("Radio station not found");
  }

  return { ok: true };
}

export async function deleteRadioStation(orgId: string, input: DeleteRadioStationInput) {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: radio_stations.id })
      .from(radio_stations)
      .where(and(eq(radio_stations.id, input.id), eq(radio_stations.org_id, orgId)));

    if (!rows.length) {
      throw new NotFoundError("Radio station not found");
    }

    const usageCount = await tx
      .select({ count: sql<number>`count(*)` })
      .from(campaign_stations)
      .where(and(eq(campaign_stations.station_id, input.id), eq(campaign_stations.org_id, orgId)));

    const nUsages = Number(usageCount[0]?.count ?? 0);
    if (nUsages > 0) {
      throw new ConflictError(
        `Cannot delete radio station - still referenced by ${nUsages} campaign link${nUsages > 1 ? "s" : ""}. Remove those references first.`,
      );
    }

    await tx.delete(radio_stations).where(and(eq(radio_stations.id, input.id), eq(radio_stations.org_id, orgId)));
  });

  return { ok: true };
}
