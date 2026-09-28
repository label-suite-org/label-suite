import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import CampaignContentManager from "./CampaignContentManager";

test("shows loading rather than an error before content context is fetched", () => {
  const html = renderToStaticMarkup(<CampaignContentManager campaignId="campaign-1" canMutate={false} />);

  expect(html).toContain("Loading reviewed template context");
  expect(html).not.toContain("Unable to load campaign content context");
});
