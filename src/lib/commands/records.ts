import type { CommandDefinition } from "./registry";

export const MAX_RECORD_SEARCH_QUERY_LENGTH = 80;
export const MAX_RECORD_SEARCH_RESULTS = 20;
export const MIN_RECORD_SEARCH_QUERY_LENGTH = 2;

export function normalizeRecordSearchQuery(value: string | null | undefined) {
  return value?.trim().slice(0, MAX_RECORD_SEARCH_QUERY_LENGTH) ?? "";
}

export type RecordSearchKind =
  | "artist"
  | "release"
  | "track"
  | "work"
  | "contact"
  | "organization"
  | "campaign"
  | "project"
  | "event";

export type RecordSearchResult = {
  id: string;
  kind: RecordSearchKind;
  title: string;
  subtitle?: string | null;
  href: string;
};

export function getRecordSearchKey(record: Pick<RecordSearchResult, "kind" | "id">) {
  return `${record.kind}:${record.id}`;
}

export function dedupeRecordSearchResults(records: readonly RecordSearchResult[]) {
  const deduped = new Map<string, RecordSearchResult>();

  for (const record of records) {
    const key = getRecordSearchKey(record);
    if (!deduped.has(key)) deduped.set(key, record);
  }

  return [...deduped.values()];
}

export function getRecordSearchCommandId(record: Pick<RecordSearchResult, "kind" | "id">) {
  return `record.${record.kind}.${record.id}`;
}

export function rankRecordSearchResults(records: readonly RecordSearchResult[], rawQuery: string) {
  const normalizedQuery = normalizeRecordSearchQuery(rawQuery).toLocaleLowerCase();

  return [...records].sort((a, b) => {
    const aExact = a.title.toLocaleLowerCase() === normalizedQuery ? 1 : 0;
    const bExact = b.title.toLocaleLowerCase() === normalizedQuery ? 1 : 0;
    const exactCmp = bExact - aExact;
    if (exactCmp) return exactCmp;

    const titleCmp = a.title.localeCompare(b.title, "en", { sensitivity: "base" });
    if (titleCmp) return titleCmp;

    const kindCmp = a.kind.localeCompare(b.kind);
    if (kindCmp) return kindCmp;

    return a.id.localeCompare(b.id);
  });
}

export function recordSearchTrackHref(row: { id: string; releaseId: string | null; workId: string | null }): string {
  if (row.releaseId) {
    const trackId = encodeURIComponent(row.id);
    return `/releases/${encodeURIComponent(row.releaseId)}/tracks?track=${trackId}#track-${trackId}`;
  }
  if (row.workId) return `/works/${encodeURIComponent(row.workId)}`;
  return "/works";
}

export function recordSearchContactHref(contactId: string): string {
  return `/contacts?contact=${encodeURIComponent(contactId)}`;
}

export function recordSearchOrganizationHref(organizationId: string): string {
  return `/contacts?organization=${encodeURIComponent(organizationId)}`;
}

export function recordSearchProjectHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

export function recordSearchEventHref(eventId: string): string {
  return `/events/${encodeURIComponent(eventId)}`;
}

function titleizeRecordSearchToken(value: string) {
  if (!value) return "";
  return value
    .split("_")
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1))
    .join(" ");
}

export function recordSearchProjectSubtitle(row: {
  projectType: string | null;
  status: string | null;
  startDate: string | null;
}) {
  const parts = [row.projectType, row.status, row.startDate]
    .filter((value): value is string => Boolean(value))
    .map(titleizeRecordSearchToken);

  return parts.join(" - ") || "Project";
}

export function recordSearchEventSubtitle(row: {
  eventType: string | null;
  status: string | null;
  startDate: string | null;
}) {
  const parts = [row.eventType, row.status, row.startDate]
    .filter((value): value is string => Boolean(value))
    .map(titleizeRecordSearchToken);

  return parts.join(" - ") || "Event";
}

export function recordToCommand(record: RecordSearchResult): CommandDefinition {
  return {
    id: getRecordSearchCommandId(record),
    title: record.title,
    subtitle: record.subtitle ?? undefined,
    group: "record",
    href: record.href,
    keywords: [record.kind],
  };
}
