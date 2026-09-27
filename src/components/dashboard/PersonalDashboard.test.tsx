import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultDashboardPreferences } from "../../lib/dashboard-preferences";
import type { PersonalDashboardModel } from "../../server/dashboard-view-model";
import { PersonalDashboard } from "./PersonalDashboard";

const model: PersonalDashboardModel = {
  setup: null,
  attention: Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, title: `Action ${index + 1}`, detail: "Task context", action: "Specific next step", href: "/today", domain: "Task", urgency: index === 0 ? "critical" : "normal" })),
  indicators: [{ id: "release_readiness", label: "Release readiness", value: "80%", detail: "4/5 ready", href: "/releases" }],
  sections: [{ id: "releases", title: "Releases", summary: "4/5 ready", href: "/releases", rows: [{ id: "r1", title: "Fountain", detail: "Cover art missing", href: "/releases/r1" }] }],
  allIndicators: [{ id: "release_readiness", label: "Release readiness", value: "80%", detail: "4/5 ready", href: "/releases" }],
  allSections: [{ id: "releases", title: "Releases", summary: "4/5 ready", href: "/releases", rows: [{ id: "r1", title: "Fountain", detail: "Cover art missing", href: "/releases/r1" }] }],
};

describe("PersonalDashboard", () => {
  it("makes attention primary and keeps editing explicit", () => {
    const html = renderToStaticMarkup(<PersonalDashboard model={model} initialPreferences={defaultDashboardPreferences()} />);
    expect(html).toContain("Needs attention");
    expect(html).toContain("Edit dashboard");
    expect(html.indexOf("Needs attention")).toBeLessThan(html.indexOf("Pinned"));
    expect(html).toContain("Action 5");
    expect(html).toContain("Next action:");
    expect(html).toContain("Blocker");
    expect(html).not.toContain("Action 6");
  });

  it("renders compact sections with domain navigation", () => {
    const html = renderToStaticMarkup(<PersonalDashboard model={model} initialPreferences={defaultDashboardPreferences()} />);
    expect(html).toContain("Fountain");
    expect(html).toContain("Cover art missing");
    expect(html).toContain('href="/releases"');
  });
});

it("gives a new operator a starting action without empty panels", () => {
  const html = renderToStaticMarkup(<PersonalDashboard model={{ ...model, setup: { hasArtists: false }, attention: [] }} initialPreferences={defaultDashboardPreferences()} canMutate />);
  expect(html).toContain("Add your first artist");
  expect(html).toContain("Create a release");
  expect(html).toContain("Plan the next task");
  expect(html).not.toContain("Needs attention");
  expect(html).not.toContain("No items to show");
  expect(html).not.toContain('id="pinned-title"');
  const readOnly = renderToStaticMarkup(<PersonalDashboard model={{ ...model, setup: { hasArtists: false } }} initialPreferences={defaultDashboardPreferences()} />);
  expect(readOnly).toContain("An owner or operator can add");
  expect(readOnly).not.toContain("Add your first artist");
});
