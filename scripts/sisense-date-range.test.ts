import { describe, expect, it } from "vitest";
import { formatSisenseCustomRangeDate, previousCalendarDayInTimeZone, resolveSisenseTimeZone } from "./sisense-date-range";

describe("Sisense custom date ranges", () => {
  it("uses the previous Copenhagen calendar day across the local date boundary", () => {
    expect(previousCalendarDayInTimeZone(new Date("2026-07-29T21:30:00.000Z"), "Europe/Copenhagen")).toBe("2026-07-28");
    expect(previousCalendarDayInTimeZone(new Date("2026-07-29T22:30:00.000Z"), "Europe/Copenhagen")).toBe("2026-07-29");
  });

  it("uses the configured time zone instead of UTC when deriving Yesterday", () => {
    expect(previousCalendarDayInTimeZone(new Date("2026-07-30T00:30:00.000Z"), "America/Los_Angeles")).toBe("2026-07-28");
  });

  it("keeps the Copenhagen calendar date across the spring-forward transition", () => {
    expect(previousCalendarDayInTimeZone(new Date("2026-03-29T00:59:59.999Z"), "Europe/Copenhagen")).toBe("2026-03-28");
    expect(previousCalendarDayInTimeZone(new Date("2026-03-29T01:00:00.000Z"), "Europe/Copenhagen")).toBe("2026-03-28");
  });

  it("keeps the Copenhagen calendar date across the fall-back transition", () => {
    expect(previousCalendarDayInTimeZone(new Date("2026-10-25T00:59:59.999Z"), "Europe/Copenhagen")).toBe("2026-10-24");
    expect(previousCalendarDayInTimeZone(new Date("2026-10-25T01:00:00.000Z"), "Europe/Copenhagen")).toBe("2026-10-24");
  });

  it("defaults to Europe/Copenhagen and formats the provider custom-range input", () => {
    expect(resolveSisenseTimeZone(undefined)).toBe("Europe/Copenhagen");
    expect(formatSisenseCustomRangeDate("2026-07-29")).toBe("07/29/2026");
  });

  it("rejects invalid configured time zones", () => {
    expect(() => resolveSisenseTimeZone("Not/AZone")).toThrow("SISENSE_TIME_ZONE must be a valid IANA time zone");
  });
});
