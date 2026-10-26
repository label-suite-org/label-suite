import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignManager } from "./CampaignManager";

describe("campaign board legacy statuses", () => {
  it("groups title-case completed campaigns with canonical completed campaigns", () => {
    const base = { revision: 1, campaign_type: null, start_date: null, end_date: null, owner: null, budget_planned: null, performance_rating: null, main_platform: null, release_title: null, artist_name: null };
    const html = renderToStaticMarkup(<CampaignManager releases={[]} artists={[]} canMutate={false} campaigns={[
      { ...base, id: "one", campaign_name: "Legacy completed", status: " Completed " },
      { ...base, id: "two", campaign_name: "Canonical completed", status: "completed" },
    ]} />);
    expect(html).not.toContain("Other");
    expect(html).not.toContain("No completed campaigns");
    expect(html).toContain("Legacy completed");
    expect(html).toContain("Canonical completed");
  });
});
