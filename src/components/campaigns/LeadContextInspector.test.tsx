import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import type { CampaignActivityItem, CampaignActivityProposal } from "../../server/campaign-activity-core";
import LeadContextInspector from "./LeadContextInspector";

const lead = {
  id: "lead-1",
  campaign_id: "campaign-1",
  source_id: "source-1",
  target_name: "Lead One",
  target_type: "publication",
  target_url: "https://example.test/lead-one",
  contact_route: "Public email",
  contact_route_verified_at: null,
  discovery_source: "Friend recommendation",
  recommending_person: null,
  introduction_available: null,
  musical_fit: null,
  relationship_warmth: 2,
  editorial_fit: 2,
  useful_reach: 1,
  direct_free_access: 1,
  pipeline_stage: "qualified",
  pitch_angle: null,
  last_contacted_at: null,
  follow_up_at: null,
  outcome: null,
  evidence_url: null,
  published_at: null,
  notes: null,
  readiness_task_waiver_reason: null,
  updated_at: new Date("2026-08-08T12:00:00.000Z"),
  priority_score: 6,
  contact_id: null,
  contact_name: null,
  station_id: null,
  station_name: null,
  exact_edit_track_id: null,
  exact_edit_title: null,
  dedupe_key: "url:https://example.test/lead-one",
  source_title: "Friend recommendation",
  tasks: [],
  latest_suggestions: [],
  draft_versions: [],
  ready_blockers: [],
  activity: [
    { id: "legacy-1", event_type: "z_old_event", occurred_at: "2026-08-01T10:00:00.000Z" },
    { id: "legacy-2", event_type: "a_new_event", occurred_at: "2026-08-08T10:00:00.000Z" },
  ],
} as unknown as CampaignOutreachWorkspaceData["leads"][number];

function activityItem(overrides: Partial<CampaignActivityItem> = {}): CampaignActivityItem {
  return {
    key: "event:item-1:research_completed",
    category: "research",
    kind: "research_completed",
    occurredAt: new Date("2026-08-01T10:00:00.000Z"),
    title: "Normalized research title",
    summary: null,
    actor: { kind: "system", id: null, label: null },
    refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: null, draftId: null },
    evidence: [],
    source: { kind: "event", recordId: "item-1" },
    ...overrides,
  };
}

function proposal(overrides: Partial<CampaignActivityProposal> = {}): CampaignActivityProposal {
  return {
    key: "campaign-1:lead-1:research-next:v1",
    ruleKey: "research-next",
    ruleVersion: 1,
    actionType: "start_research",
    leadId: "lead-1",
    taskId: null,
    state: "pending",
    title: "Matching recommendation",
    summary: "Review the matching next step.",
    href: "/campaigns/campaign-1?tab=outreach&lead=lead-1#lead-research",
    evidenceKeys: [],
    ...overrides,
  };
}

describe("LeadContextInspector", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("renders activity timestamps consistently across server and browser time zones", () => {
    const content = <LeadContextInspector lead={lead} source={null} activityItems={[activityItem()]}
      pendingProposals={[]} canMutate={false} busy={false} onOverrideStage={vi.fn()} onLogFinding={vi.fn()} />;
    vi.stubEnv("TZ", "UTC");
    const server = renderToStaticMarkup(content);
    vi.stubEnv("TZ", "Europe/Copenhagen");
    expect(renderToStaticMarkup(content)).toBe(server);
    expect(server).toContain("1 Aug, 12:00");
  });

  test("renders normalized shared activity and matching pending proposals without interpreting legacy events", () => {
    const html = renderToStaticMarkup(
      <LeadContextInspector
        lead={lead}
        source={null}
        activityItems={[
          activityItem(),
          activityItem({ key: "event:item-2:reply_recorded", category: "reply", kind: "reply_recorded", title: "Normalized reply title", occurredAt: null, source: { kind: "event", recordId: "item-2" } }),
          activityItem({ key: "event:other:research_completed", title: "Other lead should be filtered by workspace", refs: { campaignId: "campaign-1", leadId: "lead-2", contactId: null, taskId: null, draftId: null }, source: { kind: "event", recordId: "other" } }),
        ]}
        pendingProposals={[proposal(), proposal({ key: "campaign-1:lead-2:draft-next:v1", leadId: "lead-2", title: "Other recommendation" })]}
        canMutate={false}
        busy={false}
        onOverrideStage={vi.fn()}
        onLogFinding={vi.fn()}
      />,
    );

    expect(html).toContain("Normalized research title");
    expect(html).toContain("Normalized reply title");
    expect(html).toContain("Matching recommendation");
    expect(html).not.toContain("Other lead should be filtered by workspace");
    expect(html).not.toContain("Other recommendation");
    expect(html).not.toContain("z old event");
    expect(html).not.toContain("a new event");
    expect(html.indexOf("Normalized research title")).toBeLessThan(html.indexOf("Normalized reply title"));
    expect(html).toContain("Time unknown");
  });
});
