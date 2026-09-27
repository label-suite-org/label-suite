import { describe, expect, it } from "vitest";
import { shouldDropOwnedDisposableRole } from "./royalty-lifecycle-test-role-ownership";

describe("royalty lifecycle disposable role cleanup", () => {
  it("drops only roles created by this harness invocation", () => {
    // Break caught: unconditional DROP OWNED/DROP ROLE removes an existing
    // fixed role and all of its external grants.
    expect(shouldDropOwnedDisposableRole({ createdByHarness: true })).toBe(true);
    expect(shouldDropOwnedDisposableRole({ createdByHarness: false })).toBe(false);
  });
});
