import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const database = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  returning: vi.fn(),
}));

vi.mock("../lib/db", () => ({ db: { insert: database.insert } }));

import { createDataQualityIssue } from "./integrations";

beforeEach(() => {
  vi.clearAllMocks();
  database.returning.mockResolvedValue([{ id: "dq-1" }]);
  database.onConflictDoUpdate.mockReturnValue({ returning: database.returning });
  database.values.mockReturnValue({ onConflictDoUpdate: database.onConflictDoUpdate });
  database.insert.mockReturnValue({ values: database.values });
});

describe("data-quality issue replay coalescing", () => {
  it("preserves terminal state and resolution metadata on a duplicate report", async () => {
    await createDataQualityIssue("org-a", {
      source: "warm",
      issue_type: "unmatched_track",
      external_object_type: "track",
      external_object_id: "external-track-1",
      details: { import: "replay" },
    });

    const update = database.onConflictDoUpdate.mock.calls[0][0].set;
    const dialect = new PgDialect();
    const statusQuery = dialect.sqlToQuery(update.status);
    const detailsQuery = dialect.sqlToQuery(update.details);
    const objectTypeQuery = dialect.sqlToQuery(update.label_suite_object_type);
    const objectIdQuery = dialect.sqlToQuery(update.label_suite_object_id);

    for (const query of [statusQuery, detailsQuery, objectTypeQuery, objectIdQuery]) {
      expect(query.sql).toContain("in ('resolved', 'ignored')");
    }
    expect(statusQuery.params).toContain("open");
    expect(detailsQuery.params).toContainEqual({ import: "replay" });
  });
});
