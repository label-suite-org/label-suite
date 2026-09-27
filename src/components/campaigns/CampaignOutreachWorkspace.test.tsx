/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import CampaignOutreachWorkspace from "./CampaignOutreachWorkspace";

const data = {
      campaign: { id: "campaign-1", name: "Fountain Edits — Zero-Budget Earned Media Sprint", linked_release_id: "release-1" },
      prompt: null,
      queue: { now: [], followUp: [], waiting: [], completed: [] },
      leads: [{
        id: "lead-1",
        campaign_id: "campaign-1",
        source_id: "source-1",
        source_title: "Friend-recommended YouTube channels",
        contact_id: null,
        contact_name: null,
        station_id: null,
        station_name: null,
        exact_edit_track_id: "track-1",
        exact_edit_title: "Fountain - DJ Python Remix",
        dedupe_key: "url:https://youtube.com/@someuncertainsir",
        target_name: "Some Uncertain Sir",
        target_type: "youtube_channel",
        target_url: "https://www.youtube.com/@someuncertainsir",
        contact_route: "Ask for a friend introduction first",
        contact_route_verified_at: null,
        discovery_source: "Friend recommendation",
        recommending_person: null,
        introduction_available: null,
        musical_fit: "Underground electronic premieres",
        relationship_warmth: 3,
        editorial_fit: 3,
        useful_reach: 1,
        direct_free_access: 2,
        pipeline_stage: "ready",
        pitch_angle: "Offer a specific full-quality upload.",
        last_contacted_at: null,
        follow_up_at: null,
        outcome: null,
        evidence_url: null,
        published_at: null,
        notes: null,
        readiness_task_waiver_reason: null,
        updated_at: null,
        priority_score: 9,
        tasks: [{ id: "task-1", linked_campaign_lead_id: "lead-1", task_name: "Review pitch", status: "todo", priority: "P1", due_date: "2026-08-06", next_action: "Confirm the introduction and approve copy" }],
        latest_suggestions: [],
        draft_versions: [],
        ready_blockers: [],
        activity: [],
      }],
      sources: [{
        id: "source-1", org_id: "true-nature", campaign_id: "campaign-1", source_key: "audience", source_type: "audience_export",
        title: "True Blue - Audience Contacts", url: null, external_id: null,
        authorization_note: "Do not use this audience export as earned-media outreach authorization.", notes: "No rows are imported.", created_at: null, updated_at: null,
      }],
      activity: {
        items: [],
        proposals: [],
        sourceStates: [],
      },
      dogfood: [{
        id: "dogfood-1", org_id: "true-nature", campaign_id: "campaign-1", entry_type: "missing_field", severity: "P1",
        title: "No exact edit per target", details: "A multi-edit release needs a lead-level track selection.", ui_surface: "Campaign → Outreach",
        status: "in_progress", evidence_url: null, linked_lead_id: null, linked_draft_id: null,
        linked_enrichment_run_id: null, created_at: null, updated_at: null,
        linked_page_revision_id: null,
      }],
      tracks: [{ id: "track-1", title: "Fountain - DJ Python Remix", audio_url: "https://example.com/audio", position: 2 }],
      radioUpdate: { page: { page: null, draft: null, revisions: [] }, artwork_options: [], tracks: [], radio_drafts: [] },
      unlinked_tasks: [],
} as CampaignOutreachWorkspaceData;

describe("CampaignOutreachWorkspace", () => {
  test("keeps server-rendered controls disabled until hydration attaches their handlers", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const view = <CampaignOutreachWorkspace initialData={data} canMutate />;
    host.innerHTML = renderToString(view);
    expect(host.querySelector('button[role="tab"]')?.matches(":disabled")).toBe(true);
    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => { root = hydrateRoot(host, view); });
    expect(host.querySelector('button[role="tab"]')?.matches(":disabled")).toBe(false);
    await act(async () => { root!.unmount(); });
    host.remove();
  });
  test("renders the focused operator flow, actionable lead context and source boundary without a send action", () => {

    const html = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={data} canMutate={false} />);

    expect(html).toContain("Focused outreach");
    expect(html).toContain("Review facts");
    expect(html).toContain("Some Uncertain Sir");
    expect(html).toContain("Fountain - DJ Python Remix");
    expect(html).toContain("Do not use this audience export as earned-media outreach authorization");
    expect(html).toContain("Record an external manual send");
    expect(html).toContain("Outreach body");
    expect(html).toContain("Up to 10,000 characters");
    expect(html).not.toMatch(/>Send</);
  });

  test("renders the shared Activity lane after the workbench and honors a valid initial lead query", () => {
    const leadTwo = { ...data.leads[0], id: "lead-2", target_name: "Second lead", priority_score: 1, tasks: [], source_id: "source-1" };
    const activityItem = {
      key: "event:activity-1:research_completed",
      category: "research" as const,
      kind: "research_completed",
      occurredAt: new Date("2026-08-08T10:00:00.000Z"),
      title: "Research completed",
      summary: null,
      actor: { kind: "system" as const, id: null, label: null },
      refs: { campaignId: "campaign-1", leadId: "lead-2", contactId: null, taskId: null, draftId: null },
      evidence: [],
      source: { kind: "event", recordId: "activity-1" },
    };
    const initialData = {
      ...data,
      queue: { now: [leadTwo], followUp: [], waiting: [], completed: [] },
      leads: [data.leads[0], leadTwo],
      activity: { items: [activityItem], proposals: [], sourceStates: [] },
    } as CampaignOutreachWorkspaceData;

    const html = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={initialData} initialLeadId="lead-2" canMutate={false} />);

    expect(html).toContain("Second lead");
    expect(html).toContain("Activity");
    expect(html.indexOf('aria-label="Focused lead workbench"')).toBeLessThan(html.indexOf('aria-label="Campaign activity"'));
    expect(html).toContain("Research completed");
  });

  test("renders campaign-level Activity when no focused lead exists", () => {
    const initialData = {
      ...data,
      leads: [],
      queue: { now: [], followUp: [], waiting: [], completed: [] },
      activity: {
        items: [],
        proposals: [],
        sourceStates: [{ source: "email_logs" as const, state: "unavailable" as const, message: "Email logs unavailable" }],
      },
    } as CampaignOutreachWorkspaceData;

    const html = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={initialData} canMutate={false} />);

    expect(html).toContain("No focused outreach leads yet.");
    expect(html).toContain('aria-label="Campaign activity"');
    expect(html).toContain("Partial activity");
    expect(html).toContain("Email logs");
  });

  test("replaces a proposal snapshot from the decision PATCH", async () => {
    const proposal = {
      key: "campaign-1:lead-1:research-next:v1",
      ruleKey: "research-next" as const,
      ruleVersion: 1 as const,
      actionType: "start_research" as const,
      leadId: "lead-1",
      taskId: null,
      state: "pending" as const,
      title: "Start lead research",
      summary: "Research is next.",
      href: "/campaigns/campaign-1?tab=outreach&lead=lead-1#lead-research",
      evidenceKeys: [],
    };
    const initialData = {
      ...data,
      activity: { items: [], proposals: [proposal], sourceStates: [] },
    } as CampaignOutreachWorkspaceData;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const patched = { items: [], proposals: [], sourceStates: [] };
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "PATCH") return new Response(JSON.stringify(patched), { headers: { "content-type": "application/json" } });
      throw new Error("refresh unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={initialData} canMutate />));

    const decision = [...host.querySelectorAll("button")].find((button) => button.textContent === "Dismiss recommendation") as HTMLButtonElement;
    await act(async () => {
      decision.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/campaign-1/activity", expect.objectContaining({ method: "PATCH" }));
    expect(host.textContent).not.toContain("Start lead research");

    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  test("shows a base-context refresh failure after a successful stage mutation", async () => {
    const initialData = { ...data, activity: { items: [], proposals: [], sourceStates: [] } } as CampaignOutreachWorkspaceData;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-leads/lead-1/stage-override") return new Response(JSON.stringify({ pipeline_stage: "qualified" }), { headers: { "content-type": "application/json" } });
      if (url === "/api/campaigns/campaign-1/communicator-prompt") throw new Error("base refresh unavailable");
      if (url === "/api/campaigns/campaign-1/activity" && init?.method === "GET") return new Response(JSON.stringify({ items: [], proposals: [], sourceStates: [] }), { headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={initialData} canMutate />));

    const override = [...host.querySelectorAll("button")].find((button) => button.textContent === "Override stage") as HTMLButtonElement;
    await act(async () => override.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const stage = host.querySelector('select[aria-label="Override stage to"]') as HTMLSelectElement;
    const reason = host.querySelector('textarea[placeholder="Reason (at least 10 characters)"]') as HTMLTextAreaElement;
    setInput(stage, "qualified");
    setInput(reason, "The relationship is qualified for a direct follow-up.");
    const apply = [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply override") as HTMLButtonElement;
    await act(async () => apply.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-leads/lead-1/stage-override", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/campaign-1/activity", expect.objectContaining({ method: "GET" }));
    expect(host.textContent).toContain("Lead context could not be refreshed");
    expect(host.textContent).not.toContain("Could not override the stage");

    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  test("retains the previous Activity snapshot when a 200 refresh payload is malformed", async () => {
    const activityItem = {
      key: "event:old:research_completed",
      category: "research" as const,
      kind: "research_completed",
      occurredAt: new Date("2026-08-01T10:00:00.000Z"),
      title: "Previous Activity snapshot",
      summary: null,
      actor: { kind: "system" as const, id: null, label: null },
      refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: null, draftId: null },
      evidence: [],
      source: { kind: "event", recordId: "old" },
    };
    const initialData = { ...data, activity: { items: [activityItem], proposals: [], sourceStates: [] } } as CampaignOutreachWorkspaceData;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-leads/lead-1/stage-override") return new Response(JSON.stringify({ pipeline_stage: "qualified" }), { headers: { "content-type": "application/json" } });
      if (url === "/api/campaigns/campaign-1/communicator-prompt") return new Response(JSON.stringify({ prompt: null, leads: { "lead-1": { suggestions: [], draft_versions: [], ready_blockers: [], activity: [] } } }), { headers: { "content-type": "application/json" } });
      if (url === "/api/campaigns/campaign-1/activity" && init?.method === "GET") return new Response(JSON.stringify({ items: [null], proposals: [], sourceStates: [] }), { headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={initialData} canMutate />));
    const override = [...host.querySelectorAll("button")].find((button) => button.textContent === "Override stage") as HTMLButtonElement;
    await act(async () => override.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    setInput(host.querySelector('select[aria-label="Override stage to"]') as HTMLSelectElement, "qualified");
    setInput(host.querySelector('textarea[placeholder="Reason (at least 10 characters)"]') as HTMLTextAreaElement, "The relationship is qualified for a direct follow-up.");
    const apply = [...host.querySelectorAll("button")].find((button) => button.textContent === "Apply override") as HTMLButtonElement;
    await act(async () => apply.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(host.textContent).toContain("Previous Activity snapshot");
    expect(host.textContent).toContain("Activity could not be refreshed");

    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  test("hands research to Codex MCP without a provider mutation or Activity refresh", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={structuredClone(data)} canMutate />));

    expect([...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === "Run research")).toBeUndefined();
    expect(host.textContent).toContain("Work this lead in Codex MCP");
    expect(host.textContent).toContain("Pending proposals return here for Accept or Reject");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/enrichment-runs"), expect.anything());

    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  test.each(mutationCases)("$name issues Activity GET after the original mutation", async ({ configure, perform, mutationUrl, mutationMethod, mutationResponse }) => {
    const initialData = structuredClone(data) as CampaignOutreachWorkspaceData;
    configure(initialData);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === mutationUrl && init?.method === mutationMethod) return new Response(JSON.stringify(mutationResponse), { headers: { "content-type": "application/json" } });
      if (url === "/api/campaigns/campaign-1/communicator-prompt") return new Response(JSON.stringify(contextResponse(initialData)), { headers: { "content-type": "application/json" } });
      if (url === "/api/campaigns/campaign-1/activity" && init?.method === "GET") return new Response(JSON.stringify({ items: [], proposals: [], sourceStates: [] }), { headers: { "content-type": "application/json" } });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => root.render(<CampaignOutreachWorkspace initialData={initialData} canMutate />));
    await perform(host);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledWith(mutationUrl, expect.objectContaining({ method: mutationMethod }));
    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/campaign-1/activity", expect.objectContaining({ method: "GET" }));

    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });
});

const draftForMutation = (status: "draft" | "approved") => ({
  id: "draft-1", org_id: "true-nature", campaign_id: "campaign-1", lead_id: "lead-1", enrichment_run_id: null, scope: "focused_outreach",
  version: 1, status, subject: "Subject", body: "Draft body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Draft body" }] }] },
  approval_hash: status === "approved" ? "hash-1" : null, approved_by: status === "approved" ? "operator-1" : null, approved_at: status === "approved" ? new Date("2026-08-08T10:00:00.000Z") : null,
  created_at: new Date("2026-08-08T10:00:00.000Z"), updated_at: new Date("2026-08-08T10:00:00.000Z"),
});

const mutationCases = [
  {
    name: "suggestion review",
    mutationUrl: "/api/campaign-enrichment-suggestions/suggestion-1",
    mutationMethod: "PATCH",
    mutationResponse: { id: "suggestion-1", decision: "accepted" },
    configure: (fixture: CampaignOutreachWorkspaceData) => {
      fixture.leads[0]!.updated_at = new Date("2026-08-08T10:00:00.000Z");
      fixture.leads[0]!.latest_suggestions = [{ id: "suggestion-1", org_id: "true-nature", campaign_id: "campaign-1", lead_id: "lead-1", enrichment_run_id: "run-1", suggestion_type: "contact_route", suggested_value: { value: "Email", rationale: "Listed" }, evidence: [], status: "pending", resolved_by: null, resolved_at: null, created_at: new Date("2026-08-08T10:00:00.000Z"), updated_at: new Date("2026-08-08T10:00:00.000Z") }];
    },
    perform: async (host: HTMLElement) => clickButton(host, "Accept fact"),
  },
  {
    name: "draft generation",
    mutationUrl: "/api/campaign-leads/lead-1/drafts",
    mutationMethod: "POST",
    mutationResponse: { id: "draft-1" },
    configure: (_data: CampaignOutreachWorkspaceData) => undefined,
    perform: async (host: HTMLElement) => clickButton(host, "Create saved first draft"),
  },
  {
    name: "draft save",
    mutationUrl: "/api/campaign-outreach-drafts/draft-1",
    mutationMethod: "PATCH",
    mutationResponse: { id: "draft-1", version: 2 },
    configure: (fixture: CampaignOutreachWorkspaceData) => { fixture.leads[0]!.draft_versions = [draftForMutation("draft") as never]; },
    perform: async (host: HTMLElement) => clickButton(host, "Save as new draft"),
  },
  {
    name: "draft approval",
    mutationUrl: "/api/campaign-outreach-drafts/draft-1/approve",
    mutationMethod: "POST",
    mutationResponse: { pipeline_stage: "ready" },
    configure: (fixture: CampaignOutreachWorkspaceData) => { fixture.leads[0]!.draft_versions = [draftForMutation("draft") as never]; },
    perform: async (host: HTMLElement) => clickButton(host, "Approve draft"),
  },
  {
    name: "preparation",
    mutationUrl: "/api/campaign-leads/lead-1/preparation",
    mutationMethod: "PATCH",
    mutationResponse: { contact_route_verified_at: new Date("2026-08-08T10:00:00.000Z"), readiness_task_waiver_reason: null },
    configure: (_data: CampaignOutreachWorkspaceData) => undefined,
    perform: async (host: HTMLElement) => clickButton(host, "Verify current route"),
  },
  {
    name: "stage override",
    mutationUrl: "/api/campaign-leads/lead-1/stage-override",
    mutationMethod: "POST",
    mutationResponse: { pipeline_stage: "qualified" },
    configure: (_data: CampaignOutreachWorkspaceData) => undefined,
    perform: async (host: HTMLElement) => {
      await clickButton(host, "Override stage");
      setInput(host.querySelector('select[aria-label="Override stage to"]') as HTMLSelectElement, "qualified");
      setInput(host.querySelector('textarea[placeholder="Reason (at least 10 characters)"]') as HTMLTextAreaElement, "The relationship is qualified for a direct follow-up.");
      await clickButton(host, "Apply override");
    },
  },
  {
    name: "manual send recording",
    mutationUrl: "/api/campaign-leads/lead-1/record-sent",
    mutationMethod: "POST",
    mutationResponse: { pipeline_stage: "sent", last_contacted_at: new Date("2026-08-08T10:00:00.000Z"), follow_up_at: null },
    configure: (fixture: CampaignOutreachWorkspaceData) => { fixture.leads[0]!.draft_versions = [draftForMutation("approved") as never]; fixture.leads[0]!.ready_blockers = []; },
    perform: async (host: HTMLElement) => {
      setInput(host.querySelector('input[aria-label="Sent at"]') as HTMLInputElement, "2026-08-08T10:00");
      await clickButton(host, "Record sent");
    },
  },
] as const;

async function clickButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label) as HTMLButtonElement;
  await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
}

function contextResponse(fixture: CampaignOutreachWorkspaceData) {
  const lead = fixture.leads[0]!;
  return { prompt: fixture.prompt, leads: { [lead.id]: { suggestions: lead.latest_suggestions, draft_versions: lead.draft_versions, ready_blockers: lead.ready_blockers, activity: [] } } };
}

function setInput(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
