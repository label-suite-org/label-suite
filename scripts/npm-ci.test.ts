import { describe, expect, it } from "vitest";
import { npmResultExitCode } from "./npm-ci.mjs";

describe("npm-ci wrapper", () => {
  it("retains npm status codes and maps signal termination conventionally", () => {
    expect(npmResultExitCode({ status: 0, signal: null })).toBe(0);
    expect(npmResultExitCode({ status: 17, signal: null })).toBe(17);
    expect(npmResultExitCode({ status: null, signal: "SIGTERM" })).toBe(143);
  });
});
