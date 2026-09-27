import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  decideCampaignActivityProposal,
  getCampaignActivitySnapshot,
  type CampaignActivityStore,
} from "./campaign-activity";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function researchableLead() {
  return {
    id: "lead-1",
    campaignId: "campaign-1",
    contactId: "contact-1",
    followUpAt: null,
    lastContactedAt: null,
    outcome: null,
    publishedAt: null,
    pipelineStage: "identified",
  };
}

function researchableEvent() {
  return {
    id: "event-1",
    campaignId: "campaign-1",
    leadId: "lead-1",
    draftId: null,
    eventType: "research_started",
    actorUserId: "user-1",
    actorLabel: "Safe operator",
    occurredAt: new Date("2026-08-20T10:00:00.000Z"),
    details: { channel: "email", destination: "private@example.com", token: "PRIVATE TOKEN" },
  };
}

function researchContextEvent() {
  return {
    ...researchableEvent(),
    id: "event-context-1",
    eventType: "lead_preparation_updated",
  };
}

function fakeActivityStore(overrides: Partial<{
  outreachEvents: Awaited<ReturnType<CampaignActivityStore["listOutreachEvents"]>>;
  tasks: Awaited<ReturnType<CampaignActivityStore["listTasks"]>>;
  emailLogs: Awaited<ReturnType<CampaignActivityStore["listEmailLogs"]>>;
  leads: Awaited<ReturnType<CampaignActivityStore["listLeads"]>>;
  suggestionReviewStates: Awaited<ReturnType<CampaignActivityStore["listSuggestionReviewStates"]>>;
  draftReviewStates: Awaited<ReturnType<CampaignActivityStore["listDraftReviewStates"]>>;
  decisions: Awaited<ReturnType<CampaignActivityStore["listDecisions"]>>;
}> = {}) {
  const decisions = [...(overrides.decisions ?? [])];
  const store: CampaignActivityStore = {
    findCampaign: vi.fn().mockResolvedValue(true),
    listOutreachEvents: vi.fn().mockResolvedValue(overrides.outreachEvents ?? []),
    listTasks: vi.fn().mockResolvedValue(overrides.tasks ?? []),
    listEmailLogs: vi.fn().mockResolvedValue(overrides.emailLogs ?? []),
    listLeads: vi.fn().mockResolvedValue(overrides.leads ?? []),
    findLeadsByIds: vi.fn().mockResolvedValue([]),
    listSuggestionReviewStates: vi.fn().mockResolvedValue(overrides.suggestionReviewStates ?? []),
    listDraftReviewStates: vi.fn().mockResolvedValue(overrides.draftReviewStates ?? []),
    findDraftReviewStatesByIds: vi.fn().mockResolvedValue([]),
    listDecisions: vi.fn().mockImplementation(async () => [...decisions]),
    upsertDecision: vi.fn().mockImplementation(async (row) => {
      const next = {
        proposalKey: row.proposal_key,
        decision: row.decision,
        reason: row.reason,
        decidedAt: row.decided_at,
      };
      const existing = decisions.findIndex((item) => item.proposalKey === row.proposal_key);
      if (existing === -1) decisions.push(next);
      else decisions[existing] = next;
    }),
  };
  return store;
}

function deps(store: CampaignActivityStore) {
  return {
    store,
    now: () => NOW,
    randomUUID: () => "decision-1",
  };
}

describe("campaign relationship activity service", () => {
  beforeEach(() => vi.clearAllMocks());

  test("scopes every source read and exposes only safe activity fields", async () => {
    const store = fakeActivityStore({
      outreachEvents: [researchableEvent()],
      tasks: [{
        id: "task-1", campaignId: "campaign-1", leadId: "lead-1", contactId: "contact-1",
        taskName: "Review follow-up", status: "todo", updatedAt: NOW,
        priority: "P1", owner: "Malthe", dueDate: "2026-08-20", nextAction: "Review",
        createdAt: new Date("2026-08-19T10:00:00.000Z"),
      }],
      emailLogs: [{
        id: "email-1", campaignId: "campaign-1", leadId: "lead-1", contactId: "contact-1",
        subject: "Safe subject", status: "sent", provider: "postmark", operatorLabel: "Safe operator",
        stationLabel: "Safe station", sentAt: NOW, createdAt: NOW,
        body: "PRIVATE BODY", senderEmail: "sender@example.com", destination: "private@example.com",
        errorMessage: "PRIVATE ERROR", providerMessageId: "PRIVATE PROVIDER DATA",
      }],
      leads: [researchableLead()],
      suggestionReviewStates: [{ id: "suggestion:suggestion-1", campaignId: "campaign-1", leadId: "lead-1", state: "pending", occurredAt: NOW }],
    });

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));

    for (const reader of [
      store.listOutreachEvents,
      store.listTasks,
      store.listEmailLogs,
      store.listLeads,
      store.listSuggestionReviewStates,
      store.listDraftReviewStates,
      store.listDecisions,
    ]) expect(reader).toHaveBeenCalledWith("org-1", "campaign-1");
    const serialized = JSON.stringify(snapshot);
    expect(serialized).toContain("Safe subject");
    expect(serialized).toContain("Safe station");
    expect(serialized).not.toContain("PRIVATE BODY");
    expect(serialized).not.toContain("sender@example.com");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("PRIVATE ERROR");
    expect(serialized).not.toContain("PRIVATE PROVIDER DATA");
    expect(serialized).not.toContain("PRIVATE TOKEN");
    expect(snapshot.items.find((item) => item.source.recordId === "event-1")?.actor).toEqual({
      kind: "user",
      id: "user-1",
      label: "Safe operator",
    });
  });

  test("returns Campaign not found before reading activity for an unknown tenant-scoped campaign", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.findCampaign).mockResolvedValueOnce(false);

    await expect(getCampaignActivitySnapshot("org-1", "missing-campaign", deps(store)))
      .rejects.toMatchObject({ name: "HttpError", status: 404, message: "Campaign not found" });
    expect(store.findCampaign).toHaveBeenCalledWith("org-1", "missing-campaign");
    for (const reader of [
      store.listOutreachEvents,
      store.listTasks,
      store.listEmailLogs,
      store.listLeads,
      store.listSuggestionReviewStates,
      store.listDraftReviewStates,
      store.listDecisions,
    ]) expect(reader).not.toHaveBeenCalled();
  });

  test("sanitizes cross-campaign and mismatched lead/contact/draft references before normalization", async () => {
    const store = fakeActivityStore({
      outreachEvents: [
        { ...researchableEvent(), id: "event-valid", draftId: "draft-valid" },
        { ...researchableEvent(), id: "event-invalid", leadId: "lead-other", draftId: "draft-other", campaignId: "campaign-1" },
        { ...researchableEvent(), id: "event-unlinked-draft", leadId: null, draftId: "draft-malformed", campaignId: "campaign-1" },
      ],
      tasks: [{
        id: "task-invalid", campaignId: "campaign-1", leadId: "lead-other", contactId: "contact-other",
        taskName: "Cross campaign task", status: "todo", updatedAt: NOW,
      }],
      emailLogs: [{
        id: "email-invalid", campaignId: "campaign-1", leadId: "lead-other", contactId: "contact-other",
        subject: "Cross campaign email", status: "sent", sentAt: NOW,
      }],
      leads: [researchableLead()],
      suggestionReviewStates: [{ id: "suggestion:suggestion-other", campaignId: "campaign-2", leadId: "lead-other", state: "accepted", occurredAt: NOW }],
      draftReviewStates: [
        { id: "draft:draft-valid", campaignId: "campaign-1", leadId: "lead-1", state: "approved", occurredAt: NOW },
        { id: "draft:draft-other", campaignId: "campaign-2", leadId: "lead-other", state: "approved", occurredAt: NOW },
        { id: "draft:draft-malformed", campaignId: "campaign-1", leadId: "lead-other", state: "approved", occurredAt: NOW },
      ],
    });

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));
    const invalidEvent = snapshot.items.find((item) => item.source.recordId === "event-invalid");
    expect(invalidEvent?.refs).toMatchObject({ campaignId: "campaign-1", leadId: null, draftId: null });
    expect(snapshot.items.find((item) => item.source.recordId === "event-unlinked-draft")?.refs.draftId).toBeNull();
    expect(snapshot.items.find((item) => item.source.recordId === "task-invalid")?.refs)
      .toMatchObject({ leadId: null, contactId: null });
    expect(snapshot.items.find((item) => item.source.recordId === "email-invalid")?.refs)
      .toMatchObject({ leadId: null, contactId: null });
    expect(snapshot.items.some((item) => item.source.recordId === "draft:draft-other")).toBe(false);
    expect(snapshot.items.some((item) => item.source.recordId === "draft:draft-malformed")).toBe(false);
    expect(snapshot.items.some((item) => item.refs.leadId === "lead-other")).toBe(false);
    expect(snapshot.proposals.some((proposal) => proposal.leadId === "lead-other" || proposal.href.includes("lead-other"))).toBe(false);
  });

  test("names the exact unavailable source and keeps independent proposals", async () => {
    const store = fakeActivityStore({ outreachEvents: [researchContextEvent()], leads: [researchableLead()] });
    vi.mocked(store.listTasks).mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));

    expect(snapshot.items).toEqual([expect.objectContaining({ key: "event:event-context-1:lead_preparation_updated" })]);
    expect(snapshot.proposals).toEqual([expect.objectContaining({ ruleKey: "research-next" })]);
    expect(snapshot.sourceStates).toEqual([
      { source: "outreach_events", state: "complete", message: null },
      { source: "tasks", state: "unavailable", message: "Task activity is unavailable" },
      { source: "email_logs", state: "complete", message: null },
      { source: "lead_milestones", state: "complete", message: null },
      { source: "review_state", state: "complete", message: null },
    ]);
  });

  test("reports true zero-row sources as complete", async () => {
    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(fakeActivityStore()));

    expect(snapshot.items).toEqual([]);
    expect(snapshot.proposals).toEqual([]);
    expect(snapshot.sourceStates).toEqual([
      { source: "outreach_events", state: "complete", message: null },
      { source: "tasks", state: "complete", message: null },
      { source: "email_logs", state: "complete", message: null },
      { source: "lead_milestones", state: "complete", message: null },
      { source: "review_state", state: "complete", message: null },
    ]);
  });

  test("suppresses proposals that depend on an unavailable evidence source", async () => {
    const store = fakeActivityStore({ leads: [researchableLead()] });
    vi.mocked(store.listOutreachEvents).mockRejectedValueOnce(Object.assign(new Error("column does not exist"), { code: "42703" }));

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));

    expect(snapshot.proposals).toEqual([]);
    expect(snapshot.sourceStates).toContainEqual({
      source: "outreach_events",
      state: "unavailable",
      message: "Outreach event activity is unavailable",
    });
  });

  test("propagates an unknown source error", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.listTasks).mockRejectedValueOnce(new Error("connection lost"));

    await expect(getCampaignActivitySnapshot("org-1", "campaign-1", deps(store))).rejects.toThrow("connection lost");
  });

  test("does not treat a permission failure as schema unavailability", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.listEmailLogs).mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "42501" }));

    await expect(getCampaignActivitySnapshot("org-1", "campaign-1", deps(store))).rejects.toThrow("permission denied");
  });

  test("propagates a later unknown draft-review failure after recognized suggestion schema absence", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.listSuggestionReviewStates).mockRejectedValueOnce(Object.assign(new Error("relation missing"), { code: "42P01" }));
    vi.mocked(store.listDraftReviewStates).mockImplementationOnce(async () => {
      await Promise.resolve();
      throw new Error("draft review connection lost");
    });

    await expect(getCampaignActivitySnapshot("org-1", "campaign-1", deps(store))).rejects.toThrow("draft review connection lost");
  });

  test("propagates a later permission failure after recognized draft schema absence", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.listDraftReviewStates).mockRejectedValueOnce(Object.assign(new Error("column missing"), { code: "42703" }));
    vi.mocked(store.listSuggestionReviewStates).mockImplementationOnce(async () => {
      await Promise.resolve();
      throw Object.assign(new Error("suggestion review permission denied"), { code: "42501" });
    });

    await expect(getCampaignActivitySnapshot("org-1", "campaign-1", deps(store))).rejects.toThrow("suggestion review permission denied");
  });

  test("sanitizes review state when nested failures are only recognized schema absence", async () => {
    const store = fakeActivityStore();
    vi.mocked(store.listSuggestionReviewStates).mockRejectedValueOnce(Object.assign(new Error("private suggestion relation name"), { code: "42P01" }));
    vi.mocked(store.listDraftReviewStates).mockRejectedValueOnce(Object.assign(new Error("private draft column name"), { code: "42703" }));

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));

    expect(snapshot.sourceStates).toContainEqual({ source: "review_state", state: "unavailable", message: "Review state is unavailable" });
    expect(JSON.stringify(snapshot)).not.toContain("private suggestion relation name");
    expect(JSON.stringify(snapshot)).not.toContain("private draft column name");
  });

  test("re-derives a pending proposal before storing a tenant-scoped decision", async () => {
    const store = fakeActivityStore({ outreachEvents: [researchContextEvent()], leads: [researchableLead()] });
    const before = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));
    const proposal = before.proposals.find((item) => item.ruleKey === "research-next")!;

    const after = await decideCampaignActivityProposal(
      "org-1",
      "campaign-1",
      { proposal_key: proposal.key, decision: "dismissed", reason: "Already researched offline" },
      "user-1",
      deps(store),
    );

    expect(store.upsertDecision).toHaveBeenCalledWith(expect.objectContaining({
      id: "decision-1",
      org_id: "org-1",
      campaign_id: "campaign-1",
      proposal_key: proposal.key,
      rule_key: "research-next",
      rule_version: 1,
      lead_id: "lead-1",
      decision: "dismissed",
      reason: "Already researched offline",
      decided_by: "user-1",
      decided_at: NOW,
      updated_at: NOW,
    }));
    expect(after.proposals.find((item) => item.key === proposal.key)?.state).toBe("dismissed");
    expect(store.listLeads).toHaveBeenLastCalledWith("org-1", "campaign-1");
    expect(store.listDecisions).toHaveBeenLastCalledWith("org-1", "campaign-1");
  });

  test("refuses a stale proposal key without persisting a decision", async () => {
    const store = fakeActivityStore({ leads: [researchableLead()] });

    await expect(decideCampaignActivityProposal(
      "org-1",
      "campaign-1",
      { proposal_key: "campaign-1:lead-1:research-next:v0", decision: "resolved", reason: null },
      "user-1",
      deps(store),
    )).rejects.toMatchObject({ name: "ConflictError", message: "Activity proposal is stale or unavailable" });
    expect(store.upsertDecision).not.toHaveBeenCalled();
  });

  test("uses an idempotent upsert for an existing proposal decision", async () => {
    const store = fakeActivityStore({ outreachEvents: [researchContextEvent()], leads: [researchableLead()] });
    const before = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store));
    const proposal = before.proposals[0];

    await decideCampaignActivityProposal(
      "org-1", "campaign-1",
      { proposal_key: proposal.key, decision: "dismissed", reason: "Handled elsewhere" },
      "user-1", deps(store),
    );
    const after = await decideCampaignActivityProposal(
      "org-1", "campaign-1",
      { proposal_key: proposal.key, decision: "resolved", reason: "Now complete" },
      "user-2", deps(store),
    );

    expect(store.upsertDecision).toHaveBeenCalledTimes(2);
    expect(after.proposals).toEqual([expect.objectContaining({ key: proposal.key, state: "resolved" })]);
  });

  test("uses bounded source reads and marks truncated source inputs partial", async () => {
    const store = fakeActivityStore({
      outreachEvents: [researchableEvent(), { ...researchableEvent(), id: "event-2" }, { ...researchableEvent(), id: "event-3" }],
    });

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store), { sourceLimit: 2 });

    expect(store.listOutreachEvents).toHaveBeenCalledWith("org-1", "campaign-1", { limit: 2 });
    expect(store.listTasks).toHaveBeenCalledWith("org-1", "campaign-1", { limit: 2 });
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.sourceStates).toContainEqual({
      source: "outreach_events", state: "partial", message: "Limited to 2 recent source records",
    });
  });

  test("uses bounded tenant-scoped support lookups to preserve selected valid links and clear foreign links", async () => {
    const store = fakeActivityStore({
      outreachEvents: [
        { ...researchableEvent(), id: "event-valid", leadId: "lead-older", draftId: "draft-older" },
        { ...researchableEvent(), id: "event-foreign", leadId: "lead-foreign", draftId: "draft-foreign" },
      ],
      leads: [
        { ...researchableLead(), id: "lead-recent-1" },
        { ...researchableLead(), id: "lead-recent-2" },
        { ...researchableLead(), id: "lead-older", contactId: "contact-older" },
      ],
      draftReviewStates: [
        { id: "draft:draft-recent-1", campaignId: "campaign-1", leadId: "lead-recent-1", state: "draft", occurredAt: NOW },
        { id: "draft:draft-recent-2", campaignId: "campaign-1", leadId: "lead-recent-2", state: "draft", occurredAt: NOW },
        { id: "draft:draft-older", campaignId: "campaign-1", leadId: "lead-older", state: "approved", occurredAt: NOW },
      ],
    });
    const findLeadsByIds = vi.fn().mockResolvedValue([{ ...researchableLead(), id: "lead-older", contactId: "contact-older" }]);
    const findDraftReviewStatesByIds = vi.fn().mockResolvedValue([
      { id: "draft:draft-older", campaignId: "campaign-1", leadId: "lead-older", state: "approved", occurredAt: NOW },
    ]);
    Object.assign(store, { findLeadsByIds, findDraftReviewStatesByIds });

    const snapshot = await getCampaignActivitySnapshot("org-1", "campaign-1", deps(store), { sourceLimit: 2 });

    expect(findLeadsByIds).toHaveBeenCalledWith("org-1", "campaign-1", ["lead-older", "lead-foreign"]);
    expect(findDraftReviewStatesByIds).toHaveBeenCalledWith("org-1", "campaign-1", ["draft-older", "draft-foreign"]);
    expect(snapshot.items.find((item) => item.source.recordId === "event-valid")?.refs)
      .toMatchObject({ leadId: "lead-older", draftId: "draft-older" });
    expect(snapshot.items.find((item) => item.source.recordId === "event-foreign")?.refs)
      .toMatchObject({ leadId: null, draftId: null });
    expect(snapshot.items.some((item) => item.source.recordId === "lead-older")).toBe(false);
    expect(snapshot.items.some((item) => item.source.recordId === "draft:draft-older")).toBe(false);
  });
});
