import { describe, expect, it } from "vitest";
import {
  resolveRoyaltyDatabaseUrls,
  runRoyaltyRuntimeSafeMigration,
  type MigrationCommandRunner,
} from "./run-royalty-runtime-safe-migration";

describe("royalty runtime-safe migration orchestration", () => {
  it("requires both runtime and migration connections before executing a command", async () => {
    // Break caught: falling back to DATABASE_URL would run migrations with the
    // restricted runtime role or let an unsafe one-URL deployment proceed.
    expect(() => resolveRoyaltyDatabaseUrls({ DATABASE_URL: "postgres://runtime" })).toThrow(
      "MIGRATION_DATABASE_URL is required",
    );
    expect(() => resolveRoyaltyDatabaseUrls({ MIGRATION_DATABASE_URL: "postgres://owner" })).toThrow(
      "DATABASE_URL is required",
    );
  });

  it("preflights runtime, migrates as owner, then postflights runtime", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      databaseUrl: string | undefined;
      migrationDatabaseUrl: string | undefined;
    }> = [];
    const runner: MigrationCommandRunner = async (command, args, env) => {
      calls.push({
        command,
        args: [...args],
        databaseUrl: env.DATABASE_URL,
        migrationDatabaseUrl: env.MIGRATION_DATABASE_URL,
      });
    };

    await runRoyaltyRuntimeSafeMigration({
      DATABASE_URL: "postgres://runtime",
      MIGRATION_DATABASE_URL: "postgres://owner",
      PATH: process.env.PATH,
    }, runner);

    expect(calls).toEqual([
      { command: "npm", args: ["run", "royalty:runtime-db-preflight"], databaseUrl: "postgres://runtime", migrationDatabaseUrl: undefined },
      { command: "npm", args: ["run", "db:migrate"], databaseUrl: "postgres://owner", migrationDatabaseUrl: undefined },
      { command: "npm", args: ["run", "royalty:runtime-db-grants"], databaseUrl: "postgres://runtime", migrationDatabaseUrl: "postgres://owner" },
      { command: "npm", args: ["run", "royalty:runtime-db-postflight"], databaseUrl: "postgres://runtime", migrationDatabaseUrl: undefined },
    ]);
  });

  it("stops before migration when runtime preflight fails", async () => {
    const calls: string[] = [];
    const runner: MigrationCommandRunner = async (_command, args) => {
      calls.push(args.at(-1) ?? "");
      throw new Error("unsafe runtime role");
    };

    await expect(runRoyaltyRuntimeSafeMigration({
      DATABASE_URL: "postgres://unsafe-runtime",
      MIGRATION_DATABASE_URL: "postgres://owner",
    }, runner)).rejects.toThrow("unsafe runtime role");
    expect(calls).toEqual(["royalty:runtime-db-preflight"]);
  });
});
