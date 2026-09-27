import { describe, expect, it } from "vitest";
import { searchCommands } from "./search";
import { recordCommandUsage } from "./usage";
import type { CommandDefinition } from "./registry";

const commands = [
  { id: "nav.artists", title: "Artists", group: "navigation", href: "/artists" },
  { id: "nav.analytics", title: "Analytics", group: "navigation", href: "/analytics", keywords: ["stats"] },
  { id: "settings.preferences", title: "Preferences settings", group: "setting", href: "/settings?section=preferences", keywords: ["theme", "keyboard"] },
] as const satisfies readonly CommandDefinition[];

describe("searchCommands", () => {
  it("ranks exact matches above fuzzy matches", () => {
    const results = searchCommands({ commands, query: "artists" });

    expect(results[0]?.id).toBe("nav.artists");
  });

  it("matches aliases and keywords", () => {
    const results = searchCommands({ commands, query: "theme" });

    expect(results[0]?.id).toBe("settings.preferences");
  });

  it("boosts frequently used commands for empty queries", () => {
    const usage = recordCommandUsage(
      recordCommandUsage({}, "nav.analytics", new Date("2026-07-07T10:00:00Z")),
      "nav.analytics",
      new Date("2026-07-07T11:00:00Z"),
    );
    const results = searchCommands({ commands, query: "", usage });

    expect(results[0]?.id).toBe("nav.analytics");
  });

  it("orders equal-score ties deterministically by title and id", () => {
    const tiedCommands = [
      { id: "beta", title: "Same", group: "navigation", href: "/b" },
      { id: "alpha", title: "Same", group: "navigation", href: "/a" },
    ] as const satisfies readonly CommandDefinition[];

    const results = searchCommands({ commands: tiedCommands, query: "S" });

    expect(results.map((result) => result.id)).toEqual(["alpha", "beta"]);
  });
});
