import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSyncServer } from "./server.js";
import { SqliteDeliveryStore } from "./store.js";
import type { PublicHealth, SyncConfig } from "./types.js";

const directories: string[] = [];
const stores: SqliteDeliveryStore[] = [];
const secret = "webhook-test-secret";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let settle: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => { settle = resolve; });
  return { promise, resolve: () => settle() };
}

function config(overrides: Partial<SyncConfig> = {}): SyncConfig {
  return {
    repository: "label-suite-org/label-suite_neon_r2",
    writeMode: "dry-run",
    host: "127.0.0.1",
    port: 0,
    bodyLimitBytes: 1_048_576,
    databasePath: ":memory:",
    reconcileIntervalMs: 60_000,
    envelopeRetentionMs: 86_400_000,
    githubAppId: "1",
    githubInstallationId: "2",
    githubPrivateKeyBase64: "not-used-by-server",
    githubWebhookSecret: secret,
    planeBaseUrl: new URL("https://plane.example.test"),
    planeApiToken: "not-used-by-server",
    planeWorkspace: "workspace",
    planeProjectId: "9c9e4853-9b2b-4021-bbac-76a836d4b9d7",
    revisionFile: "/revision",
    ...overrides,
  };
}

function temporaryStore(): SqliteDeliveryStore {
  const directory = mkdtempSync(join(tmpdir(), "plane-sync-server-"));
  directories.push(directory);
  const store = SqliteDeliveryStore.open(join(directory, "deliveries.sqlite"));
  stores.push(store);
  return store;
}

function health(overrides: Partial<PublicHealth> = {}): PublicHealth {
  return {
    status: "ok",
    revision: "69b2410da4eeba0a340c1ede94da2ff916cf67d0",
    lastAcceptedAt: null,
    lastPlaneMutationAt: null,
    lastReconciliationAt: "2026-08-02T10:00:00.000Z",
    pending: 0,
    permanentlyFailed: 0,
    lastErrorCode: null,
    ...overrides,
  };
}

function webhookBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({
    action: "opened",
    repository: {
      name: "label-suite_neon_r2",
      full_name: "label-suite-org/label-suite_neon_r2",
      owner: { login: "label-suite-org" },
      updated_at: "2026-08-02T10:00:00.000Z",
    },
    issue: { number: 128, updated_at: "2026-08-02T10:00:00.000Z" },
    sender: { login: "nature-boy" },
    ...overrides,
  }));
}

function signature(body: Uint8Array): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function request(server: Server, options: {
  method?: string;
  path?: string;
  body?: Buffer;
  headers?: Record<string, string>;
} = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  await new Promise<void>((resolve) => server.listening ? resolve() : server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  const body = options.body ?? Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const headers = { ...options.headers };
    if (headers["transfer-encoding"] === undefined && headers["content-length"] === undefined) {
      headers["content-length"] = String(body.byteLength);
    }
    const client = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: options.method ?? "GET",
      path: options.path ?? "/",
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    client.once("error", reject);
    client.end(body);
  });
}

async function rawRequest(server: Server, wire: string): Promise<string> {
  await new Promise<void>((resolve) => server.listening ? resolve() : server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: address.port });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.once("error", reject);
    socket.once("close", () => resolve(response));
    socket.once("connect", () => socket.end(wire));
  });
}

function signedHeaders(body: Buffer, deliveryId = "0e4c93e7-a5df-4a94-9c8f-b40826364ca3"): Record<string, string> {
  return {
    "x-github-event": "issues",
    "x-github-delivery": deliveryId,
    "x-hub-signature-256": signature(body),
  };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("createSyncServer", () => {
  it("persists a signed allowlisted webhook before acknowledging it", async () => {
    const store = temporaryStore();
    const body = webhookBody();
    const observations: number[] = [];
    const server = createSyncServer({
      config: config(),
      store,
      health: async () => health(),
      onDeliveryAccepted: () => observations.push(store.healthStats().pending),
    });

    const response = await request(server, { method: "POST", path: "/github", body, headers: signedHeaders(body) });

    expect(response.status).toBe(202);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "accepted" });
    expect(store.healthStats()).toMatchObject({ pending: 1 });
    expect(observations).toEqual([1]);
    await close(server);
  });

  it("acknowledges a duplicate delivery without recording a second inbox row", async () => {
    const store = temporaryStore();
    const body = webhookBody();
    let wakeups = 0;
    const server = createSyncServer({
      config: config(),
      store,
      health: async () => health(),
      onDeliveryAccepted: () => { wakeups += 1; },
    });
    const options = { method: "POST", path: "/github", body, headers: signedHeaders(body) };

    expect((await request(server, options)).status).toBe(202);
    expect((await request(server, options)).status).toBe(202);
    expect(store.healthStats()).toMatchObject({ pending: 1 });
    expect(wakeups).toBe(1);
    await close(server);
  });

  it.each([
    ["GET", "/github"],
    ["POST", "/health"],
    ["GET", "/metrics"],
    ["GET", "/debug"],
  ])("does not expose %s %s", async (method, path) => {
    const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => health() });

    const response = await request(server, { method, path });

    expect(response.status).toBe(404);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "not_found" });
    await close(server);
  });

  it("rejects unsigned and altered byte sequences before parsing JSON", async () => {
    const body = webhookBody();
    const altered = Buffer.from(body);
    altered[0] = altered[0] === 123 ? 91 : 123;
    const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => health() });

    expect((await request(server, { method: "POST", path: "/github", body })).status).toBe(401);
    expect((await request(server, {
      method: "POST",
      path: "/github",
      body: altered,
      headers: signedHeaders(body),
    })).status).toBe(401);
    await close(server);
  });

  it.each([
    [webhookBody({ repository: { name: "other", full_name: "someone/other", owner: { login: "someone" } } })],
    [webhookBody({ action: "transferred" })],
  ])("returns a stable validation result for a disallowed webhook", async (body) => {
    const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => health() });

    const response = await request(server, { method: "POST", path: "/github", body, headers: signedHeaders(body) });

    expect(response.status).toBe(422);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "invalid_webhook" });
    await close(server);
  });

  it("rejects an oversized declared content length before it waits for a body", async () => {
    const server = createSyncServer({ config: config({ bodyLimitBytes: 32 }), store: temporaryStore(), health: async () => health() });
    const body = Buffer.alloc(33, 120);

    const response = await request(server, {
      method: "POST",
      path: "/github",
      body,
      headers: { ...signedHeaders(body), "content-length": "33" },
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "payload_too_large" });
    await close(server);
  });

  it("rejects an overflow discovered while reading a chunked request", async () => {
    const server = createSyncServer({ config: config({ bodyLimitBytes: 32 }), store: temporaryStore(), health: async () => health() });
    const body = Buffer.alloc(33, 120);

    const response = await request(server, {
      method: "POST",
      path: "/github",
      body,
      headers: { ...signedHeaders(body), "transfer-encoding": "chunked" },
    });

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "payload_too_large" });
    await close(server);
  });

  it.each([
    ["negative content length", "POST /github HTTP/1.1\r\nHost: localhost\r\nContent-Length: -1\r\n\r\n"],
    ["non-numeric content length", "POST /github HTTP/1.1\r\nHost: localhost\r\nContent-Length: nope\r\n\r\n"],
    ["duplicate content length", "POST /github HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nx"],
    ["content length plus transfer encoding", "POST /github HTTP/1.1\r\nHost: localhost\r\nContent-Length: 1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n"],
  ])("returns one stable JSON 400 for malformed framing: %s", async (_label, wire) => {
    const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => health() });

    const response = await rawRequest(server, wire);

    expect(response).toMatch(/^HTTP\/1\.1 400 /);
    expect(response).toContain("Content-Type: application/json");
    expect(response.match(/\{\"code\":\"bad_request\"\}/g)).toHaveLength(1);
    expect(response).not.toContain("HPE_");
    await close(server);
  });

  it("returns 503 instead of acknowledging when its durable inbox is unavailable", async () => {
    const store = temporaryStore();
    store.close();
    const body = webhookBody();
    const server = createSyncServer({ config: config(), store, health: async () => health() });

    const response = await request(server, { method: "POST", path: "/github", body, headers: signedHeaders(body) });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "unavailable" });
    await close(server);
  });

  it("returns every approved health field with JSON no-store semantics", async () => {
    const snapshot = health({ status: "degraded", pending: 2, lastErrorCode: "plane_service_unavailable" });
    const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => snapshot });

    const response = await request(server, { method: "GET", path: "/health" });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(JSON.parse(response.body.toString())).toEqual(snapshot);
    await close(server);
  });

  it("never reflects fields outside the approved health response allowlist", async () => {
    const server = createSyncServer({
      config: config(),
      store: temporaryStore(),
      health: async () => ({ ...health(), planeApiToken: "must-not-leak" } as PublicHealth),
    });

    const response = await request(server, { method: "GET", path: "/health" });

    expect(JSON.parse(response.body.toString())).toEqual(health());
    expect(response.body.toString()).not.toContain("must-not-leak");
    await close(server);
  });

  it("keeps ingress-ready degraded and failed Plane snapshots available", async () => {
    for (const snapshot of [
      health({ status: "degraded", lastErrorCode: "plane_service_unavailable" }),
      health({ status: "failed", permanentlyFailed: 1, lastErrorCode: "plane_mapping_ambiguous" }),
    ]) {
      const server = createSyncServer({ config: config(), store: temporaryStore(), health: async () => snapshot });
      expect((await request(server, { method: "GET", path: "/health" })).status).toBe(200);
      await close(server);
    }
  });

  it("returns 503 only when the health/readiness callback cannot read durable ingress state", async () => {
    const server = createSyncServer({
      config: config(),
      store: temporaryStore(),
      health: async () => { throw new Error("delivery store is closed"); },
    });

    const response = await request(server, { method: "GET", path: "/health" });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "unavailable" });
    await close(server);
  });

  it("reports ingress unavailability when a closed store makes the health callback fail", async () => {
    const store = temporaryStore();
    store.close();
    const server = createSyncServer({
      config: config(),
      store,
      health: async () => {
        store.healthStats();
        return health();
      },
    });

    const response = await request(server, { method: "GET", path: "/health" });

    expect(response.status).toBe(503);
    expect(JSON.parse(response.body.toString())).toEqual({ code: "unavailable" });
    await close(server);
  });

  it("does not send an in-flight response after graceful shutdown starts", async () => {
    const healthReady = deferred();
    const entered = deferred();
    const server = createSyncServer({
      config: config(),
      store: temporaryStore(),
      health: async () => {
        entered.resolve();
        await healthReady.promise;
        return health();
      },
    });

    const result = request(server, { method: "GET", path: "/health" }).then(() => "response", () => "closed");
    await entered.promise;
    const closing = close(server);
    healthReady.resolve();

    await expect(result).resolves.toBe("closed");
    await closing;
  });
});
