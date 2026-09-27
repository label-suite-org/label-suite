import { describe, expect, it } from "vitest";
import { normalizeParityKey } from "./airtable-parity-key";

describe("Airtable parity key normalization", () => {
  it("compares Airtable track formulas with Label Suite's separate version field", () => {
    expect(normalizeParityKey("Release Tracks", "title", "Wild One [Main]")).toBe("wild one");
    expect(normalizeParityKey("Release Tracks", "title", "Cherry-coloured Funk [Cover]")).toBe("cherry-coloured funk");
  });

  it("does not strip bracketed text from unrelated tables or fields", () => {
    expect(normalizeParityKey("Artists", "name", "Artist [Live]")).toBe("artist [live]");
    expect(normalizeParityKey("Release Tracks", "isrc", "CODE [ALT]")).toBe("code [alt]");
  });
});
