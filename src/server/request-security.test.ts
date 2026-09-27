import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalAppOrigin, requireSameOrigin } from "./request-security";

describe("request security", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("normalizes the configured site URL to an http(s) origin", () => {
    expect(canonicalAppOrigin("https://labels.example/app/path?ignored=yes")).toBe("https://labels.example");
    expect(canonicalAppOrigin("http://localhost:4321/invite")).toBe("http://localhost:4321");
  });

  it.each(["ftp://labels.example", "https://user:secret@labels.example", "not a url"])(
    "rejects invalid configured site URL %s",
    (siteUrl) => expect(() => canonicalAppOrigin(siteUrl)).toThrow("PUBLIC_SITE_URL"),
  );

  it("compares the request Origin exactly", () => {
    vi.stubEnv("PUBLIC_SITE_URL", "https://labels.example");
    expect(requireSameOrigin(new Request("https://spoofed-host.example/path", {
      method: "POST",
      headers: { origin: "https://labels.example" },
    }))).toBe("https://labels.example");
    expect(() => requireSameOrigin(new Request("https://labels.example/path", {
      method: "POST",
      headers: { origin: "https://labels.example.evil" },
    }))).toThrow("Cross-origin request denied");
  });
});
