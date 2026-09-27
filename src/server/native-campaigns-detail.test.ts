import { describe, expect, it, vi } from "vitest";
vi.mock("../lib/db", () => ({ db: {} }));
import { HttpError } from "./errors";
import { paginateNativeCampaignActivity, projectNativeCampaignDetail } from "./native-campaigns";

const snapshot = {
  items: [
    activity("event-b", "2026-09-16T12:00:00.000Z"),
    activity("event-a", "2026-09-16T12:00:00.000Z"),
    activity("task-c", "2026-09-15T12:00:00.000Z"),
  ],
  proposals: [],
  sourceStates: [{ source: "tasks" as const, state: "complete" as const, message: null }],
};

describe("native campaign detail projection", () => {
  it("retains canonical linked identities, archived state, bounded sections, and truthful freshness", () => {
    expect(projectNativeCampaignDetail({
      id: "campaign-a", campaign_name: "North Drop", status: "archived", campaign_type: "radio", owner: "Owner", goal: "Reach listeners",
      updated_at: new Date("2026-09-16T10:00:00.000Z"), artist_id: "artist-a", artist_name: "Artist A", release_id: "release-a", release_title: "Release A",
    }, new Date("2026-09-16T13:00:00.000Z"))).toEqual({
      campaign: {
        id: "campaign-a", name: "North Drop", status: "archived", campaign_type: "radio", owner: "Owner", goal: "Reach listeners", archived: true,
        artist: { id: "artist-a", name: "Artist A" }, release: { id: "release-a", title: "Release A" },
      },
      next_work: { label: "Review campaign activity", href: "/campaigns/campaign-a?section=activity" },
      sections: [{ key: "overview", title: "Overview" }, { key: "activity", title: "Activity" }, { key: "leads", title: "Leads" }],
      freshness: { state: "fresh", updated_at: "2026-09-16T10:00:00.000Z", fetched_at: "2026-09-16T13:00:00.000Z" },
    });
  });

  it("does not invent linked identity labels when links are absent", () => {
    const result = projectNativeCampaignDetail({
      id: "campaign-a", campaign_name: "North Drop", status: null, campaign_type: null, owner: null, goal: null,
      updated_at: null, artist_id: null, artist_name: null, release_id: null, release_title: null,
    }, new Date("2026-09-16T13:00:00.000Z"));
    expect(result.campaign.artist).toBeNull();
    expect(result.campaign.release).toBeNull();
    expect(result.freshness).toEqual({ state: "unknown", updated_at: null, fetched_at: "2026-09-16T13:00:00.000Z" });
  });
});

describe("native campaign activity pagination", () => {
  it("uses canonical descending timestamp then ascending key order across stable cursor pages", () => {
    const first = paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: null, limit: "2" });
    expect(first.items.map((item) => item.key)).toEqual(["event-a", "event-b"]);
    expect(first.items[0]?.actor).toEqual({ kind: "user", id: "user-a", label: "Operator" });
    expect(first.items[0]?.evidence).toEqual([{ label: "Source event", href: "/evidence/event-a" }]);
    expect(first.source_states).toEqual(snapshot.sourceStates);

    const second = paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: first.next_cursor, limit: "2" });
    expect(second.items.map((item) => item.key)).toEqual(["task-c"]);
    expect(second.next_cursor).toBeNull();
  });

  it("rejects malformed, foreign, and non-existent cursor positions and bounds limits", () => {
    expect(() => paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: "not-a-cursor", limit: "500" })).toThrow(HttpError);
    const first = paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: null, limit: "1" });
    const foreign = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8")), campaign_id: "campaign-b" })).toString("base64url");
    expect(() => paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: foreign, limit: "1" })).toThrow(HttpError);
    const absent = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8")), key: "missing" })).toString("base64url");
    expect(() => paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: absent, limit: "1" })).toThrow(HttpError);
    expect(paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: null, limit: "500" }).items).toHaveLength(3);
  });

  it("returns a distinct stale cursor conflict when canonical activity changes between pages", () => {
    const first = paginateNativeCampaignActivity("campaign-a", snapshot, { cursor: null, limit: "1" });
    const changed = { ...snapshot, items: [activity("event-new", "2026-09-17T12:00:00.000Z"), ...snapshot.items] };
    try {
      paginateNativeCampaignActivity("campaign-a", changed, { cursor: first.next_cursor, limit: "1" });
      throw new Error("expected stale cursor");
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: "activity_cursor_stale" });
    }
  });
});

function activity(key: string, occurredAt: string) {
  return {
    key, category: "outreach" as const, kind: "external_send_recorded", occurredAt: new Date(occurredAt), title: "External send recorded", summary: null,
    actor: { kind: "user" as const, id: "user-a", label: "Operator" }, refs: { campaignId: "campaign-a", leadId: null, contactId: null, taskId: null, draftId: null },
    evidence: [{ label: "Source event", href: `/evidence/${key}` }], source: { kind: "event", recordId: key },
  };
}
