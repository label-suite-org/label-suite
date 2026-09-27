import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, sensitiveHeaders, type ClientHttp2Session } from "node:http2";
import { privateNotificationPayload } from "./native-notifications-core";

export const notificationTopic = "online.truenature.labelsuite";
type Environment = "sandbox" | "production";
type Configuration = { environment: Environment; key: KeyObject; keyId: string; teamId: string; fingerprint: string };
export type APNsResult =
  | { status: "accepted" | "expired" | "unavailable" | "rejected" }
  | { status: "invalid_device"; invalidatedAt: number | null }
  | { status: "retry"; retryAfterSeconds: number };

let cachedToken: { fingerprint: string; issuedAt: number; value: string } | undefined;
let connection: { fingerprint: string; client: ClientHttp2Session } | undefined;
let rejectedConfiguration: string | undefined;

function configuration(): Configuration | null {
  const { APNS_ENABLED: enabled, APNS_ENVIRONMENT: environment, APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_PRIVATE_KEY: source } = process.env;
  if (enabled !== "true" || (environment !== "sandbox" && environment !== "production")
    || !keyId || !/^[A-Z0-9]{10}$/.test(keyId) || !teamId || !/^[A-Z0-9]{10}$/.test(teamId) || !source) return null;
  try {
    const key = createPrivateKey(source);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return null;
    return { environment, key, keyId, teamId, fingerprint: createHash("sha256").update(JSON.stringify([environment, keyId, teamId, source])).digest("hex") };
  } catch { return null; } // Invalid private material must never enter a log or API error.
}

/** Configuration evidence only; it does not claim that Apple accepted credentials or delivered an alert. */
export function notificationDeliveryConfigured(): boolean { return configuration() !== null; }

function providerToken(config: Configuration): string {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken?.fingerprint === config.fingerprint && now >= cachedToken.issuedAt && now - cachedToken.issuedAt < 50 * 60) return cachedToken.value;
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: config.keyId })).toString("base64url");
  const claims = Buffer.from(JSON.stringify({ iss: config.teamId, iat: now })).toString("base64url");
  const body = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(body), { key: config.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  cachedToken = { fingerprint: config.fingerprint, issuedAt: now, value: `${body}.${signature}` };
  return cachedToken.value;
}

function providerConnection(config: Configuration): ClientHttp2Session {
  if (connection?.fingerprint === config.fingerprint && !connection.client.closed && !connection.client.destroyed) return connection.client;
  connection?.client.close();
  const client = connect(config.environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com", { minVersion: "TLSv1.2" });
  client.on("error", () => client.destroy()); // Stream callers receive only the sanitized result below.
  client.on("goaway", () => client.close());
  client.unref();
  connection = { fingerprint: config.fingerprint, client };
  return client;
}

/** Transport only. The worker must hold current consent/session/device authority through this bounded request. */
export async function sendNativeNotification(input: {
  notificationId: string; token: string; environment: Environment; expiresAt: Date;
}, signal?: AbortSignal): Promise<APNsResult> {
  const payload = privateNotificationPayload(input.notificationId);
  if (!/^(?:[0-9a-f]{2})+$/.test(input.token) || input.token.length > 1024) throw new Error("Invalid notification device token");
  if (!Number.isFinite(input.expiresAt.getTime())) throw new Error("Invalid notification expiry");
  if (input.expiresAt.getTime() <= Date.now()) return { status: "expired" };
  if (signal?.aborted) return { status: "retry", retryAfterSeconds: 60 };
  const config = configuration();
  if (!config) {
    connection?.client.close(); connection = undefined; cachedToken = undefined;
    return { status: "unavailable" };
  }
  if (config.environment !== input.environment) return { status: "unavailable" };
  if (config.fingerprint === rejectedConfiguration) return { status: "unavailable" };
  try {
    const bearer = providerToken(config);
    const client = providerConnection(config);
    return await new Promise<APNsResult>((resolve) => {
      let settled = false, status = 0, body = "";
      const request = client.request({
        ":method": "POST", ":path": `/3/device/${input.token}`, authorization: `bearer ${bearer}`,
        "apns-topic": notificationTopic, "apns-push-type": "alert", "apns-priority": "5",
        "apns-id": input.notificationId.toLowerCase(), "apns-collapse-id": input.notificationId.toLowerCase(),
        "apns-expiration": String(Math.floor(input.expiresAt.getTime() / 1000)),
        "content-type": "application/json",
        [sensitiveHeaders]: [":path", "authorization", "apns-id", "apns-expiration", "apns-collapse-id"],
      });
      const finish = (result: APNsResult) => {
        if (settled) return;
        settled = true; clearTimeout(timeout); signal?.removeEventListener("abort", abort);
        request.close(); resolve(result);
      };
      const abort = () => finish({ status: "retry", retryAfterSeconds: status >= 500 ? 900 : status === 429 || status === 403 ? 1200 : 60 });
      // Bound authority locks even if the peer accepts a stream but never responds.
      const timeout = setTimeout(() => { abort(); client.destroy(); }, 5_000);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      request.on("error", abort);
      request.on("aborted", abort);
      request.on("close", abort);
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) abort();
      });
      request.on("end", () => {
        if (status === 200) { finish({ status: "accepted" }); return; }
        let reason: unknown, timestamp: unknown;
        try { const decoded = JSON.parse(body); reason = decoded.reason; timestamp = decoded.timestamp; } catch { /* Classify by HTTP status below. */ }
        if ((status === 410 && (reason === "Unregistered" || reason === "ExpiredToken"))
          || (status === 400 && (reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic"))) {
          finish({ status: "invalid_device", invalidatedAt: typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : null });
        } else if (status === 403 && (reason === "ExpiredProviderToken" || reason === "UnrelatedKeyIdInToken")) {
          // A retry must not reuse the rejected JWT or its connection association.
          cachedToken = undefined; client.close();
          finish({ status: "retry", retryAfterSeconds: 1200 });
        } else if (status === 403) {
          // Keep queued alerts pending for a configuration fix; do not burn them
          // as bad requests or repeatedly submit the same rejected credentials.
          rejectedConfiguration = config.fingerprint; client.close();
          finish({ status: "unavailable" });
        } else if (status >= 500) finish({ status: "retry", retryAfterSeconds: 900 });
        else if (status === 429) finish({ status: "retry", retryAfterSeconds: 1200 });
        else finish({ status: "rejected" });
      });
      request.end(JSON.stringify(payload));
    });
  } catch {
    // Connection races and crypto/stream errors can contain request material.
    return { status: "retry", retryAfterSeconds: 60 };
  }
}
