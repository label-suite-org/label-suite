import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSchemaDriftReport,
  captureSchemaContract,
  compareContracts,
  identifyAppliedMigrations,
  migrationManifest,
  normalizeDefault,
  resolveDriftPolicy,
  validateContractVersion,
  validateDriftPolicy,
  verifyDriftPolicyProvenance,
  type DriftPolicy,
  type DriftPolicyEntry,
  type SchemaContract,
} from "./schema-contract";

const base = (extra: Partial<SchemaContract["tables"][number]> = {}): SchemaContract => ({ version: 1, migrations: ["0000_one"], tables: [{ schema: "public", name: "items", columns: [{ name: "id", dataType: "integer", nullable: false, defaultExpression: null }], primaryKey: ["id"], foreignKeys: [], uniqueConstraints: [], indexes: [], ...extra }] });

const policyEntry = (overrides: Partial<DriftPolicyEntry> = {}): DriftPolicyEntry => ({
  kind: "unexpected_table",
  object: "public.legacy_items",
  disposition: "retain",
  owner: "Data Platform",
  source: "drizzle/0000_jazzy_nitro.sql",
  rationale: "Historical data remains available while its product decision is pending.",
  followUpIssue: "https://github.com/label-suite-org/label-suite_neon_r2/issues/120",
  ...overrides,
});

const policy = (entries: DriftPolicyEntry[]): DriftPolicy => ({ version: 1, entries });

describe("migration manifest", () => {
  it("detects journal gaps, orphans, and duplicate prefixes", () => {
    expect(migrationManifest({ entries: [{ tag: "0000_one" }, { tag: "0002_missing" }] }, ["0000_one.sql", "0001_orphan.sql", "0001_other.sql"])).toEqual({ journalTags: ["0000_one", "0002_missing"], sqlFiles: ["0000_one", "0001_orphan", "0001_other"], duplicatePrefixes: ["0001"], orphanSqlFiles: ["0001_orphan", "0001_other"], missingSqlFiles: ["0002_missing"] });
  });

  it("keeps canonical identities stable when a historical ledger row precedes them", () => {
    expect(identifyAppliedMigrations(
      [
        { id: 31, hash: "historical-hash" },
        { id: 32, hash: "canonical-a-hash" },
        { id: 33, hash: "canonical-b-hash" },
      ],
      [
        { name: "0030_canonical_a", hash: "canonical-a-hash" },
        { name: "0031_canonical_b", hash: "canonical-b-hash" },
      ],
    )).toEqual([
      "ledger-row-31@historical-hash",
      "0030_canonical_a@canonical-a-hash",
      "0031_canonical_b@canonical-b-hash",
    ]);
  });

  it("does not guess a canonical name when a SQL hash is ambiguous", () => {
    expect(identifyAppliedMigrations(
      [{ id: 7, hash: "shared-hash" }],
      [
        { name: "0001_first", hash: "shared-hash" },
        { name: "0002_second", hash: "shared-hash" },
      ],
    )).toEqual(["ledger-row-7@shared-hash"]);
  });

  it("keeps repeated ledger hashes explicit instead of collapsing them", () => {
    expect(identifyAppliedMigrations(
      [
        { id: 7, hash: "canonical-hash" },
        { id: 8, hash: "canonical-hash" },
      ],
      [{ name: "0001_canonical", hash: "canonical-hash" }],
    )).toEqual([
      "ledger-row-7@canonical-hash",
      "ledger-row-8@canonical-hash",
    ]);
  });

  it("is deterministic when canonical migrations are supplied in a different order", () => {
    const ledger = [
      { id: 31, hash: "canonical-a-hash" },
      { id: 32, hash: "historical-hash" },
      { id: 33, hash: "canonical-b-hash" },
    ];
    const canonical = [
      { name: "0030_canonical_a", hash: "canonical-a-hash" },
      { name: "0031_canonical_b", hash: "canonical-b-hash" },
    ];

    expect(identifyAppliedMigrations(ledger, canonical)).toEqual(
      identifyAppliedMigrations(ledger, [...canonical].reverse()),
    );
  });
});

describe("schema contract comparison", () => {
  it("uses a fixed local search path before reading catalog defaults", async () => {
    const queries: string[] = [];
    const client = {
      query: async (query: string) => {
        queries.push(query);
        return { rows: [] };
      },
    };

    await captureSchemaContract(client as never);

    expect(queries[0]).toBe("SET LOCAL search_path TO label_suite, public, pg_catalog");
  });

  it("detects columns, indexes, constraints, and migrations", () => {
    const expected = base({ columns: [{ name: "id", dataType: "integer", nullable: false, defaultExpression: null }, { name: "label", dataType: "text", nullable: false, defaultExpression: "'x'" }], uniqueConstraints: [["label"]], indexes: [{ name: "items_label_idx", unique: false, definition: "CREATE INDEX items_label_idx ON public.items USING btree (label)" }] });
    const actual = base({ columns: [{ name: "id", dataType: "integer", nullable: false, defaultExpression: null }, { name: "extra", dataType: "text", nullable: true, defaultExpression: null }], indexes: [{ name: "unexpected_idx", unique: false, definition: "CREATE INDEX unexpected_idx ON public.items USING btree (extra)" }] });
    const kinds = compareContracts({ ...expected, migrations: ["0000_one", "0001_new"] }, { ...actual, migrations: ["0000_one", "0002_other"] }).map((d) => d.kind);
    expect(kinds).toEqual(expect.arrayContaining(["missing_migration", "unexpected_migration", "missing_column", "unexpected_column", "unique_constraint_mismatch", "index_mismatch"]));
  });
  it("reports an absent canonical migration without shifting a historical ledger row", () => {
    const expected = { ...base(), migrations: ["0001_a@hash-a", "0002_b@hash-b"] };
    const actual = {
      ...base(),
      migrations: identifyAppliedMigrations(
        [
          { id: 1, hash: "historical-hash" },
          { id: 2, hash: "hash-a" },
        ],
        [
          { name: "0001_a", hash: "hash-a" },
          { name: "0002_b", hash: "hash-b" },
        ],
      ),
    };

    expect(compareContracts(expected, actual).filter((drift) => drift.kind.endsWith("migration"))).toEqual([
      { kind: "missing_migration", object: "0002_b@hash-b" },
      { kind: "unexpected_migration", object: "ledger-row-1@historical-hash" },
    ]);
  });
  it("normalizes defaults deterministically", () => expect(normalizeDefault(" (  now ( )  ) ")).toBe("now ( )"));
  it("rejects unsupported contract versions", () => expect(() => validateContractVersion({ version: 2 })).toThrow("Unsupported schema contract version"));
  it("detects primary and foreign key mismatches in deterministic order", () => {
    const expected = base({ primaryKey: ["id"], foreignKeys: [{ columns: ["owner_id"], targetSchema: "public", targetTable: "owners", targetColumns: ["id"] }] });
    const actual = base({ primaryKey: [], foreignKeys: [] });
    expect(compareContracts(expected, actual).map((d) => d.kind)).toEqual(["primary_key_mismatch", "foreign_key_mismatch"]);
  });
});

describe("schema drift policy", () => {
  it("validates canonical migration and checkout-reachable Git policy sources without database configuration", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-policy-"));
    const policyPath = resolve(directory, "policy.json");
    try {
      await writeFile(policyPath, JSON.stringify(policy([policyEntry()])));
      const output = execFileSync(
        resolve(process.cwd(), "node_modules/.bin/tsx"),
        ["scripts/schema-contract.ts", "policy-check", "--policy", policyPath],
        { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
      );

      expect(output).toBe("");

      const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
      await writeFile(policyPath, JSON.stringify(policy([policyEntry({ source: `https://github.com/label-suite-org/label-suite/commit/${commit}` })])));
      expect(execFileSync(
        resolve(process.cwd(), "node_modules/.bin/tsx"),
        ["scripts/schema-contract.ts", "policy-check", "--policy", policyPath],
        { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
      )).toBe("");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects local and Git provenance that cannot be verified from this checkout", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-policy-"));
    const policyPath = resolve(directory, "policy.json");
    const runPolicyCheck = () => execFileSync(
      resolve(process.cwd(), "node_modules/.bin/tsx"),
      ["scripts/schema-contract.ts", "policy-check", "--policy", policyPath],
      { cwd: process.cwd(), encoding: "utf8", env: { PATH: process.env.PATH ?? "" }, stdio: "pipe" },
    );
    try {
      await writeFile(policyPath, JSON.stringify(policy([policyEntry({ source: "drizzle/9999_missing.sql" })])));
      expect(runPolicyCheck).toThrow();

      await writeFile(policyPath, JSON.stringify(policy([policyEntry({ source: "https://github.com/label-suite-org/label-suite_neon_r2/commit/deadbeef" })])));
      expect(runPolicyCheck).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts a staged new migration as local provenance", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-provenance-"));
    const repository = resolve(directory, "repository");
    const migration = "drizzle/9999_staged.sql";
    const runGit = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
    try {
      await mkdir(resolve(repository, "drizzle"), { recursive: true });
      runGit("init");
      await writeFile(resolve(repository, migration), "SELECT 1;\n");
      runGit("add", migration);

      expect(() => verifyDriftPolicyProvenance(policy([policyEntry({ source: migration })]), repository)).not.toThrow();
      await writeFile(resolve(repository, migration), "SELECT 2;\n");
      expect(() => verifyDriftPolicyProvenance(policy([policyEntry({ source: migration })]), repository))
        .toThrow("Unverifiable drift policy provenance");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects an untracked migration path as local provenance", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-provenance-"));
    const repository = resolve(directory, "repository");
    const migration = "drizzle/9999_untracked.sql";
    const runGit = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
    try {
      await mkdir(resolve(repository, "drizzle"), { recursive: true });
      runGit("init");
      await writeFile(resolve(repository, migration), "SELECT 1;\n");

      expect(() => verifyDriftPolicyProvenance(policy([policyEntry({ source: migration })]), repository))
        .toThrow("Unverifiable drift policy provenance");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts Git provenance reachable from a local non-HEAD ref", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-provenance-"));
    const repository = resolve(directory, "repository");
    const runGit = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
    try {
      await mkdir(repository);
      runGit("init");
      runGit("config", "user.name", "Schema Contract Test");
      runGit("config", "user.email", "schema-contract@example.test");
      runGit("remote", "add", "origin", "https://git.truenature.online/malthe/label-suite_neon_r2.git");
      await writeFile(resolve(repository, "README.md"), "fixture\n");
      runGit("add", "README.md");
      runGit("commit", "-m", "fixture");
      const nonHeadCommit = runGit("commit-tree", "HEAD^{tree}", "-m", "migration evidence");
      runGit("update-ref", "refs/heads/migration-evidence", nonHeadCommit);

      const historicalSource = `https://git.truenature.online/malthe/label-suite_neon_r2/commit/${nonHeadCommit}`;
      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: historicalSource })]),
        repository,
      )).not.toThrow();

      runGit("remote", "set-url", "origin", "https://github.com/label-suite-org/label-suite_neon_r2.git");
      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: historicalSource })]),
        repository,
      )).not.toThrow();

      runGit("remote", "set-url", "origin", "git@github.com:malthelm/label-suite_neon_r2.git");
      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: historicalSource })]),
        repository,
      )).not.toThrow();
      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: `https://git.truenature.online/wrong-origin/other-repository/commit/${nonHeadCommit}` })]),
        repository,
      )).toThrow("Unverifiable drift policy provenance");
      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: `https://github.com/wrong-origin/label-suite_neon_r2/commit/${nonHeadCommit}` })]),
        repository,
      )).toThrow("Unverifiable drift policy provenance");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a Git commit object that is not reachable from a local ref", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "label-suite-schema-provenance-"));
    const repository = resolve(directory, "repository");
    const runGit = (...args: string[]) => execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
    try {
      await mkdir(repository);
      runGit("init");
      runGit("config", "user.name", "Schema Contract Test");
      runGit("config", "user.email", "schema-contract@example.test");
      runGit("remote", "add", "origin", "https://github.com/label-suite-org/label-suite_neon_r2.git");
      await writeFile(resolve(repository, "README.md"), "fixture\n");
      runGit("add", "README.md");
      runGit("commit", "-m", "fixture");
      const danglingCommit = runGit("commit-tree", "HEAD^{tree}", "-m", "dangling evidence");

      expect(() => verifyDriftPolicyProvenance(
        policy([policyEntry({ source: `https://github.com/label-suite-org/label-suite_neon_r2/commit/${danglingCommit}` })]),
        repository,
      )).toThrow("Unverifiable drift policy provenance");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("matches drift by the exact kind and object identity", () => {
    const result = resolveDriftPolicy(policy([policyEntry()]), [
      { kind: "unexpected_table", object: "public.legacy_items" },
      { kind: "missing_table", object: "public.legacy_items" },
    ]);

    expect(result.acceptedCurrentDrift).toEqual([policyEntry()]);
    expect(result.unresolvedDrift).toEqual([{ kind: "missing_table", object: "public.legacy_items" }]);
    expect(result.stalePolicy).toEqual([]);
  });

  it("fails closed when a current difference has no policy entry", () => {
    const result = resolveDriftPolicy(policy([]), [{ kind: "unexpected_column", object: "public.items.legacy_id" }]);

    expect(result.unresolvedDrift).toEqual([{ kind: "unexpected_column", object: "public.items.legacy_id" }]);
    expect(result.isConsistent).toBe(false);
  });

  it("rejects duplicate identities and malformed policy metadata", () => {
    expect(() => validateDriftPolicy(policy([policyEntry(), policyEntry()]))).toThrow("Duplicate drift policy entry");
    expect(() => validateDriftPolicy(policy([policyEntry({ owner: "" })]))).toThrow("Invalid drift policy entry");
    expect(() => validateDriftPolicy(policy([policyEntry({ source: "unverifiable-source" })]))).toThrow("Invalid drift policy entry");
    expect(() => validateDriftPolicy(policy([policyEntry({ followUpIssue: "https://example.com/issues/120" })]))).toThrow("Invalid drift policy entry");
    expect(() => validateDriftPolicy({ version: 2, entries: [] })).toThrow("Unsupported drift policy version");
    expect(() => validateDriftPolicy({ version: 1, entries: [], ignored: true })).toThrow("Invalid drift policy");
    expect(() => validateDriftPolicy(policy([policyEntry({ kind: "other" as DriftPolicyEntry["kind"] })]))).toThrow("Invalid drift policy entry");
    expect(() => validateDriftPolicy(policy([policyEntry({ disposition: "ignore" as DriftPolicyEntry["disposition"] })]))).toThrow("Invalid drift policy entry");
  });

  it("records an absent adoption entry as resolved evidence", () => {
    const adopted = policyEntry({ disposition: "adopt" });
    const result = resolveDriftPolicy(policy([adopted]), []);

    expect(result.resolvedAdoptions).toEqual([adopted]);
    expect(result.isConsistent).toBe(true);
  });

  it("fails when an adopted difference is still present", () => {
    const adopted = policyEntry({ disposition: "adopt" });
    const result = resolveDriftPolicy(policy([adopted]), [{ kind: "unexpected_table", object: "public.legacy_items" }]);

    expect(result.stalePolicy).toEqual([adopted]);
    expect(result.isConsistent).toBe(false);
  });

  it("never accepts a present adoption when building a report directly from drift", () => {
    const adopted = policyEntry({ disposition: "adopt" });
    const report = buildSchemaDriftReport(
      policy([adopted]),
      [{ kind: "unexpected_table", object: "public.legacy_items" }],
      "50a6b8c",
    );

    expect(report.acceptedCurrentDrift).toEqual([]);
    expect(report.stalePolicy).toEqual([
      { kind: "unexpected_table", object: "public.legacy_items", disposition: "adopt" },
    ]);
  });

  it("fails when retain and remove-later entries are no longer current", () => {
    const retained = policyEntry({ object: "public.retained" });
    const removal = policyEntry({ object: "public.remove_later", disposition: "remove_later" });
    const result = resolveDriftPolicy(policy([removal, retained]), []);

    expect(result.stalePolicy).toEqual([removal, retained]);
    expect(result.isConsistent).toBe(false);
  });

  it("orders policy outcomes and sanitized reports deterministically", () => {
    const entries = [
      policyEntry({ kind: "unexpected_column", object: "public.items.z", disposition: "remove_later" }),
      policyEntry({ kind: "missing_table", object: "public.a", disposition: "adopt" }),
      policyEntry({ object: "public.b" }),
    ];
    const rawDrift = [
      { kind: "unexpected_table" as const, object: "public.b" },
      { kind: "unexpected_column" as const, object: "public.items.z" },
      { kind: "missing_column" as const, object: "public.items.unclassified" },
    ];

    const first = resolveDriftPolicy(policy(entries), rawDrift);
    const second = resolveDriftPolicy(policy([...entries].reverse()), [...rawDrift].reverse());
    expect(second).toEqual(first);

    const report = buildSchemaDriftReport(policy(entries), rawDrift, "50a6b8c");
    expect(report).toEqual(buildSchemaDriftReport(policy([...entries].reverse()), [...rawDrift].reverse(), "50a6b8c"));
    expect(JSON.stringify(report)).not.toMatch(/postgres(?:ql)?:\/\/|DATABASE_URL|CREATE TABLE|databaseUrl/i);
    expect(report).toMatchObject({
      contractVersion: 1,
      revision: "50a6b8c",
      summary: { resolvedAdoptions: 1, acceptedCurrentDrift: 2, unresolvedDrift: 1, stalePolicy: 0 },
    });
  });

  it("excludes free-form policy metadata and rejects non-identifier drift text from report JSON", () => {
    const report = buildSchemaDriftReport(policy([policyEntry({
      owner: "tenant_9f75dc40",
      rationale: "SELECT * FROM customers WHERE api_token = 'cookie=secret'; record: { id: 42 }",
    })]), [{ kind: "unexpected_table", object: "public.legacy_items" }], "50a6b8c");
    const json = JSON.stringify(report);

    expect(report.acceptedCurrentDrift).toEqual([
      { kind: "unexpected_table", object: "public.legacy_items", disposition: "retain" },
    ]);
    expect(json).not.toMatch(/tenant_9f75dc40|api_token|cookie=secret|SELECT \*|record:|owner|rationale|source|followUpIssue/i);
    expect(() => buildSchemaDriftReport(
      policy([]),
      [{ kind: "unexpected_table", object: "public.items error: password=secret row={id:42}" }],
      "50a6b8c",
    )).toThrow("Invalid raw schema drift");
  });
});
