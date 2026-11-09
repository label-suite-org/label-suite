// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OpsTaskForm } from "./OpsTaskForm";
import { OpsTaskManager } from "./OpsTaskManager";

let root: Root;
let container: HTMLDivElement;
const options = { artists: [], releases: [], campaigns: [], contacts: [], projects: [], events: [] };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => Array.from(container.querySelectorAll("button")).find((item) => item.textContent === text)!;

it("keeps the submitted draft and original revision on conflict until the user chooses to reload", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: "Task changed before this action could be saved" }, { status: 409 }));
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal("fetch", fetch); vi.stubGlobal("confirm", confirm);
  const initial = { id: "task", revision: 4, task_name: "Arrange rehearsal", notes: "Saved note", status: "todo" };
  await act(async () => root.render(<OpsTaskForm {...options} initial={initial} onClose={() => undefined} />));
  const notes = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(notes, "My unsaved draft");
    notes.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // A parent refresh must not associate the old draft with a newer revision.
  await act(async () => root.render(<OpsTaskForm {...options} initial={{ ...initial, revision: 5 }} onClose={() => undefined} />));
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ id: "task", expected_revision: 4, notes: "My unsaved draft" });
  expect(notes.value).toBe("My unsaved draft");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("have not been saved");
  expect(button("Save Changes").disabled).toBe(true);
  await act(async () => button("Reload latest task").click());
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("discard your unsaved edits"));
  expect(notes.value).toBe("My unsaved draft");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("uses the acknowledged revision for each successive quick status change", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, revision: 5 })).mockResolvedValueOnce(Response.json({ ok: true, revision: 6 }));
  vi.stubGlobal("fetch", fetch);
  await act(async () => root.render(<OpsTaskManager {...options} initialTasks={[{ id: "task", revision: 4, task_name: "Arrange rehearsal", status: "todo" }]} />));
  await act(async () => button("→ Done").click());
  await act(async () => button("→ In Progress").click());
  expect(fetch.mock.calls.map((call) => JSON.parse(call[1].body))).toEqual([
    { id: "task", status: "done", expected_revision: 4 },
    { id: "task", status: "in_progress", expected_revision: 5 },
  ]);
});

it("does not show a quick status change as saved when the task has changed elsewhere", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Task changed" }, { status: 409 })));
  await act(async () => root.render(<OpsTaskManager {...options} initialTasks={[{ id: "task", revision: 4, task_name: "Arrange rehearsal", status: "todo" }]} />));
  await act(async () => button("→ Done").click());
  expect(button("→ Done").disabled).toBe(true);
  expect(button("Reload latest tasks")).toBeTruthy();
});
