/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import BudgetDepartment from "./BudgetDepartment";
import { expectedProjectIncome } from "./BudgetKpiStrip";

const projects = ["first", "tour"].map(id => ({ id, name: id, project_type: "tour", status: "planning", currency: "USD", total_planned: 100, baseline_funding: 0, track_count: null, singles_count: null, artist_name: null, release_title: null, release_format: null, cover_art_url: null }));
const grant = { id: "award", name: "Tour award", project_id: "tour", workflow_stage: "active", currency: "DKK", amount_awarded: 1000, reference: null, purpose: "Travel only", notes: null, next_action: "Check travel receipts", reporting_due: null, project_name: "tour" };
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); document.body.innerHTML = ""; });

it("restores the accessible project before fetching, keeps unrelated grants collapsed, and opens the action target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  Element.prototype.scrollIntoView = vi.fn();
  window.history.replaceState(null, "", "/budget");
  localStorage.setItem("budget-project:workspace", "tour");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ project: { notes: "Check imported budget" }, kpi: { total_planned: 100, confirmed_funding: 0, paid_total: 0 }, buckets: [], lines: [], funding: [], phases: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const props = { workspaceId: "workspace", projects, hasLegacyItems: false, artistOptions: [], releaseOptions: [], grantGuidance: [grant, { ...grant, id: "other", project_id: "first", name: "Other award" }, { ...grant, id: "closed", workflow_stage: "closed", name: "Closed award" }] };
  await act(async () => root.render(<BudgetDepartment {...props} />));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/budget-projects/tour/dashboard");
  expect((container.querySelector("select") as HTMLSelectElement).value).toBe("tour");
  expect(container.querySelector("#spending-plan")?.closest("details")).toBeNull();
  expect(container.querySelector("#grant-other")?.closest("details")?.open).toBe(false);
  expect(container.querySelector("#grant-closed")?.closest("details")?.textContent).toContain("Grant purposes for this project");
  const action = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Check travel receipts"))!;
  await act(async () => action.click());
  expect(container.querySelector("#grant-award")?.closest("details")?.open).toBe(true);
  await act(async () => root.unmount());
  // An explicit project link takes precedence over the saved choice.
  const linkedRoot = createRoot(container);
  fetchMock.mockClear();
  await act(async () => linkedRoot.render(<BudgetDepartment {...props} initialProjectId="first" />));
  expect(fetchMock.mock.calls[0][0]).toBe("/api/budget-projects/first/dashboard");
  expect(localStorage.getItem("budget-project:workspace")).toBe("first");
  await act(async () => linkedRoot.unmount());
});

it("counts merchandise as expected income and keeps grants and rejected sources out of that total", () => {
  expect(expectedProjectIncome([
    { type: "guarantee", status: "confirmed", amount_planned: 22000, amount_confirmed: 22500 },
    { type: "merchandise", status: "confirmed", amount_planned: 9000, amount_confirmed: 9000 },
    { type: "grant", status: "granted", amount_planned: 100000, amount_confirmed: 100000 },
    { type: "sponsor", status: "rejected", amount_planned: 10000, amount_confirmed: null },
  ])).toBe(31500);
});
