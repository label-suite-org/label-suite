import type { RecordSearchKind, RecordSearchResult } from "../lib/commands/records";

export type NativeSearchDestination = "native" | "web";

export type NativeSearchItem = {
  id: string;
  kind: RecordSearchKind;
  title: string;
  subtitle: string | null;
  destination: NativeSearchDestination;
  native_route?: string;
  web_href?: string;
  handoff_message?: string;
};

export type NativeSearchGroup = { kind: RecordSearchKind; title: string; items: NativeSearchItem[] };

const groupTitles: Record<RecordSearchKind, string> = {
  artist: "Artists", release: "Releases", track: "Tracks", work: "Works", contact: "Contacts",
  organization: "Organizations", campaign: "Campaigns", project: "Projects", event: "Events",
};

function webHandoff(kind: RecordSearchKind) {
  return `${groupTitles[kind]} are available in Label Suite Web.`;
}

/** Converts the tenant-scoped canonical search result to a native-safe read projection. */
export function projectNativeSearch(records: readonly RecordSearchResult[]): { groups: NativeSearchGroup[]; total: number } {
  const grouped = new Map<RecordSearchKind, NativeSearchItem[]>();
  for (const record of records) {
    const newlyNative = ["track", "work", "campaign", "event", "project"].includes(record.kind);
    const native = newlyNative || ["artist", "release", "contact", "organization"].includes(record.kind);
    const item: NativeSearchItem = native
      ? { id: record.id, kind: record.kind, title: record.title, subtitle: record.subtitle ?? null, destination: "native", native_route: record.kind === "track" && !record.href.startsWith("/releases/") ? `/tracks/${encodeURIComponent(record.id)}` : record.href,
        // Older installed clients still need their known fallback while the native update rolls out.
        ...(newlyNative ? { web_href: record.href, handoff_message: webHandoff(record.kind) } : {}) }
      : { id: record.id, kind: record.kind, title: record.title, subtitle: record.subtitle ?? null, destination: "web", web_href: record.href, handoff_message: webHandoff(record.kind) };
    grouped.set(record.kind, [...(grouped.get(record.kind) ?? []), item]);
  }
  return {
    groups: [...grouped.entries()].map(([kind, items]) => ({ kind, title: groupTitles[kind], items })),
    total: records.length,
  };
}
