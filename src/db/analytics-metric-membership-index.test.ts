import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schema = readFileSync(new URL("./schema/analytics.ts", import.meta.url), "utf8");
const migrationUrl = new URL("../../drizzle/0077_analytics_metric_rows_last_seen_membership.sql", import.meta.url);
const migration = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";
const journal = JSON.parse(readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8")) as {
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

describe("analytics current-snapshot membership index", () => {
  it("declares the exact tenant and last-seen membership key in schema", () => {
    expect(schema).toContain('index("analytics_metric_rows_membership_idx").on(\n'
      + "    table.org_id,\n"
      + "    table.source,\n"
      + "    table.widget_key,\n"
      + "    table.artist_id,\n"
      + "    table.last_seen_run_id,\n"
      + "  )");
  });

  it("adds the same index idempotently without destructive rewrites", () => {
    expect(migration).toContain('CREATE INDEX IF NOT EXISTS "analytics_metric_rows_membership_idx"');
    expect(migration).toContain('("org_id", "source", "widget_key", "artist_id", "last_seen_run_id")');
    expect(migration).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP TABLE)\b/im);
  });

  it("journals 0077 immediately after the current 0076 migration", () => {
    const entry = journal.entries.find((candidate) => (
      candidate.tag === "0077_analytics_metric_rows_last_seen_membership"
    ));
    const predecessor = journal.entries.find((candidate) => (
      candidate.tag === "0076_campaign_enrichment_local_tools"
    ));

    expect(entry).toEqual(expect.objectContaining({
      idx: 69,
      version: "7",
      tag: "0077_analytics_metric_rows_last_seen_membership",
      breakpoints: true,
    }));
    expect(entry!.idx).toBe(predecessor!.idx + 1);
    expect(entry!.when).toBeGreaterThan(predecessor!.when);
  });
});
