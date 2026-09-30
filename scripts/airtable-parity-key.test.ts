import { describe, expect, it } from "vitest";
import { normalizeParityKey, sourceFieldName, fieldValues } from "./airtable-parity-key";

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

it("uses populated per-record aliases for keys and directory links", () => {
  for (const [fields, aliases, expected] of [
    [{ Name: "", "Artist Name": "Artist" }, ["Name", "Artist Name"], "Artist"],
    [{ "Related Organization": [], "Related Company": ["rec-org"] }, ["Related Organization", "Related Company"], "rec-org"],
    [{ "e-mail": "person@example.test" }, ["Email", "E-Mail"], "person@example.test"],
  ] as const) {
    const name = sourceFieldName(fields, [...aliases]);
    expect(fieldValues(name ? fields[name as keyof typeof fields] : null).join(" ")).toBe(expected);
  }
});
