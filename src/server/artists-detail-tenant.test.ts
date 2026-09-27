import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const whereClauses: unknown[] = [];
  const rows: unknown[][] = [];

  function result(value: unknown[]) {
    const promise = Promise.resolve(value);
    return {
      orderBy: vi.fn(async () => value),
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
  }

  return {
    whereClauses,
    rows,
    db: {
      select: vi.fn(() => {
        const value = rows.shift() ?? [];
        const chain = {
          from: vi.fn(() => chain),
          leftJoin: vi.fn(() => chain),
          where: vi.fn((clause: unknown) => {
            whereClauses.push(clause);
            return result(value);
          }),
        };
        return chain;
      }),
    },
  };
});

vi.mock("../lib/db", () => ({ db: database.db }));

import { getArtistDetail } from "./artists";

describe("artist detail tenant boundary", () => {
  beforeEach(() => {
    database.whereClauses.length = 0;
    database.rows.length = 0;
    vi.clearAllMocks();
  });

  it("queries the canonical artist and every relationship inside the active org", async () => {
    database.rows.push([], [], [], [], [], [], []);

    const detail = await getArtistDetail("org-a", "artist-from-org-b");

    expect(detail.artist).toBeNull();
    expect(database.whereClauses).toHaveLength(7);
    const dialect = new PgDialect();
    const queries = database.whereClauses.map((clause) => dialect.sqlToQuery(clause as SQL));
    expect(queries[0]?.params).toEqual(expect.arrayContaining(["artist-from-org-b", "org-a"]));
    for (const query of queries) {
      expect(query.params).toContain("org-a");
      expect(query.sql).toContain("org_id");
    }
  });
});
