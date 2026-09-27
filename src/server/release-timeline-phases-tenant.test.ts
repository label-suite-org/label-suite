import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const whereClauses: unknown[] = [];
  function result() {
    const promise = Promise.resolve([]);
    return { orderBy: vi.fn(async () => []), then: promise.then.bind(promise), catch: promise.catch.bind(promise), finally: promise.finally.bind(promise) };
  }
  return {
    whereClauses,
    db: { select: vi.fn(() => {
      const chain = { from: vi.fn(() => chain), leftJoin: vi.fn(() => chain), where: vi.fn((clause: unknown) => { whereClauses.push(clause); return result(); }) };
      return chain;
    }) },
  };
});

vi.mock("../lib/db", () => ({ db: database.db }));

import { listReleaseTimelinePhases } from "./release-timeline";

describe("native release phase tenant boundary", () => {
  beforeEach(() => { database.whereClauses.length = 0; vi.clearAllMocks(); });

  it("batches every canonical phase input inside the active workspace and release set", async () => {
    const phases = await listReleaseTimelinePhases("org-a", [{ id: "release-a", release_date: "2026-09-01" }]);
    expect(phases.has("release-a")).toBe(true);
    expect(database.whereClauses).toHaveLength(3);
    const dialect = new PgDialect();
    for (const clause of database.whereClauses) {
      const query = dialect.sqlToQuery(clause as SQL);
      expect(query.params).toEqual(expect.arrayContaining(["org-a", "release-a"]));
      expect(query.sql).toContain("org_id");
    }
  });
});
