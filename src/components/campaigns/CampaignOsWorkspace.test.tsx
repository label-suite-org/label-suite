// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import CampaignOsWorkspace from "./CampaignOsWorkspace";

let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

it.each([
  ["creators", 0, "create_engagement"],
  ["creators", 1, "create_deliverable"],
  ["posts", 0, "create_post"],
  ["report", 0, "finalize_report"],
] as const)("submits %s form %i by clicking its save button", async (section, index, action) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const workspace = { territories: [], engagements: [{ id: "engagement", contact_id: "contact", contact_name: "Test creator", status: "draft", outreach_channel: "email", outreach_permission_status: "unknown" }], deliverables: [], posts: [], cost: { planned: 0, committed: 0, paid: 0 }, report: { narrative: null, snapshot: null, finalized_at: null } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => workspace });
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section={section} canMutate contacts={[{ id: "contact", name: "Test creator" }]} />));
  const form = container.querySelectorAll("form")[index];
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[required]")) {
    if (field instanceof HTMLSelectElement) field.value = field.options[field.options.length - 1].value;
    else if (field instanceof HTMLInputElement && field.type === "url") field.value = "https://example.test/post";
    else if (!field.value) field.value = "Test value";
  }
  await act(async () => form.querySelector<HTMLButtonElement>("button")!.click());
  const saves = fetch.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(saves).toHaveLength(1);
  expect(JSON.parse(saves[0][1].body).action).toBe(action);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  if (action !== "finalize_report") expect(form.querySelector<HTMLInputElement>("input[required], textarea[required]")?.value ?? "").toBe("");
});

it("shows saved report figures beside live figures without offering finalisation again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    territories: [], engagements: [], deliverables: [], posts: [], cost: { planned: 20, committed: 10, paid: 5 },
    report: { narrative: "Finished", finalized_at: "2026-09-27T12:00:00.000Z", snapshot: { finalized_at: "2026-09-27T12:00:00.000Z", cost: { planned: 10, committed: 4, paid: 2 }, deliverable_count: 1, approved_deliverable_count: 1, post_count: 1, manual_metrics: { views: 100 }, creator_delivery: [{ contact_name: "Alex", status: "complete", deliverables: [{ description: "One video", approval_status: "approved", evidence_url: null }] }], post_evidence: [{ url: "https://example.test/post", platform: "Instagram", published_at: "2026-09-27T00:00:00.000Z", metrics_captured_at: "2026-09-27T12:00:00.000Z", manual_metrics: { views: 100 }, notes: null }], budget_lines: [{ name: "Creator fee", planned_amount: 10, committed_amount: 4, paid_amount: 2 }] } },
  }) }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="report" canMutate contacts={[]} />));
  expect(container.textContent).toContain("Saved at finalisation");
  expect(container.textContent).toContain("Planned 10 · Committed 4 · Paid 2");
  expect(container.textContent).toContain("Current Campaign record");
  expect(container.textContent).toContain("Planned 20 · Committed 10 · Paid 5");
  expect(container.textContent).toContain("views: 100");
  expect(container.textContent).toContain("no platform monitoring occurs");
  await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click());
  expect(container.textContent).toContain("One video");
  expect(container.textContent).toContain("https://example.test/post");
  expect(container.textContent).toContain(`Published ${new Date("2026-09-27T00:00:00.000Z").toLocaleDateString(undefined, { timeZone: "UTC" })}`);
  expect(container.textContent).toContain("Creator fee");
  expect(container.textContent).not.toContain("Finalise report");
});

it("labels older snapshots without item-level evidence honestly", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    territories: [], engagements: [], deliverables: [], posts: [], cost: { planned: 0, committed: 0, paid: 0 },
    report: { narrative: "Older report", finalized_at: "2026-09-20T12:00:00.000Z", snapshot: { finalized_at: "2026-09-20T12:00:00.000Z", cost: { planned: 0, committed: 0, paid: 0 }, deliverable_count: 0, approved_deliverable_count: 0, post_count: 0, manual_metrics: {} } },
  }) }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="report" canMutate contacts={[]} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click());
  expect(container.textContent).toContain("Item-level evidence was not saved with this older snapshot.");
});
