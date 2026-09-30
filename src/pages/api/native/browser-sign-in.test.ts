import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), issue: vi.fn(), exchange: vi.fn() }));
vi.mock("../../../lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("../../../server/native-browser-sign-in", () => {
  // Avoid importing a database in route-only tests.
  return { validBrowserNonce: (x: unknown) => typeof x === "string" && /^[A-Za-z0-9_-]{43}$/.test(x), issueBrowserCode: mocks.issue, exchangeBrowserCode: mocks.exchange };
});
import { POST } from "./browser-sign-in";
const nonce = "a".repeat(43);
const call = (body: unknown, origin?: string) => POST({ request: new Request("https://suite.example/api/native/browser-sign-in", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }) } as never);
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("PUBLIC_SITE_URL", "https://suite.example"); });

it("requires same-origin browser authentication before issuing a fixed callback", async () => {
  const body = { action: "authorize", challenge: nonce, state: nonce };
  expect((await call(body, "https://evil.example")).status).toBe(403);
  expect(mocks.session).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue(null);
  expect((await call(body, "https://suite.example")).status).toBe(401);
  expect(mocks.issue).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ session: { id: "browser-session" } });
  mocks.issue.mockResolvedValue(nonce);
  const result = await call({ ...body, redirect_uri: "https://evil.example" }, "https://suite.example");
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  const { callback } = await result.json();
  expect(callback).toBe(`online.truenature.labelsuite://sign-in?code=${nonce}&state=${nonce}`);
  expect(mocks.issue).toHaveBeenCalledWith("browser-session", nonce);
});

it("accepts only bounded exchange proofs and never authenticates through cookies", async () => {
  expect((await call({ action: "exchange", code: "invalid", verifier: nonce })).status).toBe(400);
  expect(mocks.exchange).not.toHaveBeenCalled();
  mocks.exchange.mockResolvedValue({ token: "native-token", user: { id: "user" } });
  expect((await call({ action: "exchange", code: nonce, verifier: nonce })).status).toBe(200);
  expect(mocks.session).not.toHaveBeenCalled();
  expect(mocks.exchange).toHaveBeenCalledWith(nonce, nonce);
});
