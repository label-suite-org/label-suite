import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  KEYCHAIN_SERVICE,
  KeychainCredentialError,
  MacOsKeychainCredentialStore,
} from "./keychain";

function securityProcess(options: {
  stdout?: string;
  code?: number;
  error?: Error;
  signal?: NodeJS.Signals;
} = {}) {
  const process = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
  };
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  queueMicrotask(() => {
    if (options.error) {
      process.emit("error", options.error);
      return;
    }
    if (options.stdout !== undefined) process.stdout.end(options.stdout);
    else process.stdout.end();
    process.stderr.end();
    process.emit("close", options.signal === undefined ? (options.code ?? 0) : null, options.signal ?? null);
  });
  return process;
}

describe("MacOsKeychainCredentialStore", () => {
  it("uses an interactive Keychain prompt and never passes the secret in argv", async () => {
    const spawn = vi.fn().mockReturnValue(securityProcess());
    const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

    await store.login("https://suite.example");

    expect(spawn).toHaveBeenCalledWith("/usr/bin/security", [
      "add-generic-password",
      "-U",
      "-a",
      "https://suite.example",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], {
      stdio: ["inherit", "ignore", "inherit"],
    });
    expect(JSON.stringify(spawn.mock.calls)).not.toContain("lsmcp_secret");
  });

  it("reads and trims the credential in process memory without printing it", async () => {
    const spawn = vi.fn().mockReturnValue(securityProcess({ stdout: "  lsmcp_secret  \n" }));
    const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

    await expect(store.read("https://suite.example")).resolves.toBe("lsmcp_secret");
    expect(spawn).toHaveBeenCalledWith("/usr/bin/security", [
      "find-generic-password",
      "-a",
      "https://suite.example",
      "-s",
      KEYCHAIN_SERVICE,
      "-w",
    ], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    expect(JSON.stringify(spawn.mock.calls)).not.toContain("lsmcp_secret");
  });

  it("deletes only the generic password for the exact base URL and service", async () => {
    const spawn = vi.fn().mockReturnValue(securityProcess());
    const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

    await store.logout("https://suite.example");

    expect(spawn).toHaveBeenCalledWith("/usr/bin/security", [
      "delete-generic-password",
      "-a",
      "https://suite.example",
      "-s",
      KEYCHAIN_SERVICE,
    ], {
      stdio: ["ignore", "ignore", "ignore"],
    });
  });

  it("fails closed when Keychain is unavailable and exposes no raw process error", async () => {
    const spawn = vi.fn().mockReturnValue(securityProcess({
      error: new Error("lsmcp_secret executable detail"),
    }));
    const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

    const error = await store.read("https://suite.example").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KeychainCredentialError);
    expect(error).toMatchObject({ code: "keychain_unavailable" });
    expect(String(error)).not.toContain("lsmcp_secret");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it.each(["read", "logout"] as const)(
    "maps only the security item-not-found exit to an absent credential for %s",
    async (operation) => {
      const spawn = vi.fn().mockReturnValue(securityProcess({ code: 44 }));
      const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

      await expect(store[operation]("https://suite.example")).rejects.toMatchObject({
        code: "credential_not_found",
      });
      expect(spawn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["read", 1],
    ["read", 36],
    ["logout", 1],
    ["logout", 36],
  ] as const)("maps %s exit %i to Keychain unavailable", async (operation, code) => {
    const spawn = vi.fn().mockReturnValue(securityProcess({ code }));
    const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

    await expect(store[operation]("https://suite.example")).rejects.toMatchObject({
      code: "keychain_unavailable",
    });
  });

  it.each(["read", "logout"] as const)(
    "maps abnormal %s termination to Keychain unavailable",
    async (operation) => {
      const spawn = vi.fn().mockReturnValue(securityProcess({ signal: "SIGTERM" }));
      const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

      await expect(store[operation]("https://suite.example")).rejects.toMatchObject({
        code: "keychain_unavailable",
      });
    },
  );

  it("rejects an empty or oversized Keychain value without exposing it", async () => {
    for (const stored of [" \n", `lsmcp_${"s".repeat(4_096)}`]) {
      const spawn = vi.fn().mockReturnValue(securityProcess({ stdout: stored }));
      const store = new MacOsKeychainCredentialStore({ spawn: spawn as never });

      const error = await store.read("https://suite.example").catch((caught: unknown) => caught);

      expect(error).toMatchObject({ code: "credential_not_found" });
      expect(String(error)).not.toContain("lsmcp_");
    }
  });
});
