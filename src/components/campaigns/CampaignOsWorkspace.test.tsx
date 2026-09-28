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
  if (section === "creators") {
    const label = action === "create_engagement" ? "Add creator engagement" : "Add deliverable";
    await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]')].find((button) => button.textContent === label)!.click());
  }
  const form = container.querySelectorAll("form")[section === "creators" ? 0 : index];
  if (action === "create_deliverable") {
    for (const [name, label] of Object.entries({ engagement_id: "Creator", description: "Description", due_date: "Due date", approval_status: "Approval", evidence_url: "Evidence URL", notes: "Notes" })) {
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
      expect(field?.labels?.[0]?.textContent).toContain(label);
    }
  }
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[required]")) {
    if (field instanceof HTMLSelectElement) field.value = field.options[field.options.length - 1].value;
    else if (field instanceof HTMLInputElement && field.type === "url") field.value = "https://example.test/post";
    else if (!field.value) field.value = "Test value";
  }
  if (action === "create_post") form.querySelector<HTMLInputElement>('[name="metrics_captured_at"]')!.value = "2026-09-28";
  if (action === "create_engagement") {
    form.querySelector<HTMLSelectElement>('[name="permission"]')!.value = "permitted";
    form.querySelector<HTMLInputElement>('[name="basis"]')!.value = "Direct opt-in";
  }
  if (action === "create_deliverable") {
    form.querySelector<HTMLSelectElement>('[name="approval_status"]')!.value = "approved";
    form.querySelector<HTMLInputElement>('[name="evidence_url"]')!.value = "https://example.test/evidence";
  }
  await act(async () => form.querySelector<HTMLButtonElement>("button")!.click());
  const saves = fetch.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(saves).toHaveLength(1);
  expect(JSON.parse(saves[0][1].body).action).toBe(action);
  if (action === "create_post") expect(JSON.parse(saves[0][1].body).input.metrics_captured_at).toBe("2026-09-28T00:00:00.000Z");
  if (action === "create_engagement") {
    expect(JSON.parse(saves[0][1].body).input).toMatchObject({
      outreach_permission_status: "permitted",
      outreach_permission_basis: "Direct opt-in",
      outreach_permission_recorded_at: expect.any(String),
    });
  }
  if (action === "create_deliverable") expect(JSON.parse(saves[0][1].body).input).toMatchObject({ approval_status: "approved", evidence_url: "https://example.test/evidence" });
  expect(container.querySelector('[role="alert"]')).toBeNull();
  if (action !== "finalize_report") expect(form.querySelector<HTMLInputElement>("input[required], textarea[required]")?.value ?? "").toBe("");
});

it("edits creator details and records fresh permission evidence without sending outreach", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const workspace = { territories: [], engagements: [{ id: "engagement", contact_id: "contact", contact_name: "Test creator", status: "identified", relationship_notes: "Old note", outreach_channel: "email", outreach_permission_status: "unknown", outreach_permission_basis: null, outreach_permission_recorded_at: null, outreach_permission_revoked_at: null, agreed_rate: null, agreed_currency: null }], deliverables: [], posts: [], cost: { planned: 0, committed: 0, paid: 0 }, report: { narrative: null, snapshot: null, finalized_at: null } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => workspace });
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="creators" canMutate contacts={[]} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click());
  const notes = container.querySelector<HTMLTextAreaElement>('[name="notes"]')!;
  notes.value = "New note";
  await act(async () => notes.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  const basis = container.querySelector<HTMLInputElement>('[name="basis"]')!;
  basis.value = "Direct opt-in";
  await act(async () => basis.closest("form")!.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  const saves = fetch.mock.calls.filter(([, options]) => options?.method === "POST").map(([, options]) => JSON.parse(options.body));
  expect(saves).toHaveLength(2);
  expect(saves[0]).toMatchObject({ action: "update_engagement", input: { id: "engagement", relationship_notes: "New note" } });
  expect(saves[1]).toMatchObject({ action: "update_engagement", input: { id: "engagement", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: expect.any(String), outreach_permission_revoked_at: null } });
  expect(fetch).toHaveBeenCalledWith("/api/campaigns/campaign/os", expect.objectContaining({ method: "POST" }));
});

it("records a revocation timestamp and hides edit controls for read-only viewers", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const workspace = { territories: [], engagements: [{ id: "engagement", contact_id: "contact", contact_name: "Test creator", status: "contacted", relationship_notes: null, outreach_channel: "email", outreach_permission_status: "permitted", outreach_permission_basis: "Direct opt-in", outreach_permission_recorded_at: "2026-09-28T10:00:00.000Z", outreach_permission_revoked_at: null, agreed_rate: null, agreed_currency: null }], deliverables: [], posts: [], cost: { planned: 0, committed: 0, paid: 0 }, report: { narrative: null, snapshot: null, finalized_at: null } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => workspace });
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="creators" canMutate={false} contacts={[]} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click());
  expect(container.textContent).toContain("Direct opt-in");
  expect(container.textContent).not.toContain("Revoke permission");
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="creators" canMutate contacts={[]} />));
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Revoke permission")!.click());
  const save = JSON.parse(fetch.mock.calls.find(([, options]) => options?.method === "POST")![1].body);
  expect(save).toMatchObject({ action: "update_engagement", input: { id: "engagement", outreach_permission_status: "revoked", outreach_permission_revoked_at: expect.any(String) } });
});

it("shows deliverable evidence read-only and edits due date, approval, evidence, and notes for operators", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const workspace = { territories: [], engagements: [{ id: "engagement", contact_id: "contact", contact_name: "Test creator", status: "identified", outreach_channel: "email", outreach_permission_status: "unknown" }], deliverables: [{ id: "deliverable", engagement_id: "engagement", description: "Launch video", due_date: "2026-10-01T00:00:00.000Z", approval_status: "pending", evidence_url: "https://example.test/draft", notes: "First cut", updated_at: "2026-09-28T10:00:00.000Z" }], posts: [], cost: { planned: 0, committed: 0, paid: 0 }, report: { narrative: null, snapshot: null, finalized_at: null } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => workspace });
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="creators" canMutate={false} contacts={[]} />));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-slot="accordion-trigger"]')!.click());
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]')].find((button) => button.textContent?.includes("Launch video"))!.click());
  expect(container.textContent).toContain("First cut");
  expect(container.querySelector<HTMLAnchorElement>('a[href="https://example.test/draft"]')).not.toBeNull();
  expect(container.textContent).not.toContain("Save deliverable");
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="creators" canMutate contacts={[]} />));
  const deliverable = [...container.querySelectorAll<HTMLButtonElement>('[data-slot="accordion-trigger"]')].find((button) => button.textContent?.includes("Launch video"))!;
  if (deliverable.getAttribute("data-state") === "closed") await act(async () => deliverable.click());
  const form = [...container.querySelectorAll<HTMLFormElement>("form")].find((candidate) => candidate.querySelector('[name="approval_status"]'))!;
  form.querySelector<HTMLInputElement>('[name="due_date"]')!.value = "2026-10-02";
  form.querySelector<HTMLSelectElement>('[name="approval_status"]')!.value = "approved";
  form.querySelector<HTMLInputElement>('[name="evidence_url"]')!.value = "https://example.test/final";
  form.querySelector<HTMLTextAreaElement>('[name="notes"]')!.value = "Approved cut";
  await act(async () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  const save = JSON.parse(fetch.mock.calls.find(([, options]) => options?.method === "POST")![1].body);
  expect(save).toMatchObject({ action: "update_deliverable", input: { id: "deliverable", expected_updated_at: "2026-09-28T10:00:00.000Z", due_date: "2026-10-02T00:00:00.000Z", approval_status: "approved", evidence_url: "https://example.test/final", notes: "Approved cut" } });
});

it("shows the captured observation date beside a recorded post", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    territories: [], engagements: [], deliverables: [], cost: { planned: 0, committed: 0, paid: 0 }, report: { narrative: null, snapshot: null, finalized_at: null },
    posts: [{ id: "post-1", url: "https://example.test/post", platform: "TikTok", published_at: "2026-09-26T00:00:00.000Z", metrics_captured_at: "2026-09-28T00:00:00.000Z", manual_metrics: { views: 120 } }],
  }) }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section="posts" canMutate={false} contacts={[]} />));
  expect(container.textContent).toContain(`Published ${new Date("2026-09-26T00:00:00.000Z").toLocaleDateString(undefined, { timeZone: "UTC" })}`);
  expect(container.textContent).toContain(`Metrics captured ${new Date("2026-09-28T00:00:00.000Z").toLocaleDateString(undefined, { timeZone: "UTC" })}`);
  expect(container.textContent).toContain("views: 120");
});

it("shows saved report figures beside live figures without offering finalisation again", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({
    territories: [], engagements: [], deliverables: [], posts: [], cost: { planned: 20, committed: 10, paid: 5 },
    report: { narrative: "Finished", finalized_at: "2026-09-27T12:00:00.000Z", snapshot: { finalized_at: "2026-09-27T12:00:00.000Z", cost: { planned: 10, committed: 4, paid: 2 }, deliverable_count: 1, approved_deliverable_count: 1, post_count: 1, manual_metrics: { views: 100 }, creator_delivery: [{ contact_name: "Alex", status: "complete", deliverables: [{ description: "One video", approval_status: "approved", evidence_url: null }] }], post_evidence: [{ url: "https://example.test/post", platform: "Instagram", published_at: "2026-09-27T00:00:00.000Z", metrics_captured_at: "2026-09-27T00:00:00.000Z", manual_metrics: { views: 100 }, notes: null }], budget_lines: [{ name: "Creator fee", planned_amount: 10, committed_amount: 4, paid_amount: 2 }] } },
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
  expect(container.textContent).toContain(`Metrics captured ${new Date("2026-09-27T00:00:00.000Z").toLocaleDateString(undefined, { timeZone: "UTC" })}`);
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
