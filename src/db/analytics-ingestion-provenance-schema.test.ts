import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./schema/analytics.ts", import.meta.url), "utf8");
const duplicateReviewsMigration = readFileSync(new URL("../../drizzle/0061_analytics_duplicate_reviews.sql", import.meta.url), "utf8");
const provenanceMigration = readFileSync(new URL("../../drizzle/0062_analytics_import_file_storage_provenance.sql", import.meta.url), "utf8");

describe("analytics ingestion provenance schema", () => {
  it("requires an explicit duplicate-review tenant", () => {
    expect(schema).toContain('org_id: text("org_id").notNull().references(() => orgs.id)');
    expect(duplicateReviewsMigration).toContain('"org_id" text NOT NULL');
    expect(duplicateReviewsMigration).not.toContain("DEFAULT 'true-nature'");
    expect(provenanceMigration).toContain('ALTER COLUMN "org_id" DROP DEFAULT');
  });

  it("records raw-object upload state without claiming an upload succeeded", () => {
    expect(schema).toContain('storage_status: text("storage_status").notNull().default("not_requested")');
    expect(schema).toContain('storage_uploaded_at: timestamp("storage_uploaded_at", { withTimezone: true })');
    expect(provenanceMigration).toContain('"storage_status" IN (\'not_requested\', \'pending\', \'uploaded\', \'failed\')');
  });
});
