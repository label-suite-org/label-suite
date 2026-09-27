import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { PermanentSyncError } from "./errors.js";
import { compactDelivery } from "./envelope.js";
import { verifyGitHubSignature } from "./signature.js";
import { SqliteDeliveryStore } from "./store.js";
import type { PublicHealth, SyncConfig } from "./types.js";

export interface SyncServerDeps {
  config: Pick<SyncConfig, "bodyLimitBytes" | "githubWebhookSecret">;
  store: SqliteDeliveryStore;
  health: () => Promise<PublicHealth>;
  onDeliveryAccepted?: () => void;
}

interface SyncServerControl {
  stopAccepting(): void;
  forceCloseConnections(): void;
}

const serverControls = new WeakMap<Server, SyncServerControl>();

function json(response: ServerResponse, status: number, codeOrBody: { code: string } | PublicHealth): void {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(codeOrBody);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(body)),
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function publicHealthBody(snapshot: PublicHealth): PublicHealth {
  return {
    status: snapshot.status,
    revision: snapshot.revision,
    lastAcceptedAt: snapshot.lastAcceptedAt,
    lastPlaneMutationAt: snapshot.lastPlaneMutationAt,
    lastReconciliationAt: snapshot.lastReconciliationAt,
    pending: snapshot.pending,
    permanentlyFailed: snapshot.permanentlyFailed,
    lastErrorCode: snapshot.lastErrorCode,
  };
}

function contentLengthExceeds(request: IncomingMessage, limit: number): boolean {
  const header = request.headers["content-length"];
  if (typeof header !== "string" || !/^\d+$/.test(header)) return false;
  try {
    return BigInt(header) > BigInt(limit);
  } catch {
    return false;
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const cleanup = () => {
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onAborted);
    };
    const finish = (value: Buffer | null) => {
      if (done) return;
      done = true;
      cleanup();
      resolve(value);
    };
    const onData = (chunk: Buffer | Uint8Array | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > limit) {
        request.resume();
        finish(null);
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => finish(Buffer.concat(chunks, size));
    const onError = (error: Error) => {
      if (done) return;
      done = true;
      cleanup();
      reject(error);
    };
    const onAborted = () => onError(new Error("request_aborted"));
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onAborted);
  });
}

function closeWithGate(server: Server, stopAccepting: () => void): void {
  const close = server.close.bind(server);
  const gatedClose = ((callback?: (error?: Error) => void) => {
    stopAccepting();
    return close(callback);
  }) as Server["close"];
  server.close = gatedClose;
}

/** Stops admitting requests before the caller begins server close. */
export function stopSyncServerAccepting(server: Server): void {
  serverControls.get(server)?.stopAccepting();
}

/** Force-closes every accepted TCP socket after the graceful deadline. */
export function forceCloseSyncServerConnections(server: Server): void {
  serverControls.get(server)?.forceCloseConnections();
}

export function createSyncServer(deps: SyncServerDeps): Server {
  let accepting = true;
  const activeResponses = new Set<ServerResponse>();
  const sockets = new Set<Socket>();
  const trackSocket = (socket: Socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const stopAccepting = () => {
    if (!accepting) return;
    accepting = false;
    for (const response of activeResponses) response.destroy();
  };
  const server = createServer(async (request, response) => {
    activeResponses.add(response);
    response.once("close", () => activeResponses.delete(response));
    if (!accepting) {
      response.destroy();
      return;
    }
    try {
      if (request.method === "GET" && request.url === "/health") {
        try {
          const snapshot = await deps.health();
          if (!accepting) {
            response.destroy();
            return;
          }
          json(response, 200, publicHealthBody(snapshot));
        } catch {
          if (accepting) json(response, 503, { code: "unavailable" });
        }
        return;
      }

      if (request.method !== "POST" || request.url !== "/github") {
        json(response, 404, { code: "not_found" });
        return;
      }

      if (contentLengthExceeds(request, deps.config.bodyLimitBytes)) {
        request.resume();
        json(response, 413, { code: "payload_too_large" });
        return;
      }

      let rawBody: Buffer | null;
      try {
        rawBody = await readBody(request, deps.config.bodyLimitBytes);
      } catch {
        if (accepting) json(response, 422, { code: "invalid_webhook" });
        return;
      }
      if (rawBody === null) {
        if (accepting) json(response, 413, { code: "payload_too_large" });
        return;
      }
      if (!accepting) {
        response.destroy();
        return;
      }
      const signature = request.headers["x-hub-signature-256"];
      if (!verifyGitHubSignature(
        deps.config.githubWebhookSecret,
        rawBody,
        typeof signature === "string" ? signature : undefined,
      )) {
        json(response, 401, { code: "unauthorized" });
        return;
      }

      try {
        const delivery = compactDelivery(request.headers, rawBody, deps.config.bodyLimitBytes);
        if (delivery !== null) {
          const recorded = deps.store.recordDelivery(delivery);
          if (recorded.inserted) {
            try {
              deps.onDeliveryAccepted?.();
            } catch {
              // The durable inbox remains authoritative even if the wake hint fails.
            }
          }
        }
      } catch (error) {
        if (!accepting) {
          response.destroy();
          return;
        }
        if (error instanceof PermanentSyncError) {
          json(response, 422, { code: "invalid_webhook" });
        } else {
          json(response, 503, { code: "unavailable" });
        }
        return;
      }
      if (accepting) json(response, 202, { code: "accepted" });
    } catch {
      if (accepting) json(response, 503, { code: "unavailable" });
    }
  });
  server.on("connection", trackSocket);
  const rejectedSockets = new WeakSet<Duplex>();
  server.on("clientError", (_error, socket) => {
    if (socket.destroyed || rejectedSockets.has(socket)) return;
    rejectedSockets.add(socket);
    const body = '{"code":"bad_request"}';
    socket.end(
      "HTTP/1.1 400 Bad Request\r\n"
      + "Connection: close\r\n"
      + "Cache-Control: no-store\r\n"
      + "Content-Type: application/json; charset=utf-8\r\n"
      + `Content-Length: ${Buffer.byteLength(body)}\r\n`
      + "X-Content-Type-Options: nosniff\r\n\r\n"
      + body,
    );
  });
  server.once("close", () => {
    server.removeListener("connection", trackSocket);
    sockets.clear();
    serverControls.delete(server);
  });
  serverControls.set(server, {
    stopAccepting,
    forceCloseConnections: () => {
      for (const socket of sockets) socket.destroy();
    },
  });
  closeWithGate(server, stopAccepting);
  return server;
}
