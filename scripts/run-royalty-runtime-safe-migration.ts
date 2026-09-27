import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MigrationCommandRunner = (
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
) => Promise<void>;

export function resolveRoyaltyDatabaseUrls(env: NodeJS.ProcessEnv): {
  runtimeDatabaseUrl: string;
  migrationDatabaseUrl: string;
} {
  const runtimeDatabaseUrl = env.DATABASE_URL?.trim();
  if (!runtimeDatabaseUrl) throw new Error("DATABASE_URL is required for royalty runtime checks.");

  const migrationDatabaseUrl = env.MIGRATION_DATABASE_URL?.trim();
  if (!migrationDatabaseUrl) throw new Error("MIGRATION_DATABASE_URL is required for royalty migrations.");

  return { runtimeDatabaseUrl, migrationDatabaseUrl };
}

function scopedDatabaseEnv(env: NodeJS.ProcessEnv, databaseUrl: string): NodeJS.ProcessEnv {
  const scoped: NodeJS.ProcessEnv = { ...env, DATABASE_URL: databaseUrl };
  delete scoped.MIGRATION_DATABASE_URL;
  return scoped;
}

function runtimeGrantEnv(
  env: NodeJS.ProcessEnv,
  runtimeDatabaseUrl: string,
  migrationDatabaseUrl: string,
): NodeJS.ProcessEnv {
  return {
    ...env,
    DATABASE_URL: runtimeDatabaseUrl,
    MIGRATION_DATABASE_URL: migrationDatabaseUrl,
  };
}

export async function runRoyaltyRuntimeSafeMigration(
  env: NodeJS.ProcessEnv,
  runCommand: MigrationCommandRunner,
): Promise<void> {
  const { runtimeDatabaseUrl, migrationDatabaseUrl } = resolveRoyaltyDatabaseUrls(env);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

  await runCommand(
    npmCommand,
    ["run", "royalty:runtime-db-preflight"],
    scopedDatabaseEnv(env, runtimeDatabaseUrl),
  );
  await runCommand(
    npmCommand,
    ["run", "db:migrate"],
    scopedDatabaseEnv(env, migrationDatabaseUrl),
  );
  await runCommand(
    npmCommand,
    ["run", "royalty:runtime-db-grants"],
    runtimeGrantEnv(env, runtimeDatabaseUrl, migrationDatabaseUrl),
  );
  await runCommand(
    npmCommand,
    ["run", "royalty:runtime-db-postflight"],
    scopedDatabaseEnv(env, runtimeDatabaseUrl),
  );
}

const spawnCommand: MigrationCommandRunner = async (command, args, env) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Royalty migration stage failed (${signal ?? code ?? "unknown"}).`));
    });
  });
};

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isEntrypoint) {
  await runRoyaltyRuntimeSafeMigration(process.env, spawnCommand);
}
