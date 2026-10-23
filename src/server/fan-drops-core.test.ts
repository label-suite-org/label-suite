import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fanToken, readFanToken, fanSignupSchema, saveDropSchema, requireFanEmail } from "./fan-drops-core";
import { readFanJson } from "./fan-request";
beforeEach(() => vi.stubEnv("FAN_TOKEN_SECRET", "fixture-only-key-not-used-in-production-1234"));
afterEach(() => vi.unstubAllEnvs());
describe("fan subscription trust boundaries", () => {
  it("binds signed links to purpose, scope and expiry", () => {
    const token = fanToken("confirm", "org-a", "signup-a", 2000);
    expect(readFanToken(token, "confirm", 1000)).toMatchObject({ orgId: "org-a", id: "signup-a" });
    expect(() => readFanToken(token, "unsubscribe", 1000)).toThrow();
    expect(() => readFanToken(token, "confirm", 2000)).toThrow();
    const [payload, signature] = token.split(".");
    const changed = Buffer.from(Buffer.from(payload, "base64url").toString().replace("org-a", "org-b")).toString("base64url");
    expect(() => readFanToken(`${changed}.${signature}`, "confirm", 1000)).toThrow();
  });
  it("requires explicit consent and normalizes email without stripping plus aliases", () => {
    const signup = { email: " Fan+show@Example.com ", consent: true, published_revision: 1 };
    expect(fanSignupSchema.parse(signup).email).toBe("fan+show@example.com");
    expect(fanSignupSchema.safeParse({ ...signup, consent: false }).success).toBe(false);
    expect(fanSignupSchema.safeParse({ ...signup, provider_suppressed: false }).success).toBe(false);
  });
  it("rejects executable/public credential URLs and stale-edit shapes", () => {
    const draft = { artist_id: "artist-a", release_id: null, slug: "tour-news", content: { title: "Tour news", description: "Updates", privacy_url: "https://artist.example/privacy", artwork_url: null, success_url: null } };
    expect(saveDropSchema.safeParse(draft).success).toBe(true);
    expect(saveDropSchema.safeParse({ ...draft, id: "existing" }).success).toBe(false);
    for (const url of ["javascript:alert(1)", "https://user:password@example.com/"]) {
      expect(saveDropSchema.safeParse({ ...draft, content: { ...draft.content, success_url: url } }).success).toBe(false);
    }
  });
  it("does not enable fan email just because transactional Brevo is configured", () => {
    vi.stubEnv("BREVO_API_KEY", "fixture"); vi.stubEnv("BREVO_SENDER_EMAIL", "sender@example.com"); vi.stubEnv("FAN_EMAIL_ENABLED", "false");
    expect(() => requireFanEmail()).toThrow("not available");
  });
  it("bounds chunked public input even without a Content-Length header", async () => {
    const request = new Request("https://artist.example/api/fans/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x".repeat(40000) }) });
    await expect(readFanJson(request)).rejects.toMatchObject({ status: 413 });
  });
});
