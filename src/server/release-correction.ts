import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { releases } from "../db/schema";
import { db } from "../lib/db";
import { computeReleaseReadiness } from "../lib/readiness";
import { ConflictError, NotFoundError } from "./errors";
import { updateReleaseForNative } from "./releases";

export const releaseCorrectionSchema = z.object({
  field: z.enum(["cover_art_url", "upc_ean", "release_date", "format"]),
  value: z.string().trim().max(4096).nullable(),
  expected_updated_at: z.iso.datetime(),
}).strict().superRefine((input, context) => {
  if (input.field === "release_date" && input.value && !z.iso.date().safeParse(input.value).success) {
    context.addIssue({ code: "custom", path: ["value"], message: "Use a valid YYYY-MM-DD date" });
  }
});

export async function getReleaseReadinessSnapshot(orgId: string, id: string) {
  return db.transaction(async (tx) => {
    const [release] = await tx.select({
      id: releases.id, title: releases.title, updated_at: releases.updated_at,
      cover_art_url: releases.cover_art_url, upc_ean: releases.upc_ean,
      release_date: releases.release_date, format: releases.format,
    }).from(releases).where(and(eq(releases.org_id, orgId), eq(releases.id, id)));
    if (!release) throw new NotFoundError("Release not found");
    const readiness = await computeReleaseReadiness(id, tx, orgId);
    const [current] = await tx.select({ updated_at: releases.updated_at }).from(releases)
      .where(and(eq(releases.org_id, orgId), eq(releases.id, id)));
    if (!current || current.updated_at?.getTime() !== release.updated_at?.getTime()) {
      throw new ConflictError("Release changed while loading checks; refresh and compare again");
    }
    return { release: { ...release, updated_at: release.updated_at?.toISOString() ?? null }, readiness, observed_at: new Date().toISOString() };
  });
}

export type ReleaseReadinessSnapshot = Awaited<ReturnType<typeof getReleaseReadinessSnapshot>>;

export async function correctReleaseField(orgId: string, id: string, actorUserId: string, input: z.infer<typeof releaseCorrectionSchema>) {
  await updateReleaseForNative(orgId, {
    id, expected_updated_at: input.expected_updated_at, [input.field]: input.value || null,
  }, actorUserId);
  // Read back after the shared mutation has refreshed canonical readiness.
  return getReleaseReadinessSnapshot(orgId, id);
}
