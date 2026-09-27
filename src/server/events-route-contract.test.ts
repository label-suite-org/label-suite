import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import * as React from "react";
import { APP_NAV_ITEMS, APP_NAV_MORE_ITEMS } from "../lib/navigation";
import { STATIC_COMMANDS } from "../lib/commands/registry";
import { BottomNav } from "../components/BottomNav";

const mocks = vi.hoisted(() => ({
  listProjectEvents: vi.fn(),
}));

vi.mock("./project-events", () => ({
  listProjectEvents: mocks.listProjectEvents,
}));
vi.mock("./tenant", () => ({
  requireOrgId: (locals: { orgId: string }) => locals.orgId,
  requireMutateRole: (locals: { orgId: string }) => locals.orgId,
}));

describe("events route contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listProjectEvents.mockResolvedValue([{ id: "event-1", title: "Venue night", start_date: "2026-08-01" }]);
  });

  it("projects Events into navigation and command registries", () => {
    const navItem = APP_NAV_ITEMS.find((item) => item.id === "events");
    expect(navItem).toEqual(expect.objectContaining({
      id: "events",
      title: "Events",
      url: "/events",
    }));

    const command = STATIC_COMMANDS.find((command) => command.id === "nav.events");
    expect(command).toMatchObject({ id: "nav.events", group: "navigation", href: "/events", title: "Events" });
  });

  it("keeps Events reachable through mobile More rather than a primary tab", () => {
    const navMarkup = renderToStaticMarkup(React.createElement(BottomNav));
    expect(navMarkup).toContain(">More<");
    expect(navMarkup).not.toContain('href="/events"');
    expect(APP_NAV_MORE_ITEMS.find((item) => item.id === "events")).toMatchObject({ url: "/events" });
  });

  it("requires Events route and API surfaces", async () => {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const eventsPagePath = resolve(baseDir, "../pages/events/index.astro");
    const eventsApiPath = resolve(baseDir, "../pages/api/events/index.ts");
    const eventsItemApiPath = resolve(baseDir, "../pages/api/events/[id].ts");
    const projectsApiPath = resolve(baseDir, "../pages/api/projects/index.ts");
    const projectItemApiPath = resolve(baseDir, "../pages/api/projects/[id].ts");

    expect(existsSync(eventsPagePath)).toBe(true);
    expect(existsSync(eventsApiPath)).toBe(true);
    expect(existsSync(eventsItemApiPath)).toBe(true);
    expect(existsSync(projectsApiPath)).toBe(true);
    expect(existsSync(projectItemApiPath)).toBe(true);
    expect(readFileSync(eventsPagePath, "utf8")).toContain("AppLayout");
    expect(readFileSync(eventsApiPath, "utf8")).toContain("export const GET");
    expect(readFileSync(eventsApiPath, "utf8")).toContain("export const POST");
    expect(readFileSync(eventsItemApiPath, "utf8")).toContain("export const GET");
    expect(readFileSync(eventsItemApiPath, "utf8")).toContain("export const PATCH");
    expect(readFileSync(projectsApiPath, "utf8")).toContain("export const GET");
    expect(readFileSync(projectsApiPath, "utf8")).toContain("export const POST");
    expect(readFileSync(projectItemApiPath, "utf8")).toContain("export const GET");
    expect(readFileSync(projectItemApiPath, "utf8")).toContain("export const PUT");
  });

  it("guards restored events and budget surface contracts", () => {
    const baseDir = dirname(fileURLToPath(import.meta.url));
    const eventsSchema = readFileSync(resolve(baseDir, "../db/schema/events.ts"), "utf8");
    const financeSchema = readFileSync(resolve(baseDir, "../db/schema/finance.ts"), "utf8");

    expect(eventsSchema).toContain("project_id: text(\"project_id\").references(() => budget_projects.id");
    expect(eventsSchema).toContain("artist_id: text(\"artist_id\").references(() => artists.id");
    expect(eventsSchema).toContain("release_id: text(\"release_id\").references(() => releases.id");
    expect(eventsSchema).toContain("contact_id: text(\"contact_id\").references(() => contacts.id");
    expect(eventsSchema).toContain("owner_contact_id: text(\"owner_contact_id\").references(() => contacts.id");

    expect(financeSchema).toContain("project_type: text(\"project_type\")");
    expect(financeSchema).toContain("owner_contact_id: text(\"owner_contact_id\")");
    expect(financeSchema).toContain("location_name: text(\"location_name\")");
    expect(financeSchema).toContain("country_code: text(\"country_code\")");
    expect(financeSchema).toContain("timezone: text(\"timezone\")");
    expect(financeSchema).toContain("health: text(\"health\")");
  });

  it("keeps events list query filters and stand-alone semantics on the API", async () => {
    const { GET } = await import("../pages/api/events/index");

    const allRequest = new Request("https://labels.example/api/events");
    const allResponse = await GET({
      request: allRequest,
      url: new URL(allRequest.url),
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);
    const payload = await allResponse.json();

    expect(allResponse.status).toBe(200);
    expect(payload).toEqual({ events: [{ id: "event-1", title: "Venue night", start_date: "2026-08-01" }] });
    expect(mocks.listProjectEvents).toHaveBeenCalledWith("org-1", {
      project_id: undefined,
      event_type: undefined,
      status: undefined,
      start_date: undefined,
      end_date: undefined,
    });

    const standaloneRequest = new Request("https://labels.example/api/events?project_id=standalone&event_type=concert&status=planned&start_date=2026-08-01&end_date=2026-09-01");
    const standaloneResponse = await GET({
      request: standaloneRequest,
      url: new URL(standaloneRequest.url),
      locals: { orgId: "org-1", membershipRole: "operator" },
    } as never);

    expect(standaloneResponse.status).toBe(200);
    expect(mocks.listProjectEvents).toHaveBeenCalledWith("org-1", {
      project_id: null,
      event_type: "concert",
      status: "planned",
      start_date: "2026-08-01",
      end_date: "2026-09-01",
    });
  });
});
