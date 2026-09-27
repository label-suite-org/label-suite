import { describe, expect, it } from "vitest";
import { LEGACY_UNSCOPED_ANALYTICS_ENABLED } from "../lib/analytics-legacy-policy";

describe("analytics tenant safety", () => {
  it("fails closed for legacy relations without org ownership", () => {
    expect(LEGACY_UNSCOPED_ANALYTICS_ENABLED).toBe(false);
  });
});
