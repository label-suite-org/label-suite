/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CampaignDiscoveryWorkspace from "./CampaignDiscoveryWorkspace";

const review = (state: "unreviewed" | "shortlisted" | "rejected" | "promoted" = "unreviewed") => ({
  state,
  reason: state === "rejected" ? "wrong_music" as const : null,
  actor_user_id: state === "rejected" ? "operator-1" : null,
  decided_at: state === "rejected" ? "2026-08-15T10:00:00.000Z" : null,
  revision: state === "unreviewed" ? 0 : 1,
  history: [],
  promoted_lead_id: state === "promoted" ? "lead-1" : null,
  promotion_outcome: state === "promoted" ? "created" : null,
  promoted_evidence: [],
  prior_campaign_decisions: [],
});

function workspace(state: "unreviewed" | "shortlisted" | "rejected" | "promoted" = "unreviewed") {
  const channel = {
    provider_channel_id: "channel-1",
    title: "Channel One",
    url: "https://youtube.test/channel-1",
    evidence: [{ provider_item_id: "video-1", title: "Release session", url: "https://youtube.test/video-1", query: "artist release", published_at: "2026-08-10T10:00:00.000Z", retrieved_at: "2026-08-15T10:00:00.000Z" }],
    exact_match_evidence: [],
    prospective_fit: { qualifies: true, signals: ["matching_content_format"] },
    activity_freshness: { state: "fresh" as const, latest_activity_at: "2026-08-10T10:00:00.000Z", expires_at: "2026-11-10T10:00:00.000Z" },
    relevance: { exactness: 0, editorial_fit: 1, activity: 1, evidence_strength: 1, total: 4 },
    review: review(state),
  };
  return {
    availability: { available: true, reason: null },
    query_preview: [{ query: "artist release", enabled: true, editable: true }],
    estimated_cost_units: 100,
    runs: [{ id: "run-1", status: "completed" as const, created_at: "2026-08-15T10:00:00.000Z", estimated_cost_units: 100, queries: [{ query: "artist release", enabled: true, status: "completed" as const, error: null }], channels: [channel], exact_match_channels: [], prospective_fit_channels: [channel] }],
  };
}

describe("CampaignDiscoveryWorkspace review controls", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it("hides rejected candidates by default and sends an optimistic-concurrency shortlist", async () => {
    let current = workspace("unreviewed");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return new Response(JSON.stringify(current), { status: 200 });
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ type: "shortlist", channel_id: "channel-1", expected_revision: 0 });
      current = workspace("shortlisted");
      return new Response(JSON.stringify(current), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<CampaignDiscoveryWorkspace campaignId="campaign-1" canMutate />));
    await act(async () => await Promise.resolve());
    expect(host.textContent).toContain("Channel One");
    await act(async () => {
      ([...host.querySelectorAll("button")].find((button) => button.textContent === "Shortlist") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("shortlisted");

    current = workspace("rejected");
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<CampaignDiscoveryWorkspace campaignId="campaign-1" canMutate />));
    await act(async () => await Promise.resolve());
    expect(host.textContent).not.toContain("Channel One");
    const toggle = [...host.querySelectorAll('input[type="checkbox"]')].at(-1) as HTMLInputElement;
    await act(async () => toggle.click());
    expect(host.textContent).toContain("Channel One");
  });

  it("promotes a shortlisted candidate with selected evidence and links the lead", async () => {
    let current = workspace("shortlisted");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (!init) return new Response(JSON.stringify(current), { status: 200 });
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ type: "promote", channel_id: "channel-1", expected_revision: 1, evidence_ids: ["video-1"] });
      current = workspace("promoted");
      return new Response(JSON.stringify(current), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<CampaignDiscoveryWorkspace campaignId="campaign-1" canMutate />));
    await act(async () => await Promise.resolve());
    await act(async () => {
      ([...host.querySelectorAll("button")].find((button) => button.textContent === "Promote to Campaign Lead") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("promoted");
    expect(host.textContent).toContain("lead-1");
  });
});
