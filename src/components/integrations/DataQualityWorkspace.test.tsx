/* @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import DataQualityWorkspace, { type DataQualityIssue } from "./DataQualityWorkspace";

const issues: DataQualityIssue[] = ["first", "second"].map((id) => ({
  id, connection_id: "connection", source: "warm", issue_type: "unmatched_track",
  priority: "P1", status: "open", label_suite_object_type: null, label_suite_object_id: null,
  external_object_type: "track", external_object_id: id, details: {}, created_at: "", updated_at: "",
}));

it("keeps each issue's canonical target separate and reports failed actions without losing the selection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DataQualityWorkspace initialIssues={issues}
      connections={[{ id: "connection", provider_key: "warm", provider_name: "WARM", label: "Test", status: "connected" }]}
      targetOptions={{ release: [{ id: "release-a", label: "Release A" }], track: [], work: [], station: [] }} />));
    const rows = host.querySelectorAll("article");
    const firstTarget = rows[0].querySelectorAll("select")[2];
    const secondTarget = rows[1].querySelectorAll("select")[2];
    await act(async () => {
      firstTarget.value = "release-a";
      firstTarget.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(secondTarget.value).toBe("");
    const button = (row: Element, text: string) => [...row.querySelectorAll("button")].find((item) => item.textContent === text)!;
    expect(button(rows[1], "Link external object").disabled).toBe(true);
    await act(async () => button(rows[0], "Link external object").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Could not link object");
    expect(firstTarget.value).toBe("release-a");
    expect(button(rows[0], "Link external object").disabled).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ label_suite_object_id: "release-a" });
    for (const action of ["Resolve", "Create task"]) {
      await act(async () => button(rows[0], action).click());
      expect(host.querySelector('[role="alert"]')?.textContent).toBe(action === "Resolve" ? "Could not update issue" : "Could not create task");
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...issues[0], status: "ignored" })));
    await act(async () => button(rows[0], "Ignore").click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll("article")).toHaveLength(1);
    const filters = [...host.querySelectorAll("select")].slice(0, 4);
    expect(filters.map((filter) => filter.getAttribute("aria-label"))).toEqual(["Source", "Priority", "Status", "Object type"]);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
