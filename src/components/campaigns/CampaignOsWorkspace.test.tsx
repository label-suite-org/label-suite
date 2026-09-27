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
  const workspace = { territories: [], engagements: [{ id: "engagement", contact_id: "contact", contact_name: "Test creator", status: "draft", outreach_channel: "email", outreach_permission_status: "unknown" }], deliverables: [], posts: [], cost: { planned: 0, committed: 0, paid: 0 } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => workspace });
  vi.stubGlobal("fetch", fetch);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<CampaignOsWorkspace campaignId="campaign" section={section} canMutate contacts={[{ id: "contact", name: "Test creator" }]} finalReport="Test report" />));
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
