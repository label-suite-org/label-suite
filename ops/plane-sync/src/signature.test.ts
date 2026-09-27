import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyGitHubSignature } from "./signature.js";

describe("verifyGitHubSignature", () => {
  it("accepts the exact sha256 HMAC and rejects a changed byte", () => {
    const body = Buffer.from('{"action":"opened"}');
    const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;

    expect(verifyGitHubSignature("secret", body, signature)).toBe(true);
    expect(verifyGitHubSignature("secret", Buffer.from('{"action":"closed"}'), signature)).toBe(false);
  });

  it.each([
    undefined,
    "",
    "sha1=4c6c9b20f09a23c4c5e6f3ce78032c0b2021177a",
    "sha256=not-a-hex-digest",
    "sha256=6a6f7fca98e4f6b58b4b9479820f8058e0967785343f3c9ce2d2d24453d",
  ])("rejects a missing or malformed signature header: %s", (signature) => {
    expect(verifyGitHubSignature("secret", Buffer.from("{}"), signature)).toBe(false);
  });
});
