import { z } from "zod";

export type CalendarEvent = {
  id: string; etag: string; status?: string; summary?: string; description?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  recurrence?: string[]; recurringEventId?: string;
  extendedProperties?: { private?: Record<string, string> };
};
export const validCalendarDate = (value: unknown): value is string => z.iso.date().safeParse(value).success;
export function nextDate(date: string) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}
export function eventDate(event: CalendarEvent) {
  const date = event.start?.date;
  return validCalendarDate(date) && !event.start?.dateTime && !event.end?.dateTime
    && event.end?.date === nextDate(date) && !event.recurrence?.length && !event.recurringEventId ? date : null;
}
export function reconcileDate(base: string, local: string, remote: string) {
  if (local === remote) return "same";
  if (local === base) return "pull";
  if (remote === base) return "push";
  return "conflict";
}
