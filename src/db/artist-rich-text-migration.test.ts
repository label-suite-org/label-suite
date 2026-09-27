import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { artists } from "./schema";

const migration = readFileSync(new URL("../../drizzle/0085_artist_bio_rich_text.sql", import.meta.url), "utf8");
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; tag: string }>;
};

describe("artist biography rich text migration", () => {
  it("adds an immutable-source-compatible document and review envelope", () => {
    for (const column of ["bio_document", "bio_html", "bio_review_status", "bio_reviewed_hash", "bio_reviewed_at", "bio_reviewed_by"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "${column}"`);
      expect(artists[column as keyof typeof artists]).toBeDefined();
    }
    expect(migration).toContain("artists_bio_review_status_check");
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im);
  });

  it("journals the additive migration after the current schema history", () => {
    const entry = journal.entries.find((candidate) => candidate.tag === "0085_artist_bio_rich_text");
    const predecessor = journal.entries.find((candidate) => candidate.tag === "0084_campaign_os_foundation");
    expect(entry?.idx).toBe((predecessor?.idx ?? -2) + 1);
  });
});
