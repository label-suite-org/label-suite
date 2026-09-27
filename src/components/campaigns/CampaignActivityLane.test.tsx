/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CampaignActivityItem,
  CampaignActivitySnapshot,
} from "../../server/campaign-activity-core";
import { CampaignActivityLane } from "./CampaignActivityLane";

function item(overrides: Partial<CampaignActivityItem> = {}): CampaignActivityItem {
  return {
    key: "event:event-1:research_completed",
    category: "research",
    kind: "research_completed",
    occurredAt: new Date("2026-08-08T10:00:00.000Z"),
    title: "Research completed",
    summary: "Public contact route verified.",
    actor: { kind: "user", id: "operator-1", label: "Operator" },
    refs: { campaignId: "campaign-1", leadId: "lead-1", contactId: null, taskId: null, draftId: null },
    evidence: [{ label: "Research source", href: "https://example.test/research" }],
    source: { kind: "event", recordId: "event-1" },
    ...overrides,
  };
}

function snapshot(): CampaignActivitySnapshot {
  const research = item();
  return {
    items: [
      research,
      item({ key: "task:task-1:task_state", category: "task", kind: "task_state", title: "Review task", occurredAt: new Date("2026-08-07T10:00:00.000Z"), evidence: [] }),
      item({ key: "email:email-1:email_status", category: "outreach", kind: "email_status", title: "Email activity recorded", occurredAt: new Date("2026-08-06T10:00:00.000Z"), evidence: [] }),
      item({ key: "event:reply-1:reply_recorded", category: "reply", kind: "reply_recorded", title: "Reply recorded", occurredAt: new Date("2026-08-05T10:00:00.000Z"), evidence: [] }),
      item({ key: "event:outcome-1:outcome_recorded", category: "outcome", kind: "outcome_recorded", title: "Outcome recorded", occurredAt: new Date("2026-08-04T10:00:00.000Z"), evidence: [] }),
      item({ key: "event:unknown:research_started", kind: "research_started", title: "Research started", occurredAt: null, evidence: [] }),
    ],
    proposals: [
      {
        key: "campaign-1:lead-1:research-next:v1",
        ruleKey: "research-next",
        ruleVersion: 1,
        actionType: "start_research",
        leadId: "lead-1",
        taskId: null,
        state: "pending",
        title: "Start lead research",
        summary: "Research is the next step for this lead.",
        href: "/campaigns/campaign-1?tab=outreach&lead=lead-1#lead-research",
        evidenceKeys: [research.key],
      },
      {
        key: "campaign-1:lead-2:draft-next:v1",
        ruleKey: "draft-next",
        ruleVersion: 1,
        actionType: "prepare_draft",
        leadId: "lead-2",
        taskId: null,
        state: "resolved",
        title: "Resolved recommendation",
        summary: "Already handled.",
        href: "/campaigns/campaign-1?tab=outreach&lead=lead-2#lead-drafting",
        evidenceKeys: [],
      },
    ],
    sourceStates: [
      { source: "outreach_events", state: "complete", message: null },
      { source: "tasks", state: "complete", message: null },
      { source: "email_logs", state: "unavailable", message: "Email logs are unavailable" },
    ],
  };
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("CampaignActivityLane", () => {
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

  it("keeps proposal actions navigational and decisions explicit", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate onDecision={onDecision} />));

    const workflow = [...host.querySelectorAll("a")].find((anchor) => anchor.textContent === "Open workflow");
    expect(workflow?.getAttribute("href")).toBe("/campaigns/campaign-1?tab=outreach&lead=lead-1#lead-research");
    expect(host.textContent).toContain("Research is the next step for this lead.");
    expect(host.textContent).toContain("Research source");
    expect(host.textContent).not.toContain("Resolved recommendation");
    await click([...host.querySelectorAll("button")].find((button) => button.textContent === "Dismiss recommendation") as HTMLButtonElement);
    expect(onDecision).toHaveBeenCalledWith({ proposal_key: "campaign-1:lead-1:research-next:v1", decision: "dismissed", reason: null });
  });

  it("renders interaction-owned decision feedback and control locking", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate disabled decisionPending feedback="Recording decision..." onDecision={onDecision} />));
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("Recording decision...");
    expect(host.querySelector('article[aria-busy="true"]')).not.toBeNull();
    expect([...host.querySelectorAll("button")].filter((button) => button.disabled)).toHaveLength(2);

    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate feedback="Recommendation dismissed." onDecision={onDecision} />));
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toBe("Recommendation dismissed.");
    expect(host.querySelector('article[aria-busy="false"]')).not.toBeNull();
  });

  it("hides decision controls for read-only users and exposes partial source state", async () => {
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate={false} onDecision={vi.fn()} />));
    expect(host.querySelector('button[aria-label="Dismiss recommendation"]')).toBeNull();
    expect(host.querySelector('button[aria-label="Mark handled"]')).toBeNull();
    expect(host.textContent).toContain("Partial activity");
    expect(host.textContent).toContain("Email logs");
    expect(host.textContent).toContain("Time unknown");
  });

  it("disables proposal decisions while the parent workspace is busy", async () => {
    const onDecision = vi.fn().mockResolvedValue(undefined);
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate disabled onDecision={onDecision} />));
    const dismiss = host.querySelector('button[aria-label="Dismiss recommendation"]') as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);
    await click(dismiss);
    expect(onDecision).not.toHaveBeenCalled();
  });

  it("uses pressed category filters and keeps the chronology ordered", async () => {
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate={false} onDecision={vi.fn()} />));
    const all = host.querySelector('button[aria-label="All"]') as HTMLButtonElement;
    const replies = host.querySelector('button[aria-label="Replies"]') as HTMLButtonElement;
    expect(all.getAttribute("aria-pressed")).toBe("true");
    expect(replies.getAttribute("aria-pressed")).toBe("false");
    const rows = [...host.querySelectorAll("ol[aria-label=\"Activity chronology\"] > li")];
    expect(rows[0]?.textContent).toContain("Research completed");
    expect(rows.at(-1)?.textContent).toContain("Time unknown");
    await click(replies);
    expect(replies.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelectorAll("ol[aria-label=\"Activity chronology\"] > li")).toHaveLength(1);
    expect(host.textContent).toContain("Reply recorded");
  });

  it("renders timestamps deterministically in the operator timezone", async () => {
    await act(async () => root.render(<CampaignActivityLane snapshot={snapshot()} canMutate={false} onDecision={vi.fn()} />));

    const firstTimestamp = host.querySelector('ol[aria-label="Activity chronology"] time');
    expect(firstTimestamp?.getAttribute("datetime")).toBe("2026-08-08T10:00:00.000Z");
    expect(firstTimestamp?.textContent).toBe("8 Aug 2026, 12:00");
  });

  it("renders the honest empty state when a complete source has no visible rows", async () => {
    const completeEmpty: CampaignActivitySnapshot = { items: [], proposals: [], sourceStates: [{ source: "tasks", state: "complete", message: null }] };
    await act(async () => root.render(<CampaignActivityLane snapshot={completeEmpty} canMutate={false} onDecision={vi.fn()} />));
    expect(host.textContent).toContain("No activity is recorded from the available sources");
    expect(host.textContent).not.toContain("Partial activity");
  });
});
