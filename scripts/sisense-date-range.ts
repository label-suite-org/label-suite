const DEFAULT_SISENSE_TIME_ZONE = "Europe/Copenhagen";

export function resolveSisenseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim() || DEFAULT_SISENSE_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone }).format();
    return timeZone;
  } catch {
    throw new Error(`SISENSE_TIME_ZONE must be a valid IANA time zone; received '${timeZone}'.`);
  }
}

export function previousCalendarDayInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error(`Could not derive a calendar date for time zone '${timeZone}'.`);

  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatSisenseCustomRangeDate(isoDate: string): string {
  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Expected an ISO calendar date, received '${isoDate}'.`);
  return `${match[2]}/${match[3]}/${match[1]}`;
}
