import { describe, expect, test } from "vitest";
import {
  campaignActivityDecisionSchema,
  composeCampaignActivity,
  deriveCampaignActivityProposals,
  normalizeCampaignActivity,
  type CampaignActivityItem,
} from "./campaign-activity-core";

function lead(overrides: Partial<{
  id: string;
  contactId: string | null;
  followUpAt: Date | null;
  lastContactedAt: Date | null;
  outcome: string | null;
  publishedAt: Date | null;
  pipelineStage: string | null;
}> = {}) {
  return {
    id: "lead-1",
    contactId: "contact-1",
    followUpAt: null,
    lastContactedAt: null,
    outcome: null,
    publishedAt: null,
    pipelineStage: "ready",
    ...overrides,
  };
}

describe("campaign relationship activity normalization", () => {
  test("keeps immutable send evidence and drops the duplicate lead snapshot", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [{
        id: "event-send-1", campaignId: "campaign-1", leadId: "lead-1",
        draftId: "draft-1", eventType: "external_send_recorded",
        actorUserId: "user-1", occurredAt: new Date("2026-08-04T10:00:00Z"),
        details: { channel: "email", destination: "private@example.com" },
      }],
      tasks: [], emailLogs: [], reviewStates: [],
      leads: [lead({
        lastContactedAt: new Date("2026-08-04T10:00:00Z"),
        pipelineStage: "sent",
      })],
    });

    expect(items.filter((item) => item.kind === "external_send_recorded")).toHaveLength(1);
    expect(JSON.stringify(items)).not.toContain("private@example.com");
  });

  test("sorts equal activity times by stable key and places unknown times last", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [], emailLogs: [], reviewStates: [],
      tasks: [
        { id: "task-b", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "B", status: "todo", updatedAt: new Date("2026-08-04T10:00:00Z") },
        { id: "task-a", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "A", status: "todo", updatedAt: new Date("2026-08-04T10:00:00Z") },
      ],
      leads: [lead({ id: "lead-unknown", outcome: "No response" })],
    });

    expect(items.map((item) => item.key)).toEqual([
      "task:task-a:task_state",
      "task:task-b:task_state",
      "lead:lead-unknown:outcome",
    ]);
  });

  test("only exposes allowlisted email metadata", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [], tasks: [], reviewStates: [], leads: [],
      emailLogs: [{
        id: "email-1", campaignId: "campaign-1", leadId: "lead-1", contactId: "contact-1",
        subject: "Safe subject", stationLabel: "Safe station", status: "sent", provider: "postmark",
        operatorLabel: "Malthe", sentAt: new Date("2026-08-05T10:00:00Z"),
        body: "PRIVATE EMAIL BODY", sender_email: "sender@example.com", error_message: "PRIVATE ERROR",
        provider_message_id: "PRIVATE PROVIDER ID", destination: "private@example.com",
      }],
    });
    const serialized = JSON.stringify(items);

    expect(serialized).toContain("Safe subject");
    expect(serialized).toContain("Safe station");
    expect(serialized).not.toContain("PRIVATE EMAIL BODY");
    expect(serialized).not.toContain("sender@example.com");
    expect(serialized).not.toContain("PRIVATE ERROR");
    expect(serialized).not.toContain("PRIVATE PROVIDER ID");
    expect(serialized).not.toContain("private@example.com");
  });

  test("maps outreach event categories without exposing their details", () => {
    const items = normalizeCampaignActivity({
      tasks: [], emailLogs: [], reviewStates: [], leads: [],
      outreachEvents: [
        { id: "research", campaignId: "campaign-1", leadId: null, draftId: null, eventType: "research_retried", actorUserId: null, occurredAt: null, details: { secret: "no" } },
        { id: "draft", campaignId: "campaign-1", leadId: null, draftId: null, eventType: "preparation_updated", actorUserId: null, occurredAt: null },
        { id: "reply", campaignId: "campaign-1", leadId: null, draftId: null, eventType: "reply_received", actorUserId: null, occurredAt: null },
        { id: "outcome", campaignId: "campaign-1", leadId: null, draftId: null, eventType: "publication_confirmed", actorUserId: null, occurredAt: null },
      ],
    });
    expect(items.map((item) => [item.kind, item.category])).toEqual([
      ["preparation_updated", "outreach"],
      ["publication_confirmed", "outcome"],
      ["reply_received", "reply"],
      ["research_retried", "research"],
    ]);
    expect(JSON.stringify(items)).not.toContain("secret");
  });

  test("preserves allowlisted task due date and next action metadata", () => {
    const [task] = normalizeCampaignActivity({
      outreachEvents: [], emailLogs: [], reviewStates: [], leads: [],
      tasks: [{
        id: "task-1", campaignId: "campaign-1", leadId: "lead-1", contactId: null,
        taskName: "Follow up", status: "todo", dueDate: "2026-08-18",
        nextAction: "Send the approved follow-up", updatedAt: new Date("2026-08-17T10:00:00Z"),
      }],
    });

    expect(task.task).toEqual({ status: "todo", dueDate: "2026-08-18", nextAction: "Send the approved follow-up" });
  });

  test("prefers immutable review events over matching snapshot milestones", () => {
    for (const fixture of [
      { id: "suggestion:suggestion-1", state: "accepted", eventType: "suggestion_accepted", draftId: null },
      { id: "suggestion:suggestion-2", state: "rejected", eventType: "suggestion_rejected", draftId: null },
      { id: "draft:draft-1", state: "approved", eventType: "draft_approved", draftId: "draft-1" },
    ]) {
      const items = normalizeCampaignActivity({
        outreachEvents: [{
          id: `event-${fixture.eventType}`, campaignId: "campaign-1", leadId: "lead-1",
          draftId: fixture.draftId, eventType: fixture.eventType, actorUserId: "user-1",
          occurredAt: new Date("2026-08-18T10:00:00Z"),
          details: fixture.eventType.startsWith("suggestion_") ? { suggestion_id: fixture.id.slice("suggestion:".length) } : undefined,
        }],
        reviewStates: [{
          id: fixture.id, campaignId: "campaign-1", leadId: "lead-1", state: fixture.state,
          occurredAt: new Date("2026-08-18T09:00:00Z"),
        }],
        tasks: [], emailLogs: [], leads: [],
      });

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ kind: fixture.eventType, source: { kind: "event" } });
    }
  });

  test("keeps unrelated same-lead suggestion and draft review snapshots", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [
        {
          id: "event-suggestion", campaignId: "campaign-1", leadId: "lead-1", draftId: null,
          eventType: "suggestion_accepted", actorUserId: "user-1", occurredAt: new Date("2026-08-18T10:00:00Z"),
          details: { suggestion_id: "suggestion-1" },
        },
        {
          id: "event-draft", campaignId: "campaign-1", leadId: "lead-1", draftId: "draft-1",
          eventType: "draft_approved", actorUserId: "user-1", occurredAt: new Date("2026-08-18T10:00:00Z"),
        },
      ],
      reviewStates: [
        { id: "suggestion:suggestion-2", campaignId: "campaign-1", leadId: "lead-1", state: "accepted", occurredAt: new Date("2026-08-18T09:00:00Z") },
        { id: "draft:draft-2", campaignId: "campaign-1", leadId: "lead-1", state: "approved", occurredAt: new Date("2026-08-18T09:00:00Z") },
      ],
      tasks: [], emailLogs: [], leads: [],
    });

    expect(items.map((item) => item.source.recordId)).toEqual([
      "event-draft", "event-suggestion", "draft:draft-2", "suggestion:suggestion-2",
    ]);
  });

  test("keeps review snapshots when an event is missing its durable ID", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [
        {
          id: "event-suggestion", campaignId: "campaign-1", leadId: "lead-1", draftId: null,
          eventType: "suggestion_accepted", actorUserId: "user-1", occurredAt: new Date("2026-08-18T10:00:00Z"),
        },
        {
          id: "event-draft", campaignId: "campaign-1", leadId: "lead-1", draftId: null,
          eventType: "draft_approved", actorUserId: "user-1", occurredAt: new Date("2026-08-18T10:00:00Z"),
        },
      ],
      reviewStates: [
        { id: "suggestion:suggestion-1", campaignId: "campaign-1", leadId: "lead-1", state: "accepted", occurredAt: new Date("2026-08-18T09:00:00Z") },
        { id: "draft:draft-1", campaignId: "campaign-1", leadId: "lead-1", state: "approved", occurredAt: new Date("2026-08-18T09:00:00Z") },
      ],
      tasks: [], emailLogs: [], leads: [],
    });

    expect(items.map((item) => item.source.recordId)).toEqual([
      "event-draft", "event-suggestion", "draft:draft-1", "suggestion:suggestion-1",
    ]);
  });
});

function activity(overrides: Partial<CampaignActivityItem> = {}): CampaignActivityItem {
  return {
    key: "event:event-1:external_send_recorded",
    category: "outreach",
    kind: "external_send_recorded",
    occurredAt: new Date("2026-08-04T10:00:00Z"),
    title: "External send recorded",
    summary: null,
    actor: { kind: "system", id: null, label: null },
    refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: "contact-1", taskId: null, draftId: null },
    evidence: [],
    source: { kind: "event", recordId: "event-1" },
    ...overrides,
  };
}

function leadState(overrides: Partial<Parameters<typeof deriveCampaignActivityProposals>[0]["leads"][number]> = {}) {
  return lead(overrides);
}

describe("campaign relationship activity proposals", () => {
  test("does not repeat research after an authoritative refusal", () => {
    const refusal = activity({ key: "event:research:research_refused", kind: "research_refused", category: "research" });
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items: [refusal],
      leads: [leadState({ pipelineStage: "identified" })], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("requires accepted review context rather than research completion alone before drafting", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      items: [activity({ key: "event:research:research_completed", kind: "research_completed", category: "research" })],
      leads: [leadState()], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("uses accepted suggestion review state as draft evidence", () => {
    const snapshot = composeCampaignActivity({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), outreachEvents: [],
      reviewStates: [{ id: "suggestion:suggestion-1", campaignId: "campaign-1", leadId: "lead-1", state: "accepted", occurredAt: new Date("2026-08-19T10:00:00Z") }],
      leads: [leadState()], tasks: [], emailLogs: [], decisions: [],
    });
    expect(snapshot.proposals).toEqual([expect.objectContaining({
      ruleKey: "draft-next",
      evidenceKeys: ["review:suggestion:suggestion-1:suggestion_accepted"],
    })]);
  });

  test("proposes task review only for overdue work or a nonblank unresolved next action", () => {
    const tasks = [
      { id: "overdue", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Overdue", status: "todo", dueDate: "2026-08-19", nextAction: null, updatedAt: null },
      { id: "future", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Future", status: "todo", dueDate: "2026-08-21", nextAction: "   ", updatedAt: null },
      { id: "today", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Due today", status: "todo", dueDate: "2026-08-20", nextAction: null, updatedAt: null },
      { id: "completed-action", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Completed with action", status: "completed", dueDate: "2026-08-19", nextAction: "Resolve the remaining handoff", updatedAt: null },
      { id: "completed", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Completed", status: "completed", dueDate: "2026-08-19", nextAction: null, updatedAt: null },
    ];
    const items = normalizeCampaignActivity({ outreachEvents: [], emailLogs: [], reviewStates: [], leads: [], tasks });
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items,
      leads: [], tasks, decisions: [],
    });
    expect(proposals.map((proposal) => proposal.taskId)).toEqual(["completed-action", "overdue"]);
  });

  test("bounds long deterministic proposal keys and keeps decisions stable", () => {
    const items = Array.from({ length: 80 }, (_, index) => activity({
      key: `event:${String(index).padStart(3, "0")}:${"evidence".repeat(12)}`,
      kind: "lead_context_recorded",
      refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: null, draftId: null },
    }));
    const input = {
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items,
      leads: [leadState({ pipelineStage: "identified" })], tasks: [], decisions: [],
    };
    const [first] = deriveCampaignActivityProposals(input);
    const [second] = deriveCampaignActivityProposals({ ...input, items: [...items].reverse() });

    expect(first.evidenceKeys).toHaveLength(80);
    expect(first.key.length).toBeLessThanOrEqual(500);
    expect(second.key).toBe(first.key);
    expect(deriveCampaignActivityProposals({
      ...input,
      decisions: [{ proposalKey: first.key, decision: "dismissed", reason: null, decidedAt: null }],
    })[0]?.state).toBe("dismissed");
  });

  test("never emits a proposal without evidence that resolves to an activity item", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items: [],
      leads: [leadState({ pipelineStage: "identified" })],
      tasks: [{ id: "task-1", campaignId: "campaign-1", leadId: null, contactId: null, taskName: "Follow up", status: "todo", dueDate: "2026-08-19", nextAction: null, updatedAt: null }],
      decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("proposes follow-up review only after its date and without later evidence", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1",
      now: new Date("2026-08-20T12:00:00Z"),
      items: [activity()],
      leads: [leadState({ followUpAt: new Date("2026-08-18T10:00:00Z") })],
      tasks: [], decisions: [],
    });
    expect(proposals).toEqual([expect.objectContaining({
      ruleKey: "follow-up-review", ruleVersion: 1,
      actionType: "review_follow_up", leadId: "lead-1", state: "pending",
    })]);
  });

  test("suppresses a due follow-up after a later reply or outcome", () => {
    for (const kind of ["reply_recorded", "outcome_recorded"]) {
      const proposals = deriveCampaignActivityProposals({
        campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
        items: [activity(), activity({ key: `event:${kind}:${kind}`, kind, category: kind === "reply_recorded" ? "reply" : "outcome", occurredAt: new Date("2026-08-19T10:00:00Z") })],
        leads: [leadState({ followUpAt: new Date("2026-08-18T10:00:00Z") })], tasks: [], decisions: [],
      });
      expect(proposals).toEqual([]);
    }
  });

  test("suppresses a due follow-up after a normalized reply or outcome category", () => {
    for (const kind of ["reply_received", "publication_confirmed"]) {
      const items = normalizeCampaignActivity({
        outreachEvents: [
          { id: "send", campaignId: "campaign-1", leadId: "lead-1", draftId: null, eventType: "external_send_recorded", actorUserId: null, occurredAt: new Date("2026-08-04T10:00:00Z") },
          { id: kind, campaignId: "campaign-1", leadId: "lead-1", draftId: null, eventType: kind, actorUserId: null, occurredAt: new Date("2026-08-19T10:00:00Z") },
        ],
        tasks: [], emailLogs: [], reviewStates: [], leads: [],
      });
      const proposals = deriveCampaignActivityProposals({
        campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
        items,
        leads: [leadState({ followUpAt: new Date("2026-08-18T10:00:00Z") })], tasks: [], decisions: [],
      });
      expect(proposals).toEqual([]);
    }
  });

  test("suppresses next research after a normalized terminal reply", () => {
    const items = normalizeCampaignActivity({
      outreachEvents: [{ id: "reply", campaignId: "campaign-1", leadId: "lead-1", draftId: null, eventType: "reply_received", actorUserId: null, occurredAt: new Date("2026-08-19T10:00:00Z") }],
      tasks: [], emailLogs: [], reviewStates: [], leads: [],
    });
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items,
      leads: [leadState({ pipelineStage: "identified" })], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("suppresses research while a lead already has active research", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      items: [activity({ key: "event:research:research_started", kind: "research_started", category: "research" })],
      leads: [leadState({ pipelineStage: "identified" })], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("suppresses research when in-progress research has no timestamp", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      items: [activity({ key: "event:research:research_started", kind: "research_started", category: "research", occurredAt: null })],
      leads: [leadState({ pipelineStage: "identified" })], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("suppresses drafting for an approved or current draft", () => {
    for (const kind of ["draft_created", "draft_approved"]) {
      const proposals = deriveCampaignActivityProposals({
        campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
        items: [
          activity({ key: "event:research:research_completed", kind: "research_completed", category: "research" }),
          activity({ key: `event:${kind}:${kind}`, kind }),
        ],
        leads: [leadState()], tasks: [], decisions: [],
      });
      expect(proposals).toEqual([]);
    }
  });

  test("suppresses drafting when the current draft has no timestamp", () => {
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      items: [
        activity({ key: "event:research:research_completed", kind: "research_completed", category: "research" }),
        activity({ key: "event:draft:draft_created", kind: "draft_created", occurredAt: null }),
      ],
      leads: [leadState()], tasks: [], decisions: [],
    });
    expect(proposals).toEqual([]);
  });

  test("honors current and approved draft table review rows", () => {
    for (const state of ["draft", "approved"]) {
      const snapshot = composeCampaignActivity({
        campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), outreachEvents: [],
        reviewStates: [
          { id: "suggestion:suggestion-1", campaignId: "campaign-1", leadId: "lead-1", state: "accepted", occurredAt: new Date("2026-08-18T10:00:00Z") },
          { id: "draft:draft-1", campaignId: "campaign-1", leadId: "lead-1", state, occurredAt: new Date("2026-08-19T10:00:00Z") },
        ],
        leads: [leadState()], tasks: [], emailLogs: [], decisions: [],
      });
      expect(snapshot.proposals).toEqual([]);
      expect(snapshot.items).toContainEqual(expect.objectContaining({ kind: state === "draft" ? "draft_current" : "draft_approved" }));
    }
  });

  test("does not propose review for completed tasks", () => {
    const task = { id: "task-1", campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskName: "Follow up", status: "completed", dueDate: "2026-08-19", nextAction: null, updatedAt: new Date("2026-08-19T10:00:00Z") };
    const proposals = deriveCampaignActivityProposals({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      items: normalizeCampaignActivity({ outreachEvents: [], emailLogs: [], reviewStates: [], leads: [], tasks: [task] }),
      leads: [], decisions: [], tasks: [task],
    });
    expect(proposals).toEqual([]);
  });

  test("keeps only proposals whose required sources are complete", () => {
    const common = {
      campaignId: "campaign-1",
      now: new Date("2026-08-20T12:00:00Z"),
      items: [
        activity({ key: "event:lead-context:lead_context_recorded", kind: "lead_context_recorded" }),
        activity({
          key: "task:task-1:task_state", kind: "task_state", category: "task",
          refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: "task-1", draftId: null },
          source: { kind: "task", recordId: "task-1" },
        }),
      ],
      leads: [leadState({ pipelineStage: "identified" })],
      tasks: [{ id: "task-1", campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskName: "Follow up", status: "todo", dueDate: "2026-08-19", nextAction: null, updatedAt: new Date("2026-08-19T10:00:00Z") }],
      decisions: [],
    };
    const complete = [
      { source: "outreach_events" as const, state: "complete" as const, message: null },
      { source: "tasks" as const, state: "complete" as const, message: null },
      { source: "email_logs" as const, state: "complete" as const, message: null },
      { source: "lead_milestones" as const, state: "complete" as const, message: null },
      { source: "review_state" as const, state: "complete" as const, message: null },
    ];

    expect(deriveCampaignActivityProposals({
      ...common,
      sourceStates: complete.map((source) => source.source === "tasks" ? { ...source, state: "unavailable" as const } : source),
    }).map((proposal) => proposal.ruleKey)).toEqual(["research-next"]);
    expect(deriveCampaignActivityProposals({
      ...common,
      sourceStates: complete.map((source) => source.source === "outreach_events" ? { ...source, state: "unavailable" as const } : source),
    }).map((proposal) => proposal.ruleKey)).toEqual(["task-review"]);

    expect(deriveCampaignActivityProposals({
      ...common,
      sourceStates: complete.map((source) => source.source === "lead_milestones" ? { ...source, state: "partial" as const } : source),
    }).map((proposal) => proposal.ruleKey)).toEqual(["task-review"]);
    expect(deriveCampaignActivityProposals({
      ...common,
      sourceStates: complete.map((source) => source.source === "tasks" ? { ...source, state: "partial" as const } : source),
    }).map((proposal) => proposal.ruleKey)).toEqual(["research-next"]);
    expect(deriveCampaignActivityProposals({
      ...common,
      sourceStates: complete.map((source) => source.source === "review_state" ? { ...source, state: "partial" as const } : source),
    })).toEqual([]);
  });

  test("applies only the matching stored decision to a proposal", () => {
    const input = {
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"), items: [activity()],
      leads: [leadState({ followUpAt: new Date("2026-08-18T10:00:00Z") })], tasks: [], decisions: [],
    };
    const [proposal] = deriveCampaignActivityProposals(input);
    const proposals = deriveCampaignActivityProposals({
      ...input,
      decisions: [
        { proposalKey: proposal.key, decision: "dismissed" as const, reason: "Not needed", decidedAt: new Date("2026-08-20T11:00:00Z") },
        { proposalKey: "another-campaign:lead-1:follow-up-review:1", decision: "resolved" as const, reason: "Elsewhere", decidedAt: null },
      ],
    });
    expect(proposals).toEqual([expect.objectContaining({ key: proposal.key, state: "dismissed" })]);
  });

  test("composes normalized items and preserves source completeness", () => {
    const snapshot = composeCampaignActivity({
      campaignId: "campaign-1", now: new Date("2026-08-20T12:00:00Z"),
      outreachEvents: [], emailLogs: [], leads: [], tasks: [], decisions: [],
      reviewStates: [{ id: "review-1", campaignId: "campaign-1", leadId: "lead-1", state: "pending", occurredAt: new Date("2026-08-20T10:00:00Z") }],
      sourceStates: [{ source: "review_state", state: "unavailable", message: "Review state is unavailable" }],
    });
    expect(snapshot.items).toHaveLength(1);
    expect(snapshot.proposals).toEqual([]);
    expect(snapshot.sourceStates).toEqual([{ source: "review_state", state: "unavailable", message: "Review state is unavailable" }]);
  });

  test("validates strictly bounded activity decisions", () => {
    expect(campaignActivityDecisionSchema.parse({ proposal_key: "proposal-1", decision: "resolved", reason: null })).toEqual({ proposal_key: "proposal-1", decision: "resolved", reason: null });
    expect(() => campaignActivityDecisionSchema.parse({ proposal_key: "proposal-1", decision: "resolved", extra: true })).toThrow();
  });
});
