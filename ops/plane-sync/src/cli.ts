import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapPlane } from "./bootstrap.js";
import { loadConfig } from "./config.js";
import { GitHubClient } from "./github.js";
import { PlaneClient } from "./plane.js";
import { reconcile } from "./reconcile.js";
import { indexSeedRegistry, loadSeedRegistry } from "./registry.js";
import { SqliteDeliveryStore, type FailedDeliveryRecoveryRequest } from "./store.js";
import type { SeedRegistry, SyncConfig } from "./types.js";

export interface StandardCliCommand {
  command: "bootstrap" | "reconcile";
  apply: boolean;
}

export interface RecoverFailedCliCommand {
  command: "recover-failed";
  apply: boolean;
  deliveryIds: string[];
  reason: string;
  operator: string;
}

export type CliCommand = StandardCliCommand | RecoverFailedCliCommand;

export interface CliDependencies {
  loadConfig?: () => SyncConfig;
  openStore?: (path: string) => SqliteDeliveryStore;
  createGitHub?: (config: SyncConfig) => GitHubClient;
  createPlane?: (config: SyncConfig) => PlaneClient;
  loadRegistry?: () => SeedRegistry;
  bootstrap?: typeof bootstrapPlane;
  reconcile?: typeof reconcile;
  recoverFailed?: (store: SqliteDeliveryStore, request: FailedDeliveryRecoveryRequest) => ReturnType<SqliteDeliveryStore["recoverFailedDeliveries"]>;
  write?: (line: string) => void;
}

const USAGE = "usage: plane-sync <bootstrap|reconcile> <--dry-run|--apply>";
const RECOVERY_USAGE = "usage: plane-sync recover-failed <--dry-run|--apply> --delivery-id <id> [--delivery-id <id> ...] --reason <reason> --operator <operator>";

export function parseCliArgs(args: readonly string[]): CliCommand | null {
  const [command, mode] = args;
  if (command === "bootstrap" || command === "reconcile") {
    if (args.length !== 2 || (mode !== "--dry-run" && mode !== "--apply")) return null;
    return { command, apply: mode === "--apply" };
  }
  if (command !== "recover-failed" || (mode !== "--dry-run" && mode !== "--apply")) return null;

  const deliveryIds: string[] = [];
  let reason: string | undefined;
  let operator: string | undefined;
  for (let index = 2; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) return null;
    if (option === "--delivery-id") {
      deliveryIds.push(value);
    } else if (option === "--reason" && reason === undefined) {
      reason = value;
    } else if (option === "--operator" && operator === undefined) {
      operator = value;
    } else {
      return null;
    }
  }
  if (deliveryIds.length === 0 || deliveryIds.length > 50 || new Set(deliveryIds).size !== deliveryIds.length) return null;
  if (deliveryIds.some((value) => value.length === 0 || value.length > 255 || value.trim() !== value)) return null;
  if (reason === undefined || reason.trim().length === 0 || reason.trim().length > 256) return null;
  if (operator === undefined || operator.trim().length === 0 || operator.trim().length > 128) return null;
  return { command, apply: mode === "--apply", deliveryIds, reason: reason.trim(), operator: operator.trim() };
}

function defaultRegistry(): SeedRegistry {
  const registryPath = fileURLToPath(new URL("../config/seed-registry.json", import.meta.url));
  return loadSeedRegistry(JSON.parse(readFileSync(registryPath, "utf8")));
}

function defaultGitHub(config: SyncConfig): GitHubClient {
  return new GitHubClient({
    appId: config.githubAppId,
    installationId: config.githubInstallationId,
    privateKeyBase64: config.githubPrivateKeyBase64,
    repository: config.repository,
  });
}

function defaultPlane(config: SyncConfig): PlaneClient {
  return new PlaneClient({
    baseUrl: config.planeBaseUrl,
    apiToken: config.planeApiToken,
    workspace: config.planeWorkspace,
    projectId: config.planeProjectId,
  });
}

/** Runs one explicit, operator-selected maintenance command without process exit. */
export async function runCli(args: readonly string[], supplied: CliDependencies = {}): Promise<number> {
  const write = supplied.write ?? ((line: string) => console.log(line));
  const command = parseCliArgs(args);
  if (command === null) {
    write(args[0] === "recover-failed" ? RECOVERY_USAGE : USAGE);
    return 2;
  }

  let store: SqliteDeliveryStore | null = null;
  try {
    const config = (supplied.loadConfig ?? loadConfig)();
    store = (supplied.openStore ?? SqliteDeliveryStore.open)(config.databasePath);
    if (command.command === "recover-failed") {
      const report = (supplied.recoverFailed ?? ((opened, request) => opened.recoverFailedDeliveries(request)))(store, {
        deliveryIds: command.deliveryIds,
        reason: command.reason,
        operator: command.operator,
        apply: command.apply,
        now: new Date(),
      });
      write(JSON.stringify(report));
      return 0;
    }
    const plane = (supplied.createPlane ?? defaultPlane)(config);
    if (command.command === "bootstrap") {
      const report = await (supplied.bootstrap ?? bootstrapPlane)(
        { store, plane },
        { apply: command.apply },
      );
      write(JSON.stringify(report));
      return 0;
    }

    const github = (supplied.createGitHub ?? defaultGitHub)(config);
    const registry = indexSeedRegistry((supplied.loadRegistry ?? defaultRegistry)());
    const report = await (supplied.reconcile ?? reconcile)(
      { store, github, plane, registry },
      { apply: command.apply, now: new Date() },
    );
    write(JSON.stringify(report));
    return 0;
  } catch {
    write("plane_sync_command_failed");
    return 1;
  } finally {
    store?.close();
  }
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isEntrypoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
