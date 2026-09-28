import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  data_quality_issues,
  release_delivery_attempts,
  releases,
  tracks,
} from "../db/schema";
import { db } from "../lib/db";
import { NotFoundError } from "./errors";
import {
  buildManualDeliveryPayload,
  deliveryPayloadWarnings,
  hashDeliveryPayload,
  type ManualDeliveryPayload,
} from "./delivery-export-core";
import { requiredText } from "./validation";

const providerKeySchema = requiredText.regex(/^[a-z0-9][a-z0-9_-]*$/, "Provider key must be lowercase");

export const manualDeliveryExportSchema = z.object({
  provider_key: providerKeySchema.default("manual_dsp"),
  account_label: requiredText.default("Manual export"),
  payload_version: z.number().int().positive().default(1),
}).strict();

export type ManualDeliveryExport = {
  attempt: typeof release_delivery_attempts.$inferSelect;
  payload: ManualDeliveryPayload;
  warnings: ReturnType<typeof deliveryPayloadWarnings>;
};

export async function exportReleaseDelivery(
  orgId: string,
  releaseId: string,
  raw: z.input<typeof manualDeliveryExportSchema>,
  createdBy: string | null = null,
): Promise<ManualDeliveryExport> {
  const input = manualDeliveryExportSchema.parse(raw);
  return db.transaction(async tx => {
    const [release] = await tx
      .select({
        id: releases.id,
        title: releases.title,
        artist_id: releases.artist_id,
        release_date: releases.release_date,
        format: releases.format,
        upc_ean: releases.upc_ean,
      })
      .from(releases)
      .where(and(eq(releases.org_id, orgId), eq(releases.id, releaseId)))
      .limit(1).for("update");
    if (!release) throw new NotFoundError("Release not found in active workspace");

    const releaseTracks = await tx
      .select({
        id: tracks.id,
        title: tracks.title,
        position: tracks.position,
        version: tracks.version,
        isrc: tracks.isrc,
        duration: tracks.duration,
        work_id: tracks.work_id,
      })
      .from(tracks)
      .where(and(eq(tracks.org_id, orgId), eq(tracks.release_id, releaseId)));

    const payload = buildManualDeliveryPayload(release, releaseTracks, input.payload_version);
    const payloadHash = hashDeliveryPayload(payload);
    const warnings = deliveryPayloadWarnings(payload);
    const [latest] = await tx
      .select()
      .from(release_delivery_attempts)
      .where(and(
        eq(release_delivery_attempts.org_id, orgId),
        eq(release_delivery_attempts.release_id, releaseId),
        eq(release_delivery_attempts.provider_key, input.provider_key),
        eq(release_delivery_attempts.account_label, input.account_label),
        eq(release_delivery_attempts.payload_version, input.payload_version),
      ))
      .orderBy(desc(release_delivery_attempts.patch_version))
      .limit(1);

    if (latest?.payload_hash === payloadHash) {
      return { attempt: latest, payload, warnings };
    }

    const patchVersion = (latest?.patch_version ?? 0) + 1;
    const id = `delivery_${crypto.randomUUID()}`;
    const exportedAt = new Date().toISOString();
    const warningEvidence = warnings.length ? { warnings } : {};
    const [attempt] = await tx
      .insert(release_delivery_attempts)
      .values({
        id,
        org_id: orgId,
        release_id: releaseId,
        provider_key: input.provider_key,
        account_label: input.account_label,
        payload_version: input.payload_version,
        patch_version: patchVersion,
        status: "exported",
        payload,
        payload_hash: payloadHash,
        response_evidence: {
          mode: "manual_export",
          media_type: "application/json",
          exported_at: exportedAt,
          ...warningEvidence,
        },
        created_by: createdBy,
        updated_at: new Date(),
      })
      .returning();

    await tx.update(data_quality_issues).set({status:"resolved",updated_at:new Date()}).where(and(
      eq(data_quality_issues.org_id,orgId),eq(data_quality_issues.source,"manual_delivery_export"),
      sql`exists(select 1 from ${release_delivery_attempts} where ${release_delivery_attempts.org_id}=${orgId}
        and ${release_delivery_attempts.release_id}=${releaseId} and ${release_delivery_attempts.provider_key}=${input.provider_key}
        and ${release_delivery_attempts.account_label}=${input.account_label}
        and ${release_delivery_attempts.id}=${data_quality_issues.details}->>'attempt_id')`,
    ));
    for (const warning of warnings) {
      const warningKey = createHash("sha256").update(JSON.stringify([releaseId,input.provider_key,input.account_label,warning.code,warning.track_id??null])).digest("hex");
      const details = {message:warning.message,release_id:releaseId,provider_key:input.provider_key,account_label:input.account_label,attempt_id:attempt.id};
      await tx
        .insert(data_quality_issues)
        .values({
          id: `dq_delivery_${warningKey}`,
          org_id: orgId,
          source: "manual_delivery_export",
          issue_type: warning.code,
          idempotency_key: `manual_delivery_export:${warningKey}`,
          priority: "P2",
          status: "open",
          label_suite_object_type: warning.track_id ? "track" : "release",
          label_suite_object_id: warning.track_id ?? releaseId,
          details,
          updated_at: new Date(),
        })
        .onConflictDoUpdate({ target: [data_quality_issues.org_id, data_quality_issues.idempotency_key], set:{details,status:"open",updated_at:new Date()} });
    }

    return { attempt, payload, warnings };
  });
}

export async function listReleaseDeliveryAttempts(orgId: string, releaseId: string) {
  return db
    .select()
    .from(release_delivery_attempts)
    .where(and(eq(release_delivery_attempts.org_id, orgId), eq(release_delivery_attempts.release_id, releaseId)))
    .orderBy(desc(release_delivery_attempts.created_at));
}
