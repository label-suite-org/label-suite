import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fanToken, readFanToken, fanSignupSchema, saveDropSchema, requireFanEmail, fanAllowedEmail, requireFanRecipient } from "./fan-drops-core";
import { readFanJson } from "./fan-request";
import { saveFanMessageSchema } from "./fan-messages-core";
vi.mock("../lib/db", () => ({ db: {} }));
beforeEach(() => vi.stubEnv("FAN_TOKEN_SECRET", "fixture-only-key-not-used-in-production-1234"));
afterEach(() => vi.unstubAllEnvs());
describe("fan subscription trust boundaries", () => {
  it("accepts a stable new-message identity without weakening existing revision requirements", () => {
    const input = { creation_id: crypto.randomUUID(), audience: { artist_id: "artist-a" }, content: { subject: "Draft", body: "Message", link_url: null } };
    expect(saveFanMessageSchema.safeParse(input).success).toBe(true);
    expect(saveFanMessageSchema.safeParse({ ...input, creation_id: "invalid" }).success).toBe(false);
    expect(saveFanMessageSchema.safeParse({ ...input, id: "message-a", expected_revision: 1 }).success).toBe(false);
    expect(saveFanMessageSchema.safeParse({ ...input, expected_revision: 1 }).success).toBe(false);
    expect(saveFanMessageSchema.safeParse({ ...input, recipient_ids: ["injected"] }).success).toBe(false);
  });
  it("accepts a new Drop creation identity without allowing it on edits or publication input", () => {
    const input = { creation_id: crypto.randomUUID(), artist_id: "artist-a", release_id: null, slug: "stable-drop",
      content: { title: " Stable draft ", description: "", artwork_url: null, privacy_url: "https://artist.example/privacy", success_url: null } };
    expect(saveDropSchema.parse(input).content.title).toBe("Stable draft");
    expect(saveDropSchema.safeParse({ ...input, creation_id: "invalid" }).success).toBe(false);
    expect(saveDropSchema.safeParse({ ...input, id: "existing", expected_revision: 1 }).success).toBe(false);
    expect(saveDropSchema.safeParse({ ...input, expected_revision: 1 }).success).toBe(false);
    expect(saveDropSchema.safeParse({ ...input, published: input.content }).success).toBe(false);
  });
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

it("fails closed for malformed pilot configuration and limits exact recipients and workspace", () => {
  vi.stubEnv("FAN_ALLOWED_EMAIL", " Owner@Example.test "); vi.stubEnv("FAN_BREVO_ORG_ID", "org-a");
  expect(fanAllowedEmail()).toBe("owner@example.test");
  expect(() => requireFanRecipient("org-a", "owner@example.test")).not.toThrow();
  expect(() => requireFanRecipient("org-a", "owner+other@example.test")).toThrow("only");
  expect(() => requireFanRecipient("org-b", "owner@example.test")).toThrow("only");
  vi.stubEnv("FAN_ALLOWED_EMAIL", undefined);
  expect(() => requireFanRecipient("org-a", "owner@example.test")).toThrow("not configured");
  vi.stubEnv("FAN_EMAIL_ENABLED", "true");
  expect(() => requireFanEmail()).toThrow("not configured");
  vi.stubEnv("FAN_ALLOWED_EMAIL", ""); expect(() => fanAllowedEmail()).toThrow("not configured");
});
