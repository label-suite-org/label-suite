import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { CampaignManager } from "./campaigns/CampaignManager";
import { DocumentManager } from "./documents/DocumentManager";
import { RadioPluggingCockpit } from "./radio-plugging/RadioPluggingCockpit";
import { ReleaseRoster } from "./releases/ReleaseRoster";
import { RoyaltyManager } from "./royalties/RoyaltyManager";
import { ArtistRoster } from "./artists/ArtistRoster";
import { MediaAssetManager } from "./media-assets/MediaAssetManager";
import { OpsTaskManager } from "./ops-tasks/OpsTaskManager";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildMasterPayoutPreview, buildRoyaltiesDashboard } from "../server/royalties-dashboard-core";

const royaltyData = {
  dashboard: buildRoyaltiesDashboard([], []),
  pipeline: { earningTotals: [], postedTotals: [], earnings: { rowCount: 0, matchedCount: 0, unmatchedCount: 0, netAmount: 0 }, imports: [], statements: { closingBalance: 0, openCount: 0 } },
  payoutPreview: buildMasterPayoutPreview([], []),
};

describe("out-of-scope read-only affordances", () => {
  it("hides release mutations for fundraiser while retaining operator controls", () => {
    const fundraiser = renderToStaticMarkup(<ReleaseRoster releases={[]} artists={[]} canMutate={false} />);
    const operator = renderToStaticMarkup(<ReleaseRoster releases={[]} artists={[]} canMutate />);
    expect(fundraiser).toContain("Read-only for fundraiser");
    expect(fundraiser).not.toContain("New Release");
    expect(operator).toContain("New Release");
  });

  it("hides royalty creation and imports for fundraiser", () => {
    const props = { ...royaltyData, initialRecords: [], artists: [], releases: [] } as unknown as ComponentProps<typeof RoyaltyManager>;
    const fundraiser = renderToStaticMarkup(<RoyaltyManager {...props} canMutate={false} />);
    const operator = renderToStaticMarkup(<RoyaltyManager {...props} canMutate />);
    expect(fundraiser).toContain("Read-only for fundraiser");
    expect(fundraiser).not.toContain("Add Record");
    expect(fundraiser).not.toContain("Import Statement");
    expect(operator).toContain("Import Statement");
  });

  it("hides radio and campaign mutations for fundraiser", () => {
    const radio = renderToStaticMarkup(<RadioPluggingCockpit campaigns={[]} current={null} allStations={[]} canMutate={false} />);
    const campaigns = renderToStaticMarkup(<CampaignManager campaigns={[]} releases={[]} artists={[]} canMutate={false} />);
    expect(radio).toContain("Read-only for fundraiser");
    expect(campaigns).toContain("Read-only for fundraiser");
    expect(campaigns).not.toContain("Create campaign");
  });

  it("keeps generic documents readable but hides mutation controls", () => {
    const fundraiser = renderToStaticMarkup(<DocumentManager initialDocuments={[]} artists={[]} releases={[]} contacts={[]} canMutate={false} />);
    const operator = renderToStaticMarkup(<DocumentManager initialDocuments={[]} artists={[]} releases={[]} contacts={[]} canMutate />);
    expect(fundraiser).toContain("Read-only for fundraiser");
    expect(fundraiser).not.toContain("Add document");
    expect(operator).toContain("Add document");
  });

  it("hides artist, media asset, and ops task mutations for fundraiser", () => {
    const artists = renderToStaticMarkup(<ArtistRoster artists={[]} canMutate={false} />);
    const media = renderToStaticMarkup(<MediaAssetManager initialAssets={[]} artists={[]} releases={[]} canMutate={false} />);
    const tasks = renderToStaticMarkup(<OpsTaskManager initialTasks={[]} artists={[]} releases={[]} campaigns={[]} contacts={[]} projects={[]} events={[]} canMutate={false} />);
    expect(artists).toContain("Read-only for fundraiser");
    expect(artists).not.toContain("New Artist");
    expect(media).toContain("Read-only for fundraiser");
    expect(media).not.toContain("Add asset");
    expect(tasks).toContain("Read-only for fundraiser");
    expect(tasks).not.toContain("New Task");
  });

  it.each([
    ["../pages/artists/[id].astro", "canMutate={canMutate}"],
    ["../pages/releases/[id]/tracks.astro", "canMutate={canMutate}"],
    ["../pages/works/[id].astro", "canMutate={canMutate}"],
  ])("passes canonical operations capability through %s", (path, contract) => {
    const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
    expect(source).toContain("serializeClientCapabilities");
    expect(source).toContain('["operations.mutate"]');
    expect(source).toContain(contract);
  });
});
