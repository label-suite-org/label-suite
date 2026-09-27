import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./auth-schema.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0052_auth_passkeys.sql", import.meta.url), "utf8");
const journal = readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8");
const middleware = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");

describe("passkey auth schema", () => {
  it("keeps the plugin table explicitly inside label_suite", () => {
    expect(schema).toContain('schema.table("passkey"');
    expect(migration).toContain('"label_suite"."passkey"');
    expect(migration).toContain('REFERENCES "label_suite"."user"("id")');
    expect(migration).not.toMatch(/CREATE TABLE(?! IF NOT EXISTS)\s+"?public"?\./i);
  });

  it("contains every Better Auth 1.6 passkey field and lookup index", () => {
    for (const field of [
      "id",
      "name",
      "publicKey",
      "userId",
      "credentialID",
      "counter",
      "deviceType",
      "backedUp",
      "transports",
      "createdAt",
      "aaguid",
    ]) {
      expect(migration).toContain(`"${field}"`);
    }
    expect(migration).toContain('"passkey_userId_idx"');
    expect(migration).toContain('"passkey_credentialID_idx"');
  });

  it("keeps the passkey migration registered in the journal after the durable-worker migrations", () => {
    const parsed = JSON.parse(journal) as { entries: Array<{ idx: number; tag: string }> };
    const durableWorkerMigrations = ["0050_durable_background_jobs", "0051_job_worker_heartbeats"];
    const durableEndIdx = Math.max(
      ...durableWorkerMigrations
        .map((tag) => parsed.entries.find((entry) => entry.tag === tag)?.idx)
        .filter((idx): idx is number => idx != null),
    );
    const passkeyEntry = parsed.entries.find((entry) => entry.tag === "0052_auth_passkeys");
    const campaignContentEntry = parsed.entries.find((entry) => entry.tag === "0054_campaign_content");
    const artistRelationshipsEntry = parsed.entries.find((entry) => entry.tag === "0055_artist_relationships");
    const unifiedEventsEntry = parsed.entries.find((entry) => entry.tag === "0056_unified_events_restore");
    const emailLogProvenanceEntry = parsed.entries.find((entry) => entry.tag === "0057_email_log_delivery_provenance");
    const integrationCoreEntry = parsed.entries.find((entry) => entry.tag === "0058_integration_core_schema");
    const grantOwnerEntry = parsed.entries.find((entry) => entry.tag === "0059_grant_application_owner_membership");
    const grantExtractionEntry = parsed.entries.find((entry) => entry.tag === "0060_grant_document_extractions");
    const analyticsDuplicateReviewsEntry = parsed.entries.find((entry) => entry.tag === "0061_analytics_duplicate_reviews");
    const analyticsStorageProvenanceEntry = parsed.entries.find((entry) => entry.tag === "0062_analytics_import_file_storage_provenance");
    const sisenseStagingEntry = parsed.entries.find((entry) => entry.tag === "0063_sisense_staging_schema");
    const sisenseStagingIndexesEntry = parsed.entries.find((entry) => entry.tag === "0064_sisense_staging_indexes");

    expect(passkeyEntry).toEqual(expect.objectContaining({
      tag: "0052_auth_passkeys",
    }));
    expect(durableEndIdx).toBeGreaterThan(-1);
    expect(passkeyEntry!.idx).toBeGreaterThan(durableEndIdx);
    expect(campaignContentEntry).toEqual(expect.objectContaining({
      tag: "0054_campaign_content",
    }));
    expect(artistRelationshipsEntry).toEqual(expect.objectContaining({
      tag: "0055_artist_relationships",
    }));
    expect(unifiedEventsEntry).toEqual(expect.objectContaining({
      tag: "0056_unified_events_restore",
    }));
    expect(emailLogProvenanceEntry).toEqual(expect.objectContaining({
      tag: "0057_email_log_delivery_provenance",
    }));
    expect(integrationCoreEntry).toEqual(expect.objectContaining({
      tag: "0058_integration_core_schema",
    }));
    expect(grantOwnerEntry!.idx).toBeGreaterThan(integrationCoreEntry!.idx);
    expect(grantExtractionEntry!.idx).toBeGreaterThan(grantOwnerEntry!.idx);
    expect(analyticsDuplicateReviewsEntry!.idx).toBeGreaterThan(grantExtractionEntry!.idx);
    expect(analyticsStorageProvenanceEntry!.idx).toBeGreaterThan(analyticsDuplicateReviewsEntry!.idx);
    expect(sisenseStagingEntry!.idx).toBeGreaterThan(analyticsStorageProvenanceEntry!.idx);
    expect(sisenseStagingIndexesEntry!.idx).toBeGreaterThan(sisenseStagingEntry!.idx);
    expect(sisenseStagingIndexesEntry).toEqual(expect.objectContaining({
      tag: "0064_sisense_staging_indexes",
    }));
  });

  it("keeps reset-password in the middleware public-path inventory", () => {
    expect(middleware).toContain('"/reset-password"');
    expect(middleware).toContain("withPrivateCachePolicy");
  });
});
