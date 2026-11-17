/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
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

it("retains a changed dashboard on save failure and applies it only after a successful retry", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const preferences = defaultDashboardPreferences();
  const saved = { ...preferences, hiddenSectionIds: [...preferences.hiddenSectionIds, "releases"] };
  const fetchMock = vi.fn()
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Try again" }) })
    .mockResolvedValueOnce({ ok: true, json: async () => saved });
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === text)!;
  try {
    await act(async () => root.render(<PersonalDashboard model={model} initialPreferences={preferences} />));
    const edit = button("Edit dashboard");
    edit.focus();
    await act(async () => edit.click());
    const sectionLabel = [...document.querySelectorAll("label")].find(item => item.textContent === "Releases")!;
    const checkbox = sectionLabel.querySelector<HTMLElement>('[role="checkbox"]')!;
    await act(async () => checkbox.click());
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    await act(async () => button("Save dashboard").click());
    expect(document.body.textContent).toContain("Try again");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    expect(host.querySelector('#section-releases')).not.toBeNull();
    await act(async () => button("Save dashboard").click());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/dashboard/preferences", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(saved),
    });
    expect(host.querySelector('#section-releases')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
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
