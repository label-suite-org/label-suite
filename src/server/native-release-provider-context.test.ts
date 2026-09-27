import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const database = vi.hoisted(() => {
  const state = {
    clauses: [] as unknown[],
    joins: [] as unknown[],
    projectRows: [] as Record<string, unknown>[],
    connectionRows: [] as Record<string, unknown>[],
    dspRows: [] as Record<string, unknown>[],
    limits: [] as number[],
    fileCountRows: [] as Array<Record<string, unknown>[]>,
  };
  const result = (rows: Record<string, unknown>[]) => {
    const promise = Promise.resolve(rows);
    const chain = {
      orderBy: () => chain,
      limit: async (count: number) => {
        state.limits.push(count);
        return rows;
      },
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return chain;
  };
  const db = {
    select: () => {
      let dspJoin = false;
      const chain = {
        from: () => chain,
        innerJoin: (_table: unknown, condition: unknown) => {
          dspJoin = true;
          state.joins.push(condition);
          return chain;
        },
        where: (condition: unknown) => {
          state.clauses.push(condition);
          const params = new PgDialect().sqlToQuery(condition as SQL).params;
          if (dspJoin) return result(state.dspRows);
          if (params.includes("project-a")) return result(state.fileCountRows.shift() ?? []);
          if (params.includes("release-a")) return result(state.projectRows);
          return result(state.connectionRows);
        },
      };
      return chain;
    },
  };
  return { db, state };
});

vi.mock("../lib/db", () => ({ db: database.db }));

import { getNativeReleaseProviderContext } from "./native-release-provider-context";

function sqlQuery(condition: unknown) {
  return new PgDialect().sqlToQuery(condition as SQL);
}

describe("native release provider context read boundary", () => {
  beforeEach(() => {
    database.state.clauses.length = 0;
    database.state.joins.length = 0;
    database.state.projectRows = [];
    database.state.connectionRows = [];
    database.state.dspRows = [];
    database.state.limits = [];
    database.state.fileCountRows = [];
  });

  it("surfaces a failed Samply connection without a linked project through the persisted read path", async () => {
    database.state.connectionRows = [{ status: "failed" }];

    await expect(getNativeReleaseProviderContext("org-a", "release-a")).resolves.toMatchObject({
      audio: {
        state: "failure",
        item_count: 0,
        unresolved_item_count: 0,
        access: { state: "unavailable", reason: "No linked Samply project" },
      },
      dsp: { source: "canonical_dsp_pitches", pitches: [] },
    });
  });

  it("renders tenant predicates for Samply project/file reads and the DSP org-scoped join", async () => {
    database.state.projectRows = [{ id: "project-a", remoteProjectId: "remote-a", remoteProjectName: null, uploadEnabled: true, primaryPlayerId: null, lastSyncedAt: null, metadata: null }];
    database.state.connectionRows = [{ status: "verified" }];
    database.state.fileCountRows = [[{ count: "2" }], [{ count: "1" }]];

    await getNativeReleaseProviderContext("org-a", "release-a");

    const clauses = database.state.clauses.map(sqlQuery);
    const samplyProject = clauses.find((query) => query.params.includes("release-a") && query.sql.includes("samply_projects"));
    const samplyFiles = clauses.filter((query) => query.params.includes("project-a"));
    const dspWhere = clauses.find((query) => query.sql.includes("dsp_pitch_releases"));

    expect(samplyProject).toMatchObject({ params: ["org-a", "release-a"] });
    expect(samplyFiles).toHaveLength(2);
    expect(samplyFiles[0]).toMatchObject({ params: ["org-a", "project-a", "missing_remote"] });
    expect(samplyFiles[1]).toMatchObject({ params: ["org-a", "project-a", "missing_remote", "synced"] });

    const dspJoin = sqlQuery(database.state.joins[0]);
    expect(dspJoin.sql).toContain("org_id");
    expect(dspJoin.params).toEqual(["org-a"]);
    expect(dspWhere?.sql).toContain("org_id");
    expect(dspWhere?.params).toEqual(["org-a", "release-a"]);
  });

  it("keeps the native DSP view bounded and truthfully marks a twenty-first pitch", async () => {
    database.state.dspRows = Array.from({ length: 21 }, (_, index) => ({
      id: `pitch-${index}`,
      platform: "Spotify",
      status: "sent",
      sent_date: new Date(`2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
      response: null,
    }));

    await expect(getNativeReleaseProviderContext("org-a", "release-a")).resolves.toMatchObject({
      dsp: {
        pitches: Array.from({ length: 20 }, (_, index) => expect.objectContaining({ id: `pitch-${index}` })),
        has_more: true,
      },
    });
    expect(database.state.limits).toContain(21);
  });
});
