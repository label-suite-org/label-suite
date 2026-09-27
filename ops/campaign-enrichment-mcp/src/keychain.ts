import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { normalizeBaseUrl, type CredentialStore } from "./client";

export type { CredentialStore } from "./client";

export const KEYCHAIN_SERVICE = "label-suite-campaign-enrichment";
const SECURITY_PATH = "/usr/bin/security";
const MAX_CREDENTIAL_LENGTH = 4_096;
const ITEM_NOT_FOUND_EXIT_CODE = 44;

export type KeychainCredentialErrorCode = "credential_not_found" | "keychain_unavailable";

const messages: Record<KeychainCredentialErrorCode, string> = {
  credential_not_found: "Credential not found in macOS Keychain",
  keychain_unavailable: "macOS Keychain is unavailable",
};

export class KeychainCredentialError extends Error {
  readonly code: KeychainCredentialErrorCode;

  constructor(code: KeychainCredentialErrorCode) {
    super(messages[code]);
    this.name = "KeychainCredentialError";
    this.code = code;
  }
}

export interface InteractiveCredentialStore extends CredentialStore {
  login(baseUrl: string): Promise<void>;
  logout(baseUrl: string): Promise<void>;
}

type SpawnSecurity = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export class MacOsKeychainCredentialStore implements InteractiveCredentialStore {
  private readonly spawn: SpawnSecurity;

  constructor(options: { spawn?: SpawnSecurity } = {}) {
    this.spawn = options.spawn ?? (nodeSpawn as SpawnSecurity);
  }

  async login(baseUrl: string): Promise<void> {
    const account = normalizeBaseUrl(baseUrl);
    const child = this.spawnProcess([
      "add-generic-password",
      "-U",
      "-a",
      account,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], { stdio: ["inherit", "ignore", "inherit"] });
    await waitForSecurity(child, false);
  }

  async read(baseUrl: string): Promise<string> {
    const account = normalizeBaseUrl(baseUrl);
    const child = this.spawnProcess([
      "find-generic-password",
      "-a",
      account,
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let byteLength = 0;
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += buffer.byteLength;
      if (byteLength <= MAX_CREDENTIAL_LENGTH + 16) chunks.push(buffer);
    });
    await waitForSecurity(child, true);

    const credential = byteLength <= MAX_CREDENTIAL_LENGTH + 16
      ? Buffer.concat(chunks).toString("utf8").trim()
      : "";
    if (credential.length === 0 || credential.length > MAX_CREDENTIAL_LENGTH) {
      throw new KeychainCredentialError("credential_not_found");
    }
    return credential;
  }

  async logout(baseUrl: string): Promise<void> {
    const account = normalizeBaseUrl(baseUrl);
    const child = this.spawnProcess([
      "delete-generic-password",
      "-a",
      account,
      "-s",
      KEYCHAIN_SERVICE,
    ], { stdio: ["ignore", "ignore", "ignore"] });
    await waitForSecurity(child, true);
  }

  private spawnProcess(args: readonly string[], options: SpawnOptions): ChildProcess {
    try {
      return this.spawn(SECURITY_PATH, args, options);
    } catch {
      throw new KeychainCredentialError("keychain_unavailable");
    }
  }
}

function waitForSecurity(
  child: ChildProcess,
  itemNotFoundIsAbsent: boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    child.once("error", () => {
      if (settled) return;
      settled = true;
      reject(new KeychainCredentialError("keychain_unavailable"));
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (signal !== null || code === null) {
        reject(new KeychainCredentialError("keychain_unavailable"));
      } else if (code === 0) {
        resolve();
      } else if (code === ITEM_NOT_FOUND_EXIT_CODE && itemNotFoundIsAbsent) {
        reject(new KeychainCredentialError("credential_not_found"));
      } else {
        reject(new KeychainCredentialError("keychain_unavailable"));
      }
    });
  });
}
