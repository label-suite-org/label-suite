import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const queries: string[] = [];
  class Pool {
    async query(query: string) {
      queries.push(query);
      if (query.includes("from pg_roles")) {
        return { rows: [{ principal: "runtime_test", superuser: false, bypass_rls: false }] };
      }
      if (query.includes("has_schema_privilege")) {
        return { rows: [{
          schema_usage: true,
          establish_lifecycle_context: true,
          lifecycle_context_table: false,
        }] };
      }
      return { rows: [
        "royalty_imports",
        "royalty_import_currency_totals",
        "royalty_earnings",
        "royalty_split_snapshots",
        "royalty_split_lines",
        "royalty_calculation_runs",
        "royalty_statements",
        "royalty_payouts",
        "royalty_statement_lines",
        "royalty_ledger_transactions",
        "royalty_ledger_entries",
      ].map((table_name) => ({ table_name })) };
    }

    async end() {}
  }
  return { Pool, queries };
});

vi.mock("dotenv/config", () => ({}));
vi.mock("pg", () => ({ Pool: database.Pool }));

const originalArgv = process.argv;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  database.queries.length = 0;
  process.env.DATABASE_URL = "postgresql://runtime-test";
  vi.resetModules();
});

afterEach(() => {
  process.argv = originalArgv;
  if (originalDatabaseUrl == null) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
});

describe("royalty runtime database verifier modes", () => {
  it("preflight checks only principal flags before migrations can run", async () => {
    // Break caught: querying table posture in preflight prevents first install,
    // while running the principal check later permits unsafe migration writes.
    process.argv = ["node", "verify-royalty-runtime-db-role.ts", "--preflight"];
    await import("./verify-royalty-runtime-db-role");

    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]).toContain("from pg_roles");
  });

  it("postflight checks the complete FORCE-RLS table set and restricted runtime access", async () => {
    process.argv = ["node", "verify-royalty-runtime-db-role.ts", "--postflight"];
    await import("./verify-royalty-runtime-db-role");

    expect(database.queries).toHaveLength(2);
    expect(database.queries[0]).toContain("from pg_class");
    expect(database.queries[1]).toContain("has_schema_privilege");
    expect(database.queries[1]).toContain("has_function_privilege");
    expect(database.queries[1]).toContain("has_table_privilege");
  });

  it("rejects an unspecified verifier mode before querying PostgreSQL", async () => {
    process.argv = ["node", "verify-royalty-runtime-db-role.ts"];

    await expect(import("./verify-royalty-runtime-db-role")).rejects.toThrow("--preflight or --postflight");
    expect(database.queries).toEqual([]);
  });
});
