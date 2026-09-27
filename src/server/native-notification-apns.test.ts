import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type Http2Server, type ServerHttp2Session, type ServerHttp2Stream, type IncomingHttpHeaders } from "node:http2";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ endpoint: "", origins: [] as string[] }));
vi.mock("node:http2", async (original) => {
  const actual = await original<typeof import("node:http2")>();
  return { ...actual, connect: (origin: string) => { mock.origins.push(origin); return actual.connect(mock.endpoint); } };
});
import { notificationDeliveryConfigured, sendNativeNotification } from "./native-notification-apns";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const id = "de4f8ddd-b939-4cda-ab0e-a7950da26175", token = "ab".repeat(32);
const input = () => ({ notificationId: id, token, environment: "sandbox" as const, expiresAt: new Date(Date.now() + 60_000) });
let server: Http2Server, sessions: ServerHttp2Session[] = [];
let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let status = 200, response = "", hold = false;
beforeAll(async () => {
  server = createServer();
  server.on("session", session => { sessions.push(session); session.on("error", () => {}); });
  server.on("stream", (stream: ServerHttp2Stream, headers) => {
    let body = ""; stream.setEncoding("utf8"); stream.on("error", () => {});
    stream.on("data", chunk => { body += chunk; });
    stream.on("end", () => {
      received.push({ headers, body });
      if (!hold) { stream.respond({ ":status": status }); stream.end(response); }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local APNs fixture unavailable");
  mock.endpoint = `http://127.0.0.1:${address.port}`;
});
beforeEach(() => {
  status = 200; response = ""; hold = false; received = []; mock.origins = [];
  vi.stubEnv("APNS_ENABLED", "true"); vi.stubEnv("APNS_ENVIRONMENT", "sandbox");
  vi.stubEnv("APNS_KEY_ID", "ABCDEFGHIJ"); vi.stubEnv("APNS_TEAM_ID", "0123456789");
  vi.stubEnv("APNS_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => {
  sessions.forEach(session => session.destroy());
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it("requires explicit activation and valid configured credentials before any connection", async () => {
  vi.stubEnv("APNS_ENABLED", "false");
  expect(notificationDeliveryConfigured()).toBe(false);
  expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
  vi.stubEnv("APNS_ENABLED", "true"); vi.stubEnv("APNS_PRIVATE_KEY", "private-invalid-material");
  expect(notificationDeliveryConfigured()).toBe(false);
  expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
  expect(mock.origins).toEqual([]); expect(received).toEqual([]);
});

it("sends only the generic payload, signs ES256 and reuses authorization and collapse identity on retries", async () => {
  expect(notificationDeliveryConfigured()).toBe(true);
  expect(await sendNativeNotification(input())).toEqual({ status: "accepted" });
  expect(await sendNativeNotification(input())).toEqual({ status: "accepted" });
  expect(mock.origins).toEqual(["https://api.sandbox.push.apple.com"]);
  expect(received).toHaveLength(2);
  const [first, second] = received;
  expect(JSON.parse(first.body)).toEqual({ aps: { alert: { title: "Label Suite", body: "You have a workspace update." } }, notification_id: id });
  expect(first.headers[":path"]).toBe(`/3/device/${token}`);
  expect(first.headers["apns-topic"]).toBe("online.truenature.labelsuite");
  expect(first.headers["apns-push-type"]).toBe("alert"); expect(first.headers["apns-priority"]).toBe("5");
  expect(first.headers["apns-collapse-id"]).toBe(id); expect(second.headers["apns-collapse-id"]).toBe(id);
  expect(first.headers["apns-id"]).toBe(id);
  expect(Number(first.headers["apns-expiration"])).toBeGreaterThan(Date.now() / 1000);
  expect(second.headers.authorization).toBe(first.headers.authorization);
  const [header, claims, signature] = String(first.headers.authorization).slice(7).split(".");
  expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: "ABCDEFGHIJ" });
  expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "0123456789", iat: expect.any(Number) });
  expect(verify("sha256", Buffer.from(`${header}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
});

it("refreshes old authorization and selects only the matching configured Apple environment", async () => {
  await sendNativeNotification(input());
  const original = received[0].headers.authorization, now = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(now + 51 * 60_000);
  await sendNativeNotification(input());
  expect(received[1].headers.authorization).not.toBe(original);
  vi.stubEnv("APNS_ENVIRONMENT", "production");
  expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
  expect(await sendNativeNotification({ ...input(), environment: "production" })).toEqual({ status: "accepted" });
  expect(mock.origins.at(-1)).toBe("https://api.push.apple.com");
});

it("classifies invalid devices separately from retryable provider failure without exposing response details", async () => {
  status = 410; response = JSON.stringify({ reason: "Unregistered", timestamp: 1234 });
  expect(await sendNativeNotification(input())).toEqual({ status: "invalid_device", invalidatedAt: 1234 });
  status = 400; response = JSON.stringify({ reason: "BadDeviceToken", private: token });
  expect(await sendNativeNotification(input())).toEqual({ status: "invalid_device", invalidatedAt: null });
  status = 503; response = "private upstream failure";
  expect(await sendNativeNotification(input())).toEqual({ status: "retry", retryAfterSeconds: 900 });
  response = "x".repeat(5000);
  expect(await sendNativeNotification(input())).toEqual({ status: "retry", retryAfterSeconds: 900 });
  status = 429; response = JSON.stringify({ reason: "TooManyRequests" });
  expect(await sendNativeNotification(input())).toEqual({ status: "retry", retryAfterSeconds: 1200 });
  status = 400; response = JSON.stringify({ reason: "PayloadTooLarge" });
  expect(await sendNativeNotification(input())).toEqual({ status: "rejected" });
  vi.stubEnv("APNS_KEY_ID", "FORBIDDEN1");
  status = 403; response = JSON.stringify({ reason: "Forbidden" });
  expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
});

it("rejects invalid inputs/expired alerts and cancels stalled requests without logging tokens", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await sendNativeNotification({ ...input(), expiresAt: new Date(0) })).toEqual({ status: "expired" });
  await expect(sendNativeNotification({ ...input(), token: "../private-token" })).rejects.toThrow("Invalid notification device token");
  expect(received).toHaveLength(0);
  hold = true;
  const controller = new AbortController();
  const pending = sendNativeNotification(input(), controller.signal);
  await vi.waitFor(() => expect(received).toHaveLength(1));
  controller.abort(new Error("private abort reason"));
  expect(await pending).toEqual({ status: "retry", retryAfterSeconds: 60 });
  expect(log).not.toHaveBeenCalled();
});

it("does not retry permanent credentials, and clears stale JWT/connection state before recoverable authorization retries", async () => {
  status = 403;
  const reasons = ["Forbidden", "InvalidProviderToken", "MissingProviderToken", "BadCertificate", "BadEnvironmentKeyIdInToken", "BadCertificateEnvironment"];
  for (const [index, reason] of reasons.entries()) {
    vi.stubEnv("APNS_KEY_ID", `TESTKEY00${index}`);
    response = JSON.stringify({ reason });
    expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
    const count = received.length;
    expect(await sendNativeNotification(input())).toEqual({ status: "unavailable" });
    expect(received.length).toBe(count);
  }
  vi.stubEnv("APNS_KEY_ID", "ABCDEFGHIJ");
  for (const reason of ["ExpiredProviderToken", "UnrelatedKeyIdInToken"]) {
    status = 403; response = JSON.stringify({ reason });
    expect(await sendNativeNotification(input())).toEqual({ status: "retry", retryAfterSeconds: 1200 });
    const rejectedAuthorization = received.at(-1)!.headers.authorization;
    const previousConnections = mock.origins.length;
    status = 200; response = "";
    expect(await sendNativeNotification(input())).toEqual({ status: "accepted" });
    expect(received.at(-1)!.headers.authorization).not.toBe(rejectedAuthorization);
    expect(mock.origins.length).toBe(previousConnections + 1);
  }
});

it("bounds a silent peer to five seconds so it cannot indefinitely retain delivery authority locks", async () => {
  hold = true;
  const started = performance.now();
  expect(await sendNativeNotification(input())).toEqual({ status: "retry", retryAfterSeconds: 60 });
  expect(performance.now() - started).toBeLessThan(7_000);
  hold = false;
  expect(await sendNativeNotification(input())).toEqual({ status: "accepted" });
}, 8_000);
