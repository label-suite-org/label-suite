import { dedupeRecordSearchResults } from "@/lib/commands/records";
import type { RecordSearchResult } from "@/lib/commands/records";

export type RecordSearchResultResponse =
  | { status: "success"; records: RecordSearchResult[] }
  | { status: "stale" }
  | { status: "aborted" }
  | { status: "error" };

export async function fetchRecordSearchResults({
  query,
  isLatestRequest,
  signal,
  fetchImpl = globalThis.fetch,
}: {
  query: string;
  isLatestRequest: () => boolean;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<RecordSearchResultResponse> {
  try {
    const response = await fetchImpl(`/api/search/records?q=${encodeURIComponent(query)}`, {
      signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      if (!isLatestRequest() || signal.aborted) return { status: "stale" };
      return { status: "error" };
    }

    const body = (await response.json()) as { records?: RecordSearchResult[] };
    const results = dedupeRecordSearchResults(Array.isArray(body.records) ? body.records : []);

    if (!isLatestRequest() || signal.aborted) {
      return { status: "stale" };
    }

    return { status: "success", records: results };
  } catch (error) {
    if (!isLatestRequest()) return { status: "stale" };
    if (error instanceof DOMException && error.name === "AbortError") return { status: "aborted" };
    return { status: "error" };
  }
}
