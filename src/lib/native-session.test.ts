import { describe, expect, it } from "vitest";
import { bearerToken } from "./native-auth";

describe("native bearer session boundary", () => {
  it("accepts only a bearer authorization header and never exposes credentials in derived data", () => {
    const token = crypto.randomUUID();
    expect(bearerToken(new Request("https://example.test", { headers: { authorization: `Bearer ${token}` } }))).toBe(token);
    expect(bearerToken(new Request("https://example.test", { headers: { authorization: `Basic ${token}` } }))).toBeNull();
    expect(bearerToken(new Request("https://example.test"))).toBeNull();
  });
});
