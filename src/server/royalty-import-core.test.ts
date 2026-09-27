import { describe, expect, it } from "vitest";
import {
  buildImportId,
  buildSourceRowId,
  endOfMonth,
  reportPeriod,
  sha256,
} from "./royalty-import-core";

describe("royalty import core", () => {
  it("derives stable import and source row identities from source bytes", () => {
    const checksum = sha256("stem-export");

    expect(buildImportId("org-a", "stem", checksum)).toBe(buildImportId("org-a", "stem", checksum));
    expect(buildImportId("org-a", "stem", checksum)).not.toBe(buildImportId("org-b", "stem", checksum));
    expect(buildSourceRowId(checksum, 7)).toBe(`${checksum.slice(0, 24)}:7`);
  });

  it("keeps periods explicit and rejects malformed dates", () => {
    expect(reportPeriod(2026, 2)).toBe("2026-02");
    expect(reportPeriod(2026, 13)).toBeNull();
    expect(reportPeriod(0, 1)).toBeNull();
    expect(endOfMonth("2026-02")).toBe("2026-02-28");
  });
});
