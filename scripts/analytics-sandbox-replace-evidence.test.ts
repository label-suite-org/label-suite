import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  assertAnalyticsSandboxReplacementTarget,
  replaceAnalyticsSandboxEvidence,
  type AnalyticsEvidenceQueryClient,
} from "./analytics-sandbox-replace-evidence";

interface RecordedQuery {
  text: string;
  values: unknown[] | undefined;
}

function recordingClient(): AnalyticsEvidenceQueryClient & { queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return { rows: [], rowCount: 2 };
    },
  };
}

const databaseUrl = "postgresql://sandbox:sandbox@127.0.0.1:55433/analytics_sandbox";
const valid = {
  mode: "import",
  apply: true,
  noUpload: true,
  orgId: "true-nature",
  schema: "label_suite",
  databaseUrl,
  env: {
    ANALYTICS_SANDBOX: "1",
    ANALYTICS_SANDBOX_DISPOSABLE: "1",
    ANALYTICS_SANDBOX_ORG_ID: "true-nature",
    ANALYTICS_SANDBOX_DB_URL: databaseUrl,
  },
};

describe("assertAnalyticsSandboxReplacementTarget", () => {
  it("accepts only the exact disposable local sandbox import target", () => {
    expect(assertAnalyticsSandboxReplacementTarget(valid)).toEqual({ orgId: "true-nature" });
  });

  it.each([
    ["dry run", { apply: false }],
    ["sync mode", { mode: "sync" }],
    ["uploads enabled", { noUpload: false }],
    ["different organization", { orgId: "other-org" }],
    ["different database URL", { databaseUrl: `${databaseUrl}x` }],
    ["different schema", { schema: "other_schema" }],
    ["missing disposable marker", { env: { ...valid.env, ANALYTICS_SANDBOX_DISPOSABLE: undefined } }],
  ])("rejects %s before replacement", (_label, override) => {
    expect(() => assertAnalyticsSandboxReplacementTarget({ ...valid, ...override })).toThrow(
      "Refusing analytics sandbox evidence replacement:",
    );
  });
});

describe("replaceAnalyticsSandboxEvidence", () => {
  it("deletes only older Sisense evidence for the explicit organization in FK-safe order", async () => {
    const client = recordingClient();

    const result = await replaceAnalyticsSandboxEvidence(client, {
      orgId: "true-nature",
      currentRunId: "sisense_current",
    });

    expect(result).toEqual({ metricChanges: 2, importFiles: 2, metricRows: 2, importRuns: 2 });
    expect(client.queries).toHaveLength(4);
    expect(client.queries.map(({ text }) => text.match(/delete from label_suite\.([a-z_]+)/)?.[1])).toEqual([
      "analytics_metric_changes",
      "analytics_import_files",
      "analytics_metric_rows",
      "analytics_import_runs",
    ]);
    for (const query of client.queries) {
      expect(query.text).toContain("org_id = $1");
      expect(query.text).toContain("source = $2");
      expect(query.text).toContain("$3");
      expect(query.values).toEqual(["true-nature", "sisense", "sisense_current"]);
      expect(query.text).not.toContain("true-nature");
      expect(query.text).not.toContain("sisense_current");
    }
    expect(client.queries[0].text).toContain("run_id <> $3");
    expect(client.queries[1].text).toContain("run_id <> $3");
    expect(client.queries[2].text).toContain("last_seen_run_id is distinct from $3");
    expect(client.queries[3].text).toContain("id <> $3");
  });
});

describe("Sisense import replacement boundary", () => {
  it("validates replacement before the first database query and publishes it inside the import transaction", () => {
    const importer = readFileSync(new URL("./sisense-ingestion-run.ts", import.meta.url), "utf8");
    const boundary = importer.indexOf("assertAnalyticsSandboxReplacementTarget(");
    const firstQuery = importer.indexOf("successfulRunExists(pool, orgId)");
    const transaction = importer.indexOf('await client.query("begin")');
    const replacement = importer.indexOf("replaceAnalyticsSandboxEvidence(client");

    expect(boundary).toBeGreaterThan(-1);
    expect(boundary).toBeLessThan(firstQuery);
    expect(replacement).toBeGreaterThan(transaction);
  });

  it("fails closed without sandbox markers before attempting a database connection", () => {
    let output = "";
    try {
      execFileSync(process.execPath, ["--import", "tsx", "scripts/sisense-sync.ts", "--mode", "import", "--apply", "--no-upload", "--replace-sandbox-evidence", "--dir", "/tmp/missing"], {
        cwd: new URL("..", import.meta.url),
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          DOTENV_CONFIG_PATH: "/dev/null",
          DATABASE_URL: databaseUrl,
        },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
    }

    expect(output).toContain("Refusing analytics sandbox evidence replacement:");
    expect(output).not.toContain("ECONNREFUSED");
    expect(output).not.toContain("ENOENT");
  });
});
