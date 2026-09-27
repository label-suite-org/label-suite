import { describe, expect, it } from "vitest";
import { eventDate, nextDate, reconcileDate } from "./calendar-sync-core";

describe("calendar deadline reconciliation", () => {
  it("pulls and pushes single-sided changes, detects conflicts and absorbs its own writes", () => {
    expect(reconcileDate("2026-12-04", "2026-12-04", "2026-12-11")).toBe("pull");
    expect(reconcileDate("2026-12-04", "2026-12-11", "2026-12-04")).toBe("push");
    expect(reconcileDate("2026-12-04", "2026-12-18", "2026-12-11")).toBe("conflict");
    expect(reconcileDate("2026-12-04", "2026-12-11", "2026-12-11")).toBe("same");
  });
  it("uses calendar dates across DST and leap years and holds unsupported event edits", () => {
    expect(nextDate("2028-02-28")).toBe("2028-02-29");
    expect(nextDate("2026-10-25")).toBe("2026-10-26");
    const event = { id: "id", etag: "v1", start: { date: "2026-12-04" }, end: { date: "2026-12-05" } };
    expect(eventDate(event)).toBe("2026-12-04");
    expect(eventDate({ ...event, end: { date: "2026-12-06" } })).toBeNull();
    expect(eventDate({ ...event, recurrence: ["RRULE:FREQ=DAILY"] })).toBeNull();
    expect(eventDate({ ...event, start: { dateTime: "2026-12-04T01:00:00+01:00" } })).toBeNull();
  });
});
