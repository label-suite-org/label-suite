/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CampaignOutreachWorkspaceData } from "../../server/campaign-outreach";
import type { CampaignDocument } from "../../lib/campaign-rich-text";
import CampaignOutreachWorkspace from "./CampaignOutreachWorkspace";

export const focusedWorkbenchData = {
  campaign: {
    id: "campaign-1",
    name: "Fountain Edits — Zero-Budget Earned Media Sprint",
    linked_release_id: "release-1",
  },
  prompt: {
    id: "prompt-1",
    org_id: "true-nature",
    campaign_id: "campaign-1",
    version: 2,
    prompt: "Write directly and keep the ask specific.",
    created_by: "operator-1",
    created_at: new Date("2026-08-04T10:00:00.000Z"),
    updated_at: new Date("2026-08-04T10:00:00.000Z"),
  },
  queue: { now: [], followUp: [], waiting: [], completed: [] },
  activity: { items: [], proposals: [], sourceStates: [] },
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
    contact_route: "Instagram DM",
    contact_route_verified_at: null,
    discovery_source: "Friend recommendation",
    recommending_person: "Trusted friend",
    introduction_available: null,
    musical_fit: "Underground electronic premieres",
    relationship_warmth: 3,
    editorial_fit: 3,
    useful_reach: 1,
    direct_free_access: 2,
    pipeline_stage: "qualified",
    pitch_angle: "Offer a specific full-quality upload.",
    last_contacted_at: null,
    follow_up_at: null,
    outcome: null,
    evidence_url: null,
    published_at: null,
    notes: null,
    readiness_task_waiver_reason: null,
    updated_at: new Date("2026-08-04T12:00:00.000Z"),
    priority_score: 9,
    tasks: [],
    latest_suggestions: [{
      id: "suggestion-1",
      org_id: "true-nature",
      campaign_id: "campaign-1",
      lead_id: "lead-1",
      enrichment_run_id: "run-1",
      source_kind: "codex_mcp",
      provenance: {
        submitting_operator: { id: "operator-1", name: "Release Gate Operator" },
        created_at: new Date("2026-08-04T11:00:00.000Z"),
        lead_revision: "a".repeat(64),
      },
      suggestion_type: "contact_route",
      suggested_value: { value: "Public channel email", rationale: "Listed on the current show page." },
      evidence: [{
        title: "Current show page",
        url: "https://example.org/show",
        retrieved_at: "2026-08-04T11:00:00.000Z",
        citation_text: "Contact details are listed on the show page.",
      }],
      status: "pending",
      resolved_by: null,
      resolved_at: null,
      created_at: new Date("2026-08-04T11:00:00.000Z"),
      updated_at: new Date("2026-08-04T11:00:00.000Z"),
    }],
    draft_versions: [],
    ready_blockers: ["contact_route_verified_at", "introduction_state", "approved_draft", "task_or_reason"],
    activity: [],
  }],
  sources: [{
    id: "source-1",
    org_id: "true-nature",
    campaign_id: "campaign-1",
    source_key: "friend-list",
    source_type: "direct_research",
    title: "Friend-recommended YouTube channels",
    url: "https://example.org/list",
    external_id: null,
    authorization_note: "Research provenance only; outreach still requires review.",
    notes: null,
    created_at: null,
    updated_at: null,
  }],
  dogfood: [],
  tracks: [{ id: "track-1", title: "Fountain - DJ Python Remix", audio_url: "https://example.org/audio", position: 1 }],
  radioUpdate: { page: { page: null, draft: null, revisions: [] }, artwork_options: [], tracks: [], radio_drafts: [] },
  unlinked_tasks: [],
} as CampaignOutreachWorkspaceData;

focusedWorkbenchData.queue.now = focusedWorkbenchData.leads;

describe("focused lead workbench", () => {
  it("renders one evidence-led five-step operator flow without a send action", () => {
    const html = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={focusedWorkbenchData} canMutate={false} />);

    expect(html).toContain("grid-cols-[220px_minmax(0,1fr)_280px]");
    expect(html).toContain('<section aria-label="Focused lead workbench"');
    expect(html).not.toContain('<main class="min-w-0 px-0 lg:px-6">');
    expect(html).toContain("text-[11px] text-foreground");
    expect(html).toContain("Some Uncertain Sir");
    expect(html).toContain("Now");
    expect(html).toContain("Research");
    expect(html).toContain("Review facts");
    expect(html).toContain("Draft");
    expect(html).toContain("Approve");
    expect(html).toContain("Record sent");
    expect(html).toContain("Pending and rejected facts are excluded from drafts.");
    expect(html).toContain("Verify contact route");
    expect(html).toContain('href="https://example.org/show"');
    expect(html).toContain("Submitted through Codex MCP");
    expect(html).not.toMatch(/>Send</);
  });

  it("renders authoritative Codex provenance without relabeling in-app provider suggestions", () => {
    const codexHtml = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={focusedWorkbenchData} canMutate={false} />);
    expect(codexHtml).toContain("Submitted through Codex MCP");
    expect(codexHtml).toContain("Submitted by Release Gate Operator");
    expect(codexHtml).toContain("Created 4 Aug 2026");
    expect(codexHtml).toContain("Lead revision");
    expect(codexHtml).toContain("a".repeat(64));
    expect(codexHtml).toContain("Proposed value");
    expect(codexHtml).toContain("Public channel email");
    expect(codexHtml).toContain("Rationale");
    expect(codexHtml).toContain("Listed on the current show page.");
    expect(codexHtml).toContain("Source: Current show page");
    expect(codexHtml).toContain("retrieved");
    expect(codexHtml).toContain("4 Aug 2026");

    const inAppProvider = structuredClone(focusedWorkbenchData);
    inAppProvider.leads[0]!.latest_suggestions[0]!.source_kind = "in_app_provider";
    delete inAppProvider.leads[0]!.latest_suggestions[0]!.provenance;
    const providerHtml = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={inAppProvider} canMutate={false} />);
    expect(providerHtml).not.toContain("Submitted through Codex MCP");
    expect(providerHtml).not.toContain("Submitted by Release Gate Operator");
    expect(providerHtml).toContain("Public channel email");
  });

  it("marks unavailable Codex run provenance honestly without fabricating an operator or revision", () => {
    const unavailable = structuredClone(focusedWorkbenchData);
    unavailable.leads[0]!.latest_suggestions[0]!.provenance = {
      submitting_operator: null,
      created_at: null,
      lead_revision: null,
    };

    const html = renderToStaticMarkup(<CampaignOutreachWorkspace initialData={unavailable} canMutate={false} />);

    expect(html).toContain("Submitting operator unavailable");
    expect(html).toContain("Lead revision unavailable");
    expect(html).not.toContain("unknown operator");
    expect(html).not.toContain("0000000000000000000000000000000000000000000000000000000000000000");
  });

  it("saves an edited campaign voice prompt only on the explicit action", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      ...focusedWorkbenchData.prompt,
      version: 3,
      prompt: "Keep it warm and make one direct ask.",
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<CampaignOutreachWorkspace initialData={structuredClone(focusedWorkbenchData)} canMutate />));
    const textarea = Array.from(container.querySelectorAll("textarea")).find((element) => element.parentElement?.textContent?.includes("Campaign voice prompt"));
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    await act(async () => setValue(textarea as HTMLTextAreaElement, "Keep it warm and make one direct ask."));
    expect(fetchMock).not.toHaveBeenCalled();

    const save = buttonNamed(container, "Save prompt");
    await act(async () => {
      save?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/campaigns/campaign-1/communicator-prompt", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ prompt: "Keep it warm and make one direct ask." }),
    }));

    await act(async () => root.unmount());
    container.remove();
  });

  it("accepts one cited suggestion with stale-state identity and refreshes only the active lead context", async () => {
    const { container, root } = await renderWorkbench();
    const accepted = {
      ...focusedWorkbenchData.leads[0]!.latest_suggestions[0]!,
      status: "accepted" as const,
      resolved_by: "operator-1",
      resolved_at: new Date("2026-08-04T12:30:00.000Z"),
      updated_at: new Date("2026-08-04T12:30:00.000Z"),
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-enrichment-suggestions/suggestion-1") {
        return jsonResponse({ id: "suggestion-1", status: "accepted" });
      }
      if (url === "/api/campaigns/campaign-1/communicator-prompt") {
        return jsonResponse({
          prompt: focusedWorkbenchData.prompt,
          leads: { "lead-1": { suggestions: [accepted], draft_versions: [], ready_blockers: ["contact_route_verified_at"], activity: [] } },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      buttonNamed(container, "Accept fact")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/campaign-enrichment-suggestions/suggestion-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ decision: "accepted", expected_lead_updated_at: "2026-08-04T12:00:00.000Z" }),
    }));
    expect(container.textContent).toContain("accepted");
    expect(buttonNamed(container, "Accept fact")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("hands focused lead research to Codex MCP without provider dispatch or editor mutation", async () => {
    const { container, root } = await renderWorkbench();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const prompt = Array.from(container.querySelectorAll("textarea")).find((element) => element.parentElement?.textContent?.includes("Campaign voice prompt")) as HTMLTextAreaElement;
    await act(async () => setValue(prompt, "Unsaved operator voice stays here."));

    expect(buttonNamed(container, "Run research")).toBeNull();
    expect(container.textContent).toContain("Work this lead in Codex MCP");
    expect(container.textContent).toContain("lead-1");
    expect(container.textContent).toContain("get_enrichment_item");
    expect(container.textContent).toContain("Pending proposals return here for Accept or Reject");
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/enrichment-runs"), expect.anything());
    expect(prompt.value).toBe("Unsaved operator voice stays here.");

    await act(async () => root.unmount());
    container.remove();
  });

  it("restores an earlier version into unsaved editor state before creating a new draft", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const earlier = draftVersion("draft-1", 1, "Earlier subject", "Earlier body", "superseded");
    const approved = draftVersion("draft-2", 2, "Approved subject", "Approved body", "approved");
    data.leads[0]!.draft_versions = [approved, earlier];
    data.leads[0]!.pipeline_stage = "ready";
    data.leads[0]!.ready_blockers = [];
    const { container, root } = await renderWorkbench(data);
    const restored = { ...draftVersion("draft-3", 3, earlier.subject!, earlier.body, "draft"), body_document: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: "Earlier body" }] }] } };
    const reapproved = { ...restored, status: "approved" as const, approval_hash: "hash-3" };
    let contextRead = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-outreach-drafts/draft-2") return jsonResponse(restored, 201);
      if (url === "/api/campaign-outreach-drafts/draft-3/approve") return jsonResponse({ id: "draft-3", approval_hash: "hash-3", pipeline_stage: "ready" });
      if (url === "/api/campaigns/campaign-1/communicator-prompt") {
        contextRead += 1;
        return jsonResponse({
          prompt: data.prompt,
          leads: {
            "lead-1": {
              suggestions: data.leads[0]!.latest_suggestions,
              draft_versions: contextRead === 1 ? [restored, { ...approved, status: "superseded" }, earlier] : [reapproved, { ...approved, status: "superseded" }, earlier],
              ready_blockers: contextRead === 1 ? ["approved_draft"] : [],
              activity: [],
            },
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const restoredFlowSentAt = container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement;
    await act(async () => setValue(restoredFlowSentAt, "2026-08-05T15:30"));
    expect((buttonNamed(container, "Record sent") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => buttonNamed(container, "Restore version 1 as new draft")?.click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect([...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Subject"))?.querySelector("input")?.value).toBe("Earlier subject");
    expect(container.querySelector('[role="textbox"][aria-label="Outreach body"]')?.textContent).toContain("Earlier body");
    expect(container.textContent).toContain("Unsaved outreach changes");
    expect((buttonNamed(container, "Approve draft") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      buttonNamed(container, "Save as new draft")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/campaign-outreach-drafts/draft-2", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ subject: "Earlier subject", body: "Earlier body", body_document: restored.body_document }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/campaigns/campaign-1/activity", expect.objectContaining({ method: "GET" }));
    expect(container.textContent).toContain("Version 3 · draft");
    expect((buttonNamed(container, "Record sent") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      buttonNamed(container, "Approve draft")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-outreach-drafts/draft-3/approve", expect.objectContaining({ method: "POST", body: "{}" }));
    expect((buttonNamed(container, "Record sent") as HTMLButtonElement).disabled).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("restores an over-limit historical version into explicit readable repair state without throwing", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const current = draftVersion("draft-2", 2, "Current subject", "Current body", "draft");
    const overLimitBody = "x".repeat(10_001);
    const earlier = { ...draftVersion("draft-1", 1, "Historical subject", overLimitBody, "superseded"), body_document: { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: overLimitBody }] }] }, body_document_repair_required: true, body_document_repair_reason: "over_limit" as const };
    data.leads[0]!.draft_versions = [current, earlier];
    const { container, root } = await renderWorkbench(data);

    await act(async () => buttonNamed(container, "Restore version 1 as new draft")?.click());

    expect(container.textContent).toContain("exceeds the 10,000-character authoring limit");
    expect(container.textContent).toContain(overLimitBody);
    expect((buttonNamed(container, "Save as new draft") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => buttonNamed(container, "Repair and edit draft")?.click());
    expect((buttonNamed(container, "Save as new draft") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount()); container.remove();
  });

  it("verifies the current contact route and saves a reasoned task waiver through preparation", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const { container, root } = await renderWorkbench(data);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-leads/lead-1/preparation") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return jsonResponse({
          id: "lead-1",
          contact_route: data.leads[0]!.contact_route,
          contact_route_verified_at: body.contact_route_verified ? "2026-08-04T14:00:00.000Z" : null,
          readiness_task_waiver_reason: body.readiness_task_waiver_reason ?? null,
        });
      }
      if (url === "/api/campaigns/campaign-1/communicator-prompt") {
        return jsonResponse({
          prompt: data.prompt,
          leads: {
            "lead-1": {
              suggestions: data.leads[0]!.latest_suggestions,
              draft_versions: [],
              ready_blockers: ["approved_draft"],
              activity: [{ occurred_at: "2026-08-04T14:00:00.000Z" }],
            },
          },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      buttonNamed(container, "Verify current route")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-leads/lead-1/preparation", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ campaign_id: "campaign-1", contact_route_verified: true }),
    }));

    const waiver = container.querySelector('textarea[placeholder="Why no linked task is needed"]') as HTMLTextAreaElement;
    await act(async () => setValue(waiver, "Operator is handling approval in the linked release review."));
    await act(async () => {
      buttonNamed(container, "Save no-task reason")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-leads/lead-1/preparation", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ campaign_id: "campaign-1", readiness_task_waiver_reason: "Operator is handling approval in the linked release review." }),
    }));

    await act(async () => root.unmount());
    container.remove();
  });

  it("requires and records a reason when an operator overrides the stage from the inspector", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const { container, root } = await renderWorkbench(data);
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-leads/lead-1/stage-override") return jsonResponse({ event_type: "stage_overridden", pipeline_stage: "nurture" });
      if (url === "/api/campaigns/campaign-1/communicator-prompt") return jsonResponse({
        prompt: data.prompt,
        leads: { "lead-1": { suggestions: data.leads[0]!.latest_suggestions, draft_versions: [], ready_blockers: data.leads[0]!.ready_blockers, activity: [] } },
      });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => buttonNamed(container, "Override stage")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const stage = container.querySelector('select[aria-label="Override stage to"]') as HTMLSelectElement;
    const reason = container.querySelector('textarea[placeholder="Reason (at least 10 characters)"]') as HTMLTextAreaElement;
    await act(async () => {
      setValue(stage, "nurture");
      setValue(reason, "Relationship is warm, but there is no timely editorial fit.");
    });
    expect((buttonNamed(container, "Apply override") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      buttonNamed(container, "Apply override")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-leads/lead-1/stage-override", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ campaign_id: "campaign-1", pipeline_stage: "nurture", reason: "Relationship is warm, but there is no timely editorial fit." }),
    }));
    expect(container.textContent).toContain("Focused outreach · nurture");

    await act(async () => root.unmount());
    container.remove();
  });

  it("logs dogfood from the active workbench with lead, draft and research-run context", async () => {
    const data = structuredClone(focusedWorkbenchData);
    data.leads[0]!.draft_versions = [draftVersion("draft-2", 2, "Current subject", "Current body", "draft")];
    const { container, root } = await renderWorkbench(data);
    const fetchMock = vi.fn(async () => jsonResponse({ id: "dogfood-2", ok: true }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => buttonNamed(container, "Log dogfood finding")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const title = container.querySelector('input[placeholder="Finding title"]') as HTMLInputElement;
    const details = container.querySelector('textarea[placeholder="What happened and what would help?"]') as HTMLTextAreaElement;
    await act(async () => {
      setValue(title, "Draft history is hard to scan");
      setValue(details, "Keep the restored source version visible after a new version is saved.");
    });
    await act(async () => {
      buttonNamed(container, "Log linked finding")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-dogfood", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        campaign_id: "campaign-1",
        entry_type: "friction",
        severity: "P2",
        title: "Draft history is hard to scan",
        details: "Keep the restored source version visible after a new version is saved.",
        ui_surface: "Campaign → Outreach → Focused workbench",
        status: "logged",
        evidence_url: null,
        linked_lead_id: "lead-1",
        linked_draft_id: "draft-2",
        linked_enrichment_run_id: "run-1",
        linked_page_revision_id: null,
      }),
    }));

    await act(async () => root.unmount());
    container.remove();
  });

  it("records an approved ready draft as sent without exposing a delivery action", async () => {
    const data = structuredClone(focusedWorkbenchData);
    data.leads[0]!.draft_versions = [draftVersion("draft-2", 2, "Approved subject", "Approved body", "approved")];
    data.leads[0]!.pipeline_stage = "ready";
    data.leads[0]!.ready_blockers = [];
    const { container, root } = await renderWorkbench(data);
    const fetchMock = vi.fn(async () => jsonResponse({
      event_type: "external_send_recorded",
      pipeline_stage: "sent",
      last_contacted_at: "2026-08-05T13:30:00.000Z",
      follow_up_at: "2026-08-19T13:30:00.000Z",
    }));
    vi.stubGlobal("fetch", fetchMock);
    const sentAt = container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement;
    const destination = container.querySelector('input[aria-label="Destination used"]') as HTMLInputElement;
    await act(async () => {
      setValue(sentAt, "2026-08-05T15:30");
      setValue(destination, "editor@example.org");
    });

    await act(async () => {
      buttonNamed(container, "Record sent")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-leads/lead-1/record-sent", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        campaign_id: "campaign-1",
        approved_draft_id: "draft-2",
        channel: "email",
        sent_at: new Date("2026-08-05T15:30").toISOString(),
        destination: "editor@example.org",
        follow_up_at: undefined,
      }),
    }));
    expect(container.textContent).toContain("Focused outreach · sent");
    expect(Array.from(container.querySelectorAll("button")).some((button) => /^send/i.test(button.textContent?.trim() ?? ""))).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("generates from a one-off instruction and saves manual edits as another draft version", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const { container, root } = await renderWorkbench(data);
    const generated = draftVersion("draft-1", 1, "A specific premiere", "Generated cited body", "draft");
    const edited = draftVersion("draft-2", 2, "A specific premiere", "Operator revised body", "draft");
    let contextRead = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-leads/lead-1/drafts") return jsonResponse(generated, 201);
      if (url === "/api/campaign-outreach-drafts/draft-1") return jsonResponse(edited, 201);
      if (url === "/api/campaigns/campaign-1/communicator-prompt") {
        contextRead += 1;
        return jsonResponse({
          prompt: data.prompt,
          leads: { "lead-1": { suggestions: data.leads[0]!.latest_suggestions, draft_versions: contextRead === 1 ? [generated] : [edited, { ...generated, status: "superseded" }], ready_blockers: ["approved_draft"], activity: [] } },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const instruction = Array.from(container.querySelectorAll("input")).find((element) => element.parentElement?.textContent?.includes("One-off draft instruction")) as HTMLInputElement;
    await act(async () => setValue(instruction, "Make the premiere ask more direct."));
    await act(async () => {
      buttonNamed(container, "Create saved first draft")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/campaign-leads/lead-1/drafts", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ campaign_id: "campaign-1", instruction: "Make the premiere ask more direct." }),
    }));
    const body = container.querySelector('[role="textbox"][aria-label="Outreach body"]') as HTMLElement;
    expect(body.textContent).toContain("Generated cited body");
    await act(async () => {
      buttonNamed(container, "Save as new draft")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/campaign-outreach-drafts/draft-1", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ subject: "A specific premiere", body: "Generated cited body", body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Generated cited body" }] }] } }),
    }));
    expect(container.textContent).toContain("Version 2 · draft");

    await act(async () => root.unmount());
    container.remove();
  });

  it("submits formatted outreach copy as a canonical body document and blocks approval while dirty", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const current = draftVersion("draft-1", 1, "A focused subject", "A focused Fountain note", "draft") as ReturnType<typeof draftVersion> & { body_document?: CampaignDocument };
    current.body_document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "A focused Fountain note" }] }] };
    data.leads[0]!.draft_versions = [current];
    data.leads[0]!.ready_blockers = ["approved_draft"];
    const { container, root } = await renderWorkbench(data);
    expect(container.querySelector('[aria-label="AI assist"]')).not.toBeNull();
    expect(buttonNamed(container, "Create saved first draft")).toBeNull();
    expect(container.textContent).not.toContain("One-off draft instruction");
    const saved = { ...current, id: "draft-2", version: 2, body: "A focused Fountain note", body_document: current.body_document };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "/api/campaign-outreach-drafts/draft-1") return jsonResponse(saved, 201);
      if (url === "/api/campaigns/campaign-1/communicator-prompt") return jsonResponse({ prompt: data.prompt, leads: { "lead-1": { suggestions: [], draft_versions: [saved], ready_blockers: ["approved_draft"], activity: [] } } });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = container.querySelector('[role="textbox"][aria-label="Outreach body"]') as HTMLElement;
    expect(editor).not.toBeNull();
    editor.innerHTML = "<p><strong>A focused Fountain note</strong></p>";
    await act(async () => editor.dispatchEvent(new Event("input", { bubbles: true })));
    expect(container.textContent).toContain("Unsaved outreach changes");
    expect((buttonNamed(container, "Approve draft") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => buttonNamed(container, "Save as new draft")?.click());
    const request = fetchMock.mock.calls.find((call) => String(call[0]) === "/api/campaign-outreach-drafts/draft-1") as [string, RequestInit] | undefined;
    const payload = JSON.parse(String(request?.[1]?.body)) as { body: string; body_document: { content: Array<{ type: string; content?: Array<{ marks?: unknown }> }> } };
    expect(payload.body).toContain("A focused Fountain note");
    expect(payload.body_document.content[0]?.type).toBe("paragraph");
    expect(payload.body_document.content[0]?.content?.[0]?.marks).toEqual([{ type: "bold" }]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps focused ownership and mutations locked through a deferred AI accept", async () => {
    const data = structuredClone(focusedWorkbenchData);
    const current = draftVersion("draft-1", 1, "Subject", "Focused body", "draft") as ReturnType<typeof draftVersion> & { body_document?: CampaignDocument };
    current.body_document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Focused body" }] }] };
    data.leads[0]!.draft_versions = [current];
    let resolveDecision: ((response: Response) => void) | undefined;
    const proposal = { run_id: "run-1", input_document_hash: "", proposed_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Accepted focused copy" }] }] }, rationale: "Clearer.", citation_ids: [], status: "ready", comparison: { before_label: "Current", proposed_label: "Proposed", blocks: [{ index: 0, changed: true, before: "Focused body", proposed: "Accepted focused copy" }] }, display: { provider: "openrouter", model: "safe-model", context_manifest: {}, citations: [] } };
    proposal.input_document_hash = (await import("../../lib/campaign-rich-text")).deriveCampaignDocument(current.body_document, 10_000).hash;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("campaign-editor-ai-runs/run-1")) return new Promise<Response>((resolve) => { resolveDecision = resolve; });
      if (url.includes("/editor-ai-runs")) return Promise.resolve(jsonResponse(proposal, 201));
      throw new Error(`Unexpected fetch ${url}`);
    }));
    const { container, root } = await renderWorkbench(data);
    const assist = container.querySelector('[aria-label="AI assist"]') as HTMLElement;
    await act(async () => buttonNamed(assist, "Suggest changes")?.click());
    await act(async () => buttonNamed(assist, "Accept suggestion")?.click());
    const radioTab = [...container.querySelectorAll('[role="tab"]')].find((node) => node.textContent === "Radio update") as HTMLButtonElement;
    expect(radioTab.disabled).toBe(true);
    expect((buttonNamed(container, "Save as new draft") as HTMLButtonElement).disabled).toBe(true);
    expect((buttonNamed(container, "Approve draft") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => radioTab.click());
    expect(container.querySelector('[role="textbox"][aria-label="Outreach body"]')).not.toBeNull();
    await act(async () => resolveDecision?.(jsonResponse({ run_id: "run-1", status: "accepted" }, 200)));
    expect((container.querySelector('[role="textbox"][aria-label="Outreach body"]') as HTMLElement).textContent).toContain("Accepted focused copy");
    await act(async () => root.unmount()); container.remove();
  });

  it("keeps malformed stored focused rich text readable but read-only until an explicit repair", async () => {
    const data = structuredClone(focusedWorkbenchData);
    data.leads[0]!.draft_versions = [{
      ...draftVersion("draft-1", 1, "Saved subject", "Readable legacy body", "draft"),
      body_document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Readable legacy body" }] }] },
      body_document_repair_required: true,
    }];
    const { container, root } = await renderWorkbench(data);
    const editor = container.querySelector('[role="textbox"][aria-label="Outreach body"]') as HTMLElement;
    const save = buttonNamed(container, "Save as new draft") as HTMLButtonElement;

    expect(container.textContent).toContain("Stored rich text needs repair");
    expect(editor.textContent).toContain("Readable legacy body");
    expect(editor.getAttribute("contenteditable")).not.toBe("true");
    expect(save.disabled).toBe(true);
    await act(async () => buttonNamed(container, "Repair and edit draft")?.click());
    expect(editor.getAttribute("contenteditable")).toBe("true");

    await act(async () => root.unmount());
    container.remove();
  });

  it("resets every unsaved communicator field when switching between no-draft leads", async () => {
    const data = focusedLeadPair();
    const { container, root } = await renderWorkbench(data);
    const subject = subjectInput(container);
    const instruction = oneOffInstruction(container);
    const sentAt = container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement;
    const destination = container.querySelector('input[aria-label="Destination used"]') as HTMLInputElement;
    const body = container.querySelector('[role="textbox"][aria-label="Outreach body"]') as HTMLElement;

    await act(async () => {
      setValue(subject, "Lead A subject");
      setValue(instruction, "Lead A instruction");
      setValue(sentAt, "2026-08-06T10:30");
      setValue(destination, "lead-a@example.org");
      body.innerHTML = "<p>Lead A body</p>";
      body.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Unsaved outreach changes");

    await act(async () => selectLead(container, "Second focused lead"));

    expect(subjectInput(container).value).toBe("");
    expect(oneOffInstruction(container).value).toBe("");
    expect((container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement).value).toBe("");
    expect((container.querySelector('input[aria-label="Destination used"]') as HTMLInputElement).value).toBe("");
    expect(container.querySelector('[role="textbox"][aria-label="Outreach body"]')?.textContent).not.toContain("Lead A body");
    expect(container.textContent).not.toContain("Unsaved outreach changes");
    expect(container.textContent).not.toContain("Unsaved changes");

    await act(async () => root.unmount());
    container.remove();
  });

  it("resets sent-record fields when switching from a drafted lead to another lead", async () => {
    const data = focusedLeadPair();
    data.leads[0]!.draft_versions = [draftVersion("draft-1", 1, "Lead A saved subject", "Lead A saved body", "draft")];
    const { container, root } = await renderWorkbench(data);
    const sentAt = container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement;
    const destination = container.querySelector('input[aria-label="Destination used"]') as HTMLInputElement;

    await act(async () => {
      setValue(sentAt, "2026-08-06T11:00");
      setValue(destination, "drafted-lead@example.org");
      selectLead(container, "Second focused lead");
    });

    expect(subjectInput(container).value).toBe("");
    expect(oneOffInstruction(container).value).toBe("");
    expect((container.querySelector('input[aria-label="Sent at"]') as HTMLInputElement).value).toBe("");
    expect((container.querySelector('input[aria-label="Destination used"]') as HTMLInputElement).value).toBe("");
    expect(container.querySelector('[role="textbox"][aria-label="Outreach body"]')?.textContent).not.toContain("Lead A saved body");
    expect(container.textContent).not.toContain("Unsaved outreach changes");

    await act(async () => root.unmount());
    container.remove();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function buttonNamed(container: HTMLElement, name: string) {
  return Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === name) ?? null;
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function subjectInput(container: HTMLElement) {
  return [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Subject"))?.querySelector("input") as HTMLInputElement;
}

function oneOffInstruction(container: HTMLElement) {
  return Array.from(container.querySelectorAll("input")).find((element) => element.parentElement?.textContent?.includes("One-off draft instruction")) as HTMLInputElement;
}

function selectLead(container: HTMLElement, targetName: string) {
  Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(targetName))?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function focusedLeadPair() {
  const data = structuredClone(focusedWorkbenchData);
  const second = {
    ...structuredClone(data.leads[0]!),
    id: "lead-2",
    target_name: "Second focused lead",
    dedupe_key: "url:https://example.org/second-focused-lead",
    latest_suggestions: [],
    draft_versions: [],
    activity: [],
  };
  data.leads = [data.leads[0]!, second];
  data.queue.now = data.leads;
  return data;
}

async function renderWorkbench(data = structuredClone(focusedWorkbenchData)) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<CampaignOutreachWorkspace initialData={data} canMutate />));
  return { container, root };
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function draftVersion(id: string, version: number, subject: string, body: string, status: "draft" | "approved" | "superseded") {
  return {
    id,
    org_id: "true-nature",
    campaign_id: "campaign-1",
    lead_id: "lead-1",
    enrichment_run_id: "run-1",
    scope: "focused" as const,
    version,
    status,
    subject,
    body,
    context_snapshot: {},
    approval_hash: status === "approved" ? `hash-${version}` : null,
    approved_by: status === "approved" ? "operator-1" : null,
    approved_at: status === "approved" ? new Date("2026-08-04T13:00:00.000Z") : null,
    created_at: new Date(`2026-08-04T1${version}:00:00.000Z`),
    updated_at: new Date(`2026-08-04T1${version}:00:00.000Z`),
  };
}
