import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Exercise the real Better Auth handlers/configuration without production access.
// The memory adapter proves library/cookie behavior, not PostgreSQL acceptance.
vi.mock("dotenv/config", () => ({}));
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("../server/email", () => ({ queuePasswordResetEmail: vi.fn() }));
vi.mock("better-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth")>();
  const { memoryAdapter } = await import("better-auth/adapters/memory");
  const database = { user: [], session: [], account: [], verification: [], passkey: [] };
  return {
    ...actual,
    betterAuth: (options: Parameters<typeof actual.betterAuth>[0]) => actual.betterAuth({
      ...options,
      database: memoryAdapter(database),
      // SQL-qualified names are PostgreSQL-specific, not part of this test adapter.
      user: { ...options?.user, modelName: "user" },
      account: { ...options?.account, modelName: "account" },
      session: { ...options?.session, modelName: "session" },
      verification: { ...options?.verification, modelName: "verification" },
    }),
  };
});

let auth: typeof import("./auth").auth;
const origin = "https://suite.example.test";
const password = "fixture-password-only-19!";
const email = "session-test@example.test";
let cookie: string;

async function post(path: string, body: object, sessionCookie?: string) {
  return auth.handler(new Request(`${origin}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(sessionCookie ? { Cookie: sessionCookie } : {}) },
    body: JSON.stringify(body),
  }));
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://unused.invalid/unused");
  vi.stubEnv("PUBLIC_SITE_URL", origin);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-only-secret-with-at-least-thirty-two-characters");
  vi.stubEnv("NEXTCLOUD_OIDC_CLIENT_ID", "");
  vi.stubEnv("NEXTCLOUD_OIDC_CLIENT_SECRET", "");
  auth = (await import("./auth")).auth;
  const response = await post("sign-up/email", { email, password, name: "Session fixture" });
  expect(response.status).toBe(200);
});

afterAll(() => { vi.unstubAllEnvs(); });

describe("seven-day Better Auth session contract", () => {
  it("keeps existing password authentication and issues a secure persistent cookie", async () => {
    const response = await post("sign-in/email", { email, password, rememberMe: true });
    expect(response.status).toBe(200);
    const sessionCookie = response.headers.getSetCookie().find(value => value.includes("better-auth.session_token="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toMatch(/Max-Age=604800/i);
    expect(sessionCookie).toMatch(/HttpOnly/i);
    expect(sessionCookie).toMatch(/Secure/i);
    expect(sessionCookie).toMatch(/SameSite=Lax/i);
    cookie = sessionCookie!.split(";")[0];
    const session = await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) });
    expect(session?.user.email).toBe(email);
    const remaining = new Date(session!.session.expiresAt).getTime() - Date.now();
    expect(remaining).toBeGreaterThan(604_790_000);
    expect(remaining).toBeLessThanOrEqual(604_800_000);
    expect(auth.options.session?.disableSessionRefresh).toBe(true);
    expect(auth.options.session?.cookieCache?.enabled).toBe(false);
  });

  it("expires after seven days even when the client retains the cookie", async () => {
    const response = await post("sign-in/email", { email, password, rememberMe: true });
    const staleCookie = response.headers.getSetCookie().find(value => value.includes("better-auth.session_token="))!.split(";")[0];
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
      expect(await auth.api.getSession({ headers: new Headers({ Cookie: staleCookie }) })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts the persistent cookie in a fresh request and rejects it after logout", async () => {
    // Browser restart requires browser acceptance; this verifies HTTP continuity.
    expect(await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) })).not.toBeNull();
    expect((await post("sign-out", {}, cookie)).status).toBe(200);
    expect(await auth.api.getSession({ headers: new Headers({ Cookie: cookie }) })).toBeNull();
    expect((await post("sign-in/email", { email, password, rememberMe: true })).status).toBe(200);
  });
});
