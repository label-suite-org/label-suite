import { describe, expect, it } from "vitest";
import {
  deriveWorkspaceIsrcConfig,
  formatIsrc,
  normalizeIsrcCountryCode,
  normalizeIsrcRegistrantCode,
  normalizeIsrcValue,
  planIsrcAssignment,
} from "./isrc";

describe("ISRC helpers", () => {
  it("derives a workspace prefix from configured country and registrant codes", () => {
    expect(
      deriveWorkspaceIsrcConfig("org-1", {
        isrc_country_code: "dk",
        isrc_registrant_code: "o7p",
      }),
    ).toEqual({
      countryCode: "DK",
      registrantCode: "O7P",
      prefix: "DKO7P",
      source: "workspace",
    });
  });

  it("falls back to the legacy True Nature prefix when workspace settings are missing", () => {
    expect(deriveWorkspaceIsrcConfig("true-nature", {})).toEqual({
      countryCode: "DK",
      registrantCode: "O7P",
      prefix: "DKO7P",
      source: "legacy-true-nature",
    });
  });

  it("requires explicit ISRC config for non-legacy workspaces", () => {
    expect(deriveWorkspaceIsrcConfig("org-1", {})).toBeNull();
  });

  it("normalizes and validates country and registrant code fragments", () => {
    expect(normalizeIsrcCountryCode("dk")).toBe("DK");
    expect(normalizeIsrcCountryCode("d")).toBeNull();
    expect(normalizeIsrcRegistrantCode("o7p")).toBe("O7P");
    expect(normalizeIsrcRegistrantCode("07")).toBeNull();
  });

  it("formats an ISRC with year and zero-padded designation", () => {
    expect(formatIsrc("DKO7P", 2026, 42)).toBe("DKO7P2600042");
  });

  it("canonicalizes user-entered ISRC values before comparing them", () => {
    expect(normalizeIsrcValue(" dk-o7p-26-00042 ")).toBe("DKO7P2600042");
    expect(normalizeIsrcValue("   ")).toBeNull();
  });

  it("reuses a linked work ISRC before allocating a new number", () => {
    expect(planIsrcAssignment({ trackIsrc: null, workIsrc: "DKO7P2600042" })).toEqual({
      source: "linked-work",
      isrc: "DKO7P2600042",
    });
    expect(planIsrcAssignment({ trackIsrc: "DKO7P2600043", workIsrc: "DKO7P2600042" })).toEqual({
      source: "existing-track",
      isrc: "DKO7P2600043",
    });
    expect(planIsrcAssignment({ trackIsrc: null, workIsrc: null })).toEqual({
      source: "allocate",
      isrc: null,
    });
  });
});
