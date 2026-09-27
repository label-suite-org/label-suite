import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignWorkingTasks, CampaignWorkspaceNavigation } from "./CampaignWorkspaceChrome";

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
  });

  it("links a campaign task to the existing task editor", () => {
    const html = renderToStaticMarkup(<CampaignWorkingTasks tasks={[{ id: "task-1", title: "Review radio pitch", nextAction: "Check the draft", dueDate: "2026-09-30" }]} />);
    expect(html).toContain("/ops-tasks?task=task-1");
    expect(html).toContain("Check the draft");
  });
});
