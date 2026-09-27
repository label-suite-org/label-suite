import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { AnalyticsSandboxConfig } from "./analytics-sandbox-config";
import { seedAnalyticsSandbox, type SeedQueryClient } from "./analytics-sandbox-seed-core";

const config: AnalyticsSandboxConfig = {
  databaseUrl: "postgresql://sandbox:sandbox@127.0.0.1/analytics_sandbox",
  orgId: "sandbox-org",
  fixtureVersion: "analytics-sandbox-v1",
};

interface RecordedQuery {
  text: string;
  values: unknown[] | undefined;
}

function recordingClient(options: {
  failWhen?: (text: string) => boolean;
  missingTable?: string;
  organizationExists?: boolean;
  writeRows?: (text: string, values: unknown[] | undefined) => unknown[];
} = {}): SeedQueryClient & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    async query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number | null }> {
      queries.push({ text, values });
      if (options.failWhen?.(text)) throw new Error("seed write failed");
      if (text.includes("to_regclass")) {
        return { rows: [{ table_ref: values?.[0] === options.missingTable ? null : "label_suite.orgs" }] as T[] };
      }
      if (text.includes("from label_suite.orgs")) return { rows: options.organizationExists === false ? [] : [{ id: config.orgId }] as T[] };
      if (text.includes("insert into") && text.includes("returning id")) {
        return { rows: (options.writeRows?.(text, values) ?? [{ id: values?.[0] }]) as T[] };
      }
      return { rows: [] };
    },
  };
}

function findQuery(queries: RecordedQuery[], fragment: string): RecordedQuery {
  const query = queries.find(({ text }) => text.includes(fragment));
  if (!query) throw new Error(`Expected a query containing ${fragment}`);
  return query;
}

describe("seedAnalyticsSandbox", () => {
  it("seeds the fixture in a locked transaction with tenant-owned cleanup and ordered writes", async () => {
    const client = recordingClient();

    const summary = await seedAnalyticsSandbox(client, config);

    expect(summary).toEqual({
      fixtureVersion: "analytics-sandbox-v1",
      orgId: "sandbox-org",
      artists: 3,
      releases: 3,
      tracks: 5,
      metricRows: 78,
      importRuns: 1,
    });
    expect(client.queries[0]).toEqual({ text: "begin", values: undefined });
    expect(client.queries.slice(1, 9)).toMatchObject([
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.orgs"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.artists"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.releases"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.tracks"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.analytics_import_runs"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.analytics_metric_rows"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.analytics_metric_changes"] },
      { text: "select to_regclass($1) as table_ref", values: ["label_suite.analytics_import_files"] },
    ]);
    expect(client.queries[9]).toEqual({ text: "select pg_advisory_xact_lock(hashtext($1))", values: ["label-suite:sandbox-org:sisense"] });
    expect(client.queries.at(-1)).toEqual({ text: "commit", values: undefined });

    const metricDeletion = findQuery(client.queries, "delete from label_suite.analytics_metric_rows");
    expect(metricDeletion.text).toContain("org_id = $1");
    expect(metricDeletion.text).toContain("id like $2");
    expect(metricDeletion.text).toContain("dimensions ->> '_sandbox_fixture' = $3");
    expect(metricDeletion.values).toEqual(["sandbox-org", "sandbox-v1-sandbox-org:%", "analytics-sandbox-v1"]);

    const runDeletion = findQuery(client.queries, "delete from label_suite.analytics_import_runs");
    expect(runDeletion.text).toContain("org_id = $1");
    expect(runDeletion.text).toContain("id like $2");
    expect(runDeletion.text).toContain("metadata ->> 'sandbox_fixture' = $3");
    expect(runDeletion.values).toEqual(["sandbox-org", "sandbox-v1-sandbox-org:%", "analytics-sandbox-v1"]);

    const changeDeletion = findQuery(client.queries, "delete from label_suite.analytics_metric_changes");
    expect(changeDeletion.text).toContain("using label_suite.analytics_metric_rows as metric_rows, label_suite.analytics_import_runs as import_runs");
    expect(changeDeletion.text).toContain("changes.metric_row_id = metric_rows.id");
    expect(changeDeletion.text).toContain("changes.run_id = import_runs.id");
    expect(changeDeletion.text).toContain("changes.org_id = $1");
    expect(changeDeletion.values).toEqual(["sandbox-org", "sandbox-v1-sandbox-org:%", "analytics-sandbox-v1"]);
    const fileDeletion = findQuery(client.queries, "delete from label_suite.analytics_import_files");
    expect(fileDeletion.text).toContain("using label_suite.analytics_import_runs as import_runs");
    expect(fileDeletion.text).toContain("files.org_id = $1");
    expect(fileDeletion.values).toEqual(["sandbox-org", "sandbox-v1-sandbox-org:%", "analytics-sandbox-v1"]);

    const orgIndex = client.queries.findIndex(({ text }) => text.includes("from label_suite.orgs"));
    const artistIndex = client.queries.findIndex(({ text }) => text.includes("into label_suite.artists"));
    const releaseIndex = client.queries.findIndex(({ text }) => text.includes("into label_suite.releases"));
    const trackIndex = client.queries.findIndex(({ text }) => text.includes("into label_suite.tracks"));
    const runIndex = client.queries.findIndex(({ text }) => text.includes("into label_suite.analytics_import_runs"));
    const metricIndex = client.queries.findIndex(({ text }) => text.includes("into label_suite.analytics_metric_rows"));
    const changeDeletionIndex = client.queries.indexOf(changeDeletion);
    const fileDeletionIndex = client.queries.indexOf(fileDeletion);
    const metricDeletionIndex = client.queries.indexOf(metricDeletion);
    const runDeletionIndex = client.queries.indexOf(runDeletion);
    expect(orgIndex).toBeGreaterThan(9);
    expect(orgIndex).toBeLessThan(artistIndex);
    expect(artistIndex).toBeLessThan(releaseIndex);
    expect(releaseIndex).toBeLessThan(trackIndex);
    expect(trackIndex).toBeLessThan(runIndex);
    expect(runIndex).toBeLessThan(metricIndex);
    expect(trackIndex).toBeLessThan(changeDeletionIndex);
    expect(changeDeletionIndex).toBeLessThan(fileDeletionIndex);
    expect(fileDeletionIndex).toBeLessThan(metricDeletionIndex);
    expect(metricDeletionIndex).toBeLessThan(runDeletionIndex);
    expect(runDeletionIndex).toBeLessThan(runIndex);

    for (const query of client.queries.filter(({ text }) => text.includes("insert into") || text.includes("on conflict"))) {
      expect(query.text).toContain("$");
      expect(query.text).not.toContain("sandbox-org");
      expect(query.text).not.toContain("North Window");
      expect(query.text).not.toContain("analytics-sandbox-v1");
    }
    for (const table of ["artists", "releases", "tracks"]) {
      const upsert = findQuery(client.queries, `into label_suite.${table}`);
      expect(upsert.text).toContain("on conflict (id)");
      expect(upsert.text).toContain(`where label_suite.${table}.org_id = excluded.org_id`);
    }
  });

  it("uses the same Sisense advisory lock identity as the production sync", async () => {
    const client = recordingClient();
    await seedAnalyticsSandbox(client, config);
    const lock = findQuery(client.queries, "pg_advisory_xact_lock");
    const sisenseSync = readFileSync(new URL("./sisense-sync.ts", import.meta.url), "utf8");

    expect(lock.values).toEqual(["label-suite:sandbox-org:sisense"]);
    expect(sisenseSync).toContain('const SOURCE = "sisense"');
    expect(sisenseSync).toContain("`label-suite:${orgId}:${SOURCE}`");
  });

  it("rolls back and rethrows a write failure", async () => {
    const client = recordingClient({ failWhen: (text) => text.includes("into label_suite.artists") });

    await expect(seedAnalyticsSandbox(client, config)).rejects.toThrow("seed write failed");

    expect(client.queries.at(-1)).toEqual({ text: "rollback", values: undefined });
  });

  it("attempts rollback when beginning the transaction fails", async () => {
    const client = recordingClient({ failWhen: (text) => text === "begin" });

    await expect(seedAnalyticsSandbox(client, config)).rejects.toThrow("seed write failed");

    expect(client.queries).toEqual([
      { text: "begin", values: undefined },
      { text: "rollback", values: undefined },
    ]);
  });

  it("rejects a database missing a required child table before fixture writes", async () => {
    const client = recordingClient({ missingTable: "label_suite.analytics_metric_changes" });

    await expect(seedAnalyticsSandbox(client, config)).rejects.toThrow(
      "Analytics sandbox database is not migrated; run npm run db:migrate against analytics_sandbox.",
    );

    expect(client.queries.at(-1)).toEqual({ text: "rollback", values: undefined });
    expect(client.queries.some(({ text }) => text.includes("pg_advisory_xact_lock") || text.includes("insert into"))).toBe(false);
  });

  it("rejects a missing explicit organization before fixture writes", async () => {
    const client = recordingClient({ organizationExists: false });

    await expect(seedAnalyticsSandbox(client, config)).rejects.toThrow("Analytics sandbox organization does not exist: sandbox-org");

    expect(client.queries.at(-1)).toEqual({ text: "rollback", values: undefined });
    expect(client.queries.some(({ text }) => text.includes("insert into"))).toBe(false);
  });

  it("rejects a cross-organization conflict no-op instead of reporting a successful seed", async () => {
    const client = recordingClient({
      writeRows: (text) => text.includes("into label_suite.artists") ? [] : [{ id: "written" }],
    });

    await expect(seedAnalyticsSandbox(client, config)).rejects.toThrow("Analytics sandbox write did not affect the expected record.");

    expect(client.queries.at(-1)).toEqual({ text: "rollback", values: undefined });
  });

  it("uses identical deterministic parameters and returns the same summary on a second call", async () => {
    const first = recordingClient();
    const second = recordingClient();

    const firstSummary = await seedAnalyticsSandbox(first, config);
    const secondSummary = await seedAnalyticsSandbox(second, config);

    expect(secondSummary).toEqual(firstSummary);
    expect(second.queries).toEqual(first.queries);
  });
});
