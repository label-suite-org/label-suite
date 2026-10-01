/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CampaignContextRail, CampaignWorkingTasks, CampaignWorkspaceNavigation } from "./CampaignWorkspaceChrome";

describe("CampaignWorkspaceNavigation", () => {
  it("keeps the three daily sections visible and marks a secondary section in More", () => {
    const html = renderToStaticMarkup(<CampaignWorkspaceNavigation
      campaignId="campaign-1"
      campaignName="Hollow River launch"
      status="active"
      activeTab="budget"
      sections={[
        { key: "overview", label: "Overview" },
        { key: "outreach", label: "Outreach" },
        { key: "content", label: "Content" },
        { key: "budget", label: "Budget" },
      ]}
      campaigns={[]}
    />);

    expect(html).toContain("/campaigns/campaign-1?tab=overview");
    expect(html).toContain("/campaigns/campaign-1?tab=outreach");
    expect(html).toContain("/campaigns/campaign-1?tab=content");
    expect(html).toContain('aria-label="More: Budget"');
    expect(html).toContain("border-b-primary text-primary");
    expect(html).not.toContain("border-primary text-primary");
    expect(html).toContain('<h1 class="sr-only">Hollow River launch</h1>');
  });

  it("links a campaign task to the existing task editor", () => {
    const html = renderToStaticMarkup(<CampaignWorkingTasks tasks={[{ id: "task-1", title: "Review radio pitch", nextAction: "Check the draft", dueDate: "2026-09-30" }]} />);
    expect(html).toContain("/ops-tasks?task=task-1");
    expect(html).toContain("Check the draft");
  });

  it("keeps selected campaign metadata readable against its highlight", () => {
    const html = renderToStaticMarkup(<CampaignContextRail campaigns={[
      { id: "selected", name: "Selected", artist: "Selected Artist", purpose: "Album release", cover: null },
      { id: "other", name: "Other", artist: "Other Artist", purpose: "Single release", cover: null },
    ]} selectedId="selected" />);

    expect(html).toContain('class="truncate text-xs text-accent-foreground">Selected Artist');
    expect(html).toContain('class="truncate text-xs text-accent-foreground">Album release');
    expect(html).toContain('class="truncate text-xs text-muted-foreground">Other Artist');
  });
});

it("focuses both columns and restores their independent prior states across Campaigns islands", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sidebar = document.createElement("div"); sidebar.dataset.slot = "sidebar"; sidebar.dataset.state = "expanded"; document.body.append(sidebar);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const changes: boolean[] = [];
  const change = (event: Event) => changes.push((event as CustomEvent<{ open: boolean }>).detail.open);
  window.addEventListener("label-suite:sidebar-state-change", change);
  try {
    await act(async () => root.render(<>
      <CampaignContextRail campaigns={[]} selectedId="selected" />
      <CampaignWorkspaceNavigation campaignId="selected" campaignName="Selected campaign" status="active" activeTab="overview" sections={[]} campaigns={[]} />
    </>));
    const focus = [...host.querySelectorAll("button")].find(button => button.textContent === "Focus")!;
    const rail = host.querySelector("aside")!;
    await act(async () => focus.click());
    expect(rail.dataset.campaignRailState).toBe("collapsed");
    expect(focus.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("h1")?.textContent).toBe("Selected campaign");
    await act(async () => focus.click());
    expect(rail.dataset.campaignRailState).toBe("expanded");
    expect(changes).toEqual([false, true]);
    sidebar.dataset.state = "collapsed";
    await act(async () => (host.querySelector('[aria-label="Collapse campaign list"]') as HTMLButtonElement).click());
    await act(async () => focus.click());
    await act(async () => focus.click());
    expect(rail.dataset.campaignRailState).toBe("collapsed");
    expect(changes).toEqual([false, true, false, false]);
  } finally {
    window.removeEventListener("label-suite:sidebar-state-change", change);
    await act(async () => root.unmount()); host.remove(); sidebar.remove(); vi.unstubAllGlobals();
  }
});
