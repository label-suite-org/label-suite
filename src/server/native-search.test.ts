import { describe, expect, it } from "vitest";
import { projectNativeSearch } from "./native-search";
import { recordSearchTrackHref } from "../lib/commands/records";

describe("native search projection", () => {
  it("groups duplicate canonical names by type and declares supported native destinations", () => {
    expect(projectNativeSearch([
      { id: "artist-a", kind: "artist", title: "Same Name", href: "/artists/artist-a" },
      { id: "release-a", kind: "release", title: "Same Name", href: "/releases/release-a" },
      { id: "work-a", kind: "work", title: "Same Name", href: "/works/work-a" },
    ])).toEqual({
      groups: [
        { kind: "artist", title: "Artists", items: [{ id: "artist-a", kind: "artist", title: "Same Name", subtitle: null, destination: "native", native_route: "/artists/artist-a" }] },
        { kind: "release", title: "Releases", items: [{ id: "release-a", kind: "release", title: "Same Name", subtitle: null, destination: "native", native_route: "/releases/release-a" }] },
        { kind: "work", title: "Works", items: [{ id: "work-a", kind: "work", title: "Same Name", subtitle: null, destination: "native", native_route: "/works/work-a", web_href: "/works/work-a", handoff_message: "Works are available in Label Suite Web." }] },
      ],
      total: 3,
    });
  });

  it("routes people and organizations with identical IDs to distinct native identities", () => {
    const result = projectNativeSearch([
      { id: "same-id", kind: "contact", title: "Same name", href: "/contacts?contact=same-id" },
      { id: "same-id", kind: "organization", title: "Same name", href: "/contacts?organization=same-id" },
    ]);
    expect(result.groups.flatMap(group => group.items).map(({ id, kind, destination }) => ({ id, kind, destination }))).toEqual([
      { id: "same-id", kind: "contact", destination: "native" },
      { id: "same-id", kind: "organization", destination: "native" },
    ]);
  });

  it("returns sparse matching groups without inventing empty or failed categories", () => {
    const result = projectNativeSearch([
      { id: "artist-a", kind: "artist", title: "Aurora", href: "/artists/artist-a" },
      { id: "work-a", kind: "work", title: "Aurora", href: "/works/work-a" },
    ]);
    expect(result.groups.map((group) => group.kind)).toEqual(["artist", "work"]);
    expect(result.total).toBe(2);
    expect(result.groups.flatMap((group) => group.items)).toHaveLength(2);
  });

  it("keeps an empty result set explicit", () => {
    expect(projectNativeSearch([])).toEqual({ groups: [], total: 0 });
  });

  it("preserves Track identity with or without a Release", () => {
    for (const row of [{ id: "track & 1", releaseId: "release", workId: null }, { id: "track", releaseId: null, workId: "work" }, { id: "orphan & 1", releaseId: null, workId: null }]) {
      const href = recordSearchTrackHref(row);
      const item = projectNativeSearch([{ id: row.id, kind: "track", title: "Track", href }]).groups[0].items[0];
      expect(item).toMatchObject({ destination: "native", native_route: row.releaseId ? href : `/tracks/${encodeURIComponent(row.id)}`, web_href: href });
    }
  });

  it("marks newly supported records native while retaining a route for older installed clients", () => {
    for (const kind of ["work", "campaign", "event", "project"] as const) {
      const href = `/${kind}s/record`;
      const item = projectNativeSearch([{ id: "record", kind, title: "Record", href }]).groups[0].items[0];
      expect(item).toMatchObject({ destination: "native", native_route: href, web_href: href });
    }
  });
});
