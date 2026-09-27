import { describe, expect, it } from "vitest";
import { APP_NAV_ITEMS, APP_NAV_MORE_ITEMS, APP_NAV_PRIMARY_ITEMS, APP_NAV_SECTIONS, isActiveNavRoute, isCurrentNavPage, navItemHref, safeInternalPath } from "./navigation";
import { STATIC_COMMANDS } from "@/lib/commands/registry";
import type { AppNavItem } from "./navigation";
const NAV_ITEMS = APP_NAV_ITEMS as readonly AppNavItem[];

describe("app navigation manifest", () => {
  it("keeps desktop, mobile, and command destinations in one route set", () => {
    const ids = new Set(NAV_ITEMS.map((item) => item.id));
    const sectionIds = new Set(APP_NAV_SECTIONS.map((section) => section.id));
    const expectedMobilePrimaryIds = ["dashboard", "today", "releases", "campaigns", "ops-tasks"];

    expect(APP_NAV_PRIMARY_ITEMS.map((item) => item.id)).toEqual(expectedMobilePrimaryIds);
    expect(APP_NAV_PRIMARY_ITEMS.every((item) => item.mobilePrimary)).toBe(true);
    expect(APP_NAV_MORE_ITEMS.every((item) => !item.mobilePrimary)).toBe(true);
    expect(APP_NAV_PRIMARY_ITEMS.length + APP_NAV_MORE_ITEMS.length).toBe(APP_NAV_ITEMS.length);
    expect(new Set(APP_NAV_ITEMS.map((item) => item.url)).size).toBe(APP_NAV_ITEMS.length);
    expect(NAV_ITEMS.every((item) => sectionIds.has(item.section))).toBe(true);
    expect(NAV_ITEMS.find((item) => item.id === "ops-tasks")?.title).toBe("Tasks");
    expect(NAV_ITEMS.find((item) => item.id === "forecast")?.parentId).toBe("analytics");
    expect(NAV_ITEMS.find((item) => item.id === "forecast")?.url)
      .toBe("/analytics?section=forecast");
    expect(ids.has("works")).toBe(true);
    expect(ids.has("catalog")).toBe(true);
    expect(NAV_ITEMS.find((item) => item.id === "projects")).toMatchObject({
      title: "Projects",
      url: "/projects",
      section: "directory",
    });
    expect(NAV_ITEMS.find((item) => item.id === "integrations")).toMatchObject({
      title: "Integrations",
      url: "/integrations",
      section: "operations",
    });
    expect(NAV_ITEMS.find((item) => item.id === "help")).toMatchObject({
      title: "Help & glossary",
      url: "/help",
      section: "contextual",
    });
  });

  it("validates parent-child integrity and contextual grouping", () => {
    const itemById = new Map(NAV_ITEMS.map((item) => [item.id, item] as const));
    const children = NAV_ITEMS.filter((item) => item.parentId);

    expect(children).toHaveLength(5);
    for (const child of children) {
      expect(itemById.has(child.parentId!)).toBe(true);
    }

    const requiredChildren = [
      "forecast",
      "works",
      "catalog",
      "radio-plugging",
      "radio-stations",
    ];
    const requiredContextualGlobal = ["media-assets", "documents"];
    for (const id of requiredChildren) {
      const item = NAV_ITEMS.find((entry) => entry.id === id);
      expect(item?.parentId).toBeDefined();
      expect(item?.parentId).not.toBe("");
    }
    for (const id of requiredContextualGlobal) {
      const item = NAV_ITEMS.find((entry) => entry.id === id);
      expect(item?.parentId).toBeUndefined();
      expect(item?.section).toBe("contextual");
    }

    const commands = STATIC_COMMANDS.filter((item) => item.group === "navigation");
    expect(commands).toHaveLength(NAV_ITEMS.length);
    for (const item of NAV_ITEMS) {
      const command = commands.find((entry) => entry.id === `nav.${item.id}`);
      expect(command).toBeDefined();
      expect(command?.href).toBe(item.url);
      expect(command?.title).toBe(item.title);
    }
  });

  it("enforces required destinations are still present", () => {
    const ids = new Set<string>(APP_NAV_ITEMS.map((item) => item.id));
    const required: readonly string[] = [
      "forecast",
      "works",
      "catalog",
      "radio-plugging",
      "radio-stations",
      "media-assets",
      "documents",
    ];
    for (const requiredId of required) {
      expect(ids.has(requiredId)).toBe(true);
    }
  });
});

describe("safeInternalPath", () => {
  it.each([
    ["/invite/continue", "/invite/continue"],
    ["//attacker.example", "/dashboard"],
    ["https://attacker.example", "/dashboard"],
    ["invite/continue", "/dashboard"],
    ["/invite/cont\\inue", "/dashboard"],
    ["/invite/continue\tfoo", "/dashboard"],
    ["/invite/continue\rfoo", "/dashboard"],
    ["/invite/continue\nfoo", "/dashboard"],
    ["/invite/%0d%0aLocation:https://attacker.example", "/dashboard"],
    ["/invite/%09continue", "/dashboard"],
    ["/invite/%5c%5cattacker.example", "/dashboard"],
    ["", "/dashboard"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected);
  });
});

describe("query-aware navigation", () => {
  it("activates Forecast without also marking Analytics Overview current", () => {
    const current = "/analytics?section=forecast&artist=artist-a&period=30d";
    expect(isCurrentNavPage(current, "/analytics?section=forecast")).toBe(true);
    expect(isCurrentNavPage(current, "/analytics")).toBe(false);
    expect(isActiveNavRoute(current, "/analytics")).toBe(true);
  });

  it("keeps Analytics current for scoped Overview URLs", () => {
    expect(isCurrentNavPage("/analytics?artist=artist-a&period=30d", "/analytics")).toBe(true);
    expect(isCurrentNavPage("/analytics?section=overview&artist=artist-a&period=30d", "/analytics")).toBe(true);
    expect(isCurrentNavPage("/analytics?section=unknown&artist=artist-a", "/analytics")).toBe(true);
    expect(isCurrentNavPage("/dashboard?tab=activity", "/dashboard")).toBe(false);
  });

  it("preserves analytics scope when linking to Forecast", () => {
    const forecast = NAV_ITEMS.find((item) => item.id === "forecast")!;
    expect(navItemHref(forecast, "/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d")).toBe(
      "/analytics?artist=artist-a&release=release-a&platform=spotify&period=30d&section=forecast",
    );
  });
});
