// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReleaseWorkItemForm } from "./ReleaseWorkItemForm";
import { ReleaseWorkbackBuilder } from "./ReleaseWorkbackBuilder";
import { ReleaseTimeline } from "./ReleaseTimeline";
import { buildReleaseTimeline } from "../../server/release-timeline-core";

vi.mock("./ReleaseCalendar", () => ({ ReleaseCalendar: () => null }));

const timeline = buildReleaseTimeline({ releaseDate: "2026-10-23", today: "2026-09-15", budgetItems: [], milestones: [], tasks: [
  { id: "unphased", title: "Find artwork", phase: null, dueDate: null, owner: null, status: "todo", priority: "P2", milestoneId: null },
  { id: "overdue", title: "Approve master", phase: "assets_metadata", dueDate: "2026-09-01", owner: "Malthe", status: "todo", priority: "P2", milestoneId: null },
] });
let root: Root;
let container: HTMLDivElement;
async function render(canManage = true) {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<ReleaseTimeline releaseId="release" canManage={canManage} timeline={timeline} />));
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => timeline })); });
afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); vi.unstubAllGlobals(); });

describe("release workback UI", () => {
  it("loads current task and release-date data each time the schedule opens", async () => {
    const latest = { ...timeline, releaseDate: "2026-12-04", unphasedTasks: [{ ...timeline.unphasedTasks![0], title: "Newly saved task" }] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => latest });
    vi.stubGlobal("fetch", fetch);
    await render();
    expect(container.textContent).toContain("2026-12-04");
    expect(container.textContent).toContain("Newly saved task");
    expect(container.textContent).not.toContain("Find artwork");
    await act(async () => root.render(null));
    await act(async () => root.render(<ReleaseTimeline releaseId="release" canManage timeline={timeline} />));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Newly saved task");
  });

  it("shows cross-phase and undated work and persists completion through the shared task API", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...timeline, unphasedTasks: [] }) });
    await render(); vi.stubGlobal("fetch", fetch);
    expect(container.textContent).toContain("Find artwork"); expect(container.textContent).toContain("Approve master");
    expect(container.querySelector('[aria-label="Overdue"]')?.textContent).toContain("Approve master");
    await act(async () => (container.querySelector('[aria-label="Complete Find artwork"]') as HTMLButtonElement).click());
    expect(fetch.mock.calls[0][0]).toBe("/api/ops-tasks");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ id: "unphased", status: "done" });
    expect(container.textContent).not.toContain("Find artwork");
  });
  it("offers retry without mutation controls when refresh fails", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, json: async () => timeline });
    vi.stubGlobal("fetch", fetch); await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not refresh");
    expect(container.querySelector('[aria-label="Complete Find artwork"]')).toBeNull();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Retry")!.click());
    expect(container.querySelector('[aria-label="Complete Find artwork"]')).toBeTruthy();
  });
  it("retains work and reports a failed save without showing false completion", async () => {
    await render(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Cannot save" }) }));
    await act(async () => (container.querySelector('[aria-label="Complete Find artwork"]') as HTMLButtonElement).click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Cannot save");
    expect(container.querySelector('[aria-label="Complete Find artwork"]')).toBeTruthy();
  });
  it("keeps read-only work visible while removing edit and builder actions", async () => {
    await render(false);
    expect(container.textContent).toContain("Find artwork");
    expect(container.textContent).not.toContain("Add suggested tasks");
    expect(container.querySelector('[aria-label="Edit Find artwork"]')).toBeNull();
    expect((container.querySelector('[aria-label="Complete Find artwork"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

it("editing an unchanged relative deadline preserves its date even after release day moves", async () => {
  await render();
  const onSave = vi.fn(async (_payload: Record<string, unknown>) => true);
  await act(async () => root.render(<ReleaseWorkItemForm kind="task" phase="" releaseDate="2026-11-23" milestones={[]} busy={false} onSave={onSave} onClose={() => undefined} item={{ id: "done", title: "Approved master", status: "done", dueDate: "2026-09-01", offsetDays: -28, phase: null, owner: "Malthe", priority: "P2", milestoneId: null }} />));
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save")!.click());
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ due_date: "2026-09-01", status: "done" }));
  expect(onSave.mock.calls[0][0]).not.toHaveProperty("release_offset_days");
});

it("groups release milestones and shows dependencies, members and labels on the board", async () => {
  const data = buildReleaseTimeline({ releaseDate: "2026-12-04", today: "2026-09-15", budgetItems: [], milestones: [
    { id: "delivery", title: "Single delivery", phase: "distribution_dsp", dueDate: "2026-09-25", status: "todo", owner: null, notes: null, isBlocking: true },
  ], tasks: [
    { id: "master", title: "Approve master", phase: "assets_metadata", dueDate: "2026-09-24", owner: null, status: "todo", priority: "P2", milestoneId: null },
    { id: "upload", title: "Upload single", phase: "distribution_dsp", dueDate: "2026-09-25", owner: null, status: "todo", priority: "P2", milestoneId: "delivery", assigneeIds: ["maya", "malthe"], labels: ["Distribution"], dependencyIds: ["master"] },
  ] });
  data.planningOptions = { members: [{ id: "maya", name: "Maya" }, { id: "malthe", name: "Malthe" }], tasks: [] };
  await render();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
  await act(async () => root.render(<ReleaseTimeline key="schedule" releaseId="release" canManage timeline={data} />));
  expect(container.querySelector('[aria-label="Single delivery"]')?.textContent).toContain("Upload single");
  expect(container.textContent).toContain("Maya, Malthe");
  expect(container.textContent).toContain("Waiting on: Approve master");
  expect(container.textContent).not.toContain("workback");
  await act(async () => Array.from(container.querySelectorAll('button')).find((button) => button.textContent === "Board")!.click());
  expect(container.querySelector('[aria-label="Blocked"]')?.textContent).toContain("Upload single");
  expect(container.querySelector('[aria-label="Blocked"]')?.textContent).toContain("Distribution");
  const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...data, phases: data.phases.map((phase) => ({ ...phase, tasks: phase.tasks.map((task) => task.id === "master" ? { ...task, status: "done" } : task) })) }) });
  vi.stubGlobal("fetch", fetch);
  await act(async () => (container.querySelector('[aria-label="Complete Approve master"]') as HTMLButtonElement).click());
  expect(container.querySelector('[aria-label="Blocked"]')?.textContent).not.toContain("Upload single");
  expect(container.querySelector('[aria-label="To do"]')?.textContent).toContain("Upload single");
});

it("saves multiple workspace assignees, labels and dependencies from the task editor", async () => {
  await render();
  const onSave = vi.fn(async () => true);
  await act(async () => root.render(<ReleaseWorkItemForm kind="task" phase="" releaseDate="2026-12-04" milestones={[]} busy={false} onSave={onSave} onClose={() => undefined} planningOptions={{ members: [{ id: "maya", name: "Maya" }, { id: "malthe", name: "Malthe" }], tasks: [{ id: "master", title: "Master", status: "todo", dueDate: null, dependencyIds: [], labels: [] }] }} />));
  const checkboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
  await act(async () => { checkboxes[0].click(); });
  await act(async () => { checkboxes[1].click(); });
  await act(async () => { checkboxes[2].click(); });
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ assignee_ids: ["maya", "malthe"], dependency_ids: ["master"] }));
});

it("adds suggested tasks by clicking the submit button", async () => {
  await render();
  const onApply = vi.fn(async (_items: unknown[]) => true);
  const onClose = vi.fn();
  await act(async () => root.render(<ReleaseWorkbackBuilder releaseDate="2026-12-04" today="2026-09-26" tasks={[]} busy={false} onApply={onApply} onClose={onClose} />));
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => /^Add \d+ tasks$/.test(button.textContent ?? ""))!.click());
  expect(onApply).toHaveBeenCalledOnce();
  expect(onApply.mock.calls[0][0]).toEqual(expect.arrayContaining([expect.objectContaining({ dueDate: expect.any(String), offsetDays: expect.any(Number) })]));
  expect(onClose).toHaveBeenCalledOnce();
});
