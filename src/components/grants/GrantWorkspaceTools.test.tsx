// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { GrantWorkspaceTools } from "./GrantWorkspaceTools";
import type { GrantsWorkspacePayload } from "./grants-workspace-ui";
import { uploadFileToStorage } from "../../lib/storage-client";

vi.mock("../../lib/storage-client", () => ({ uploadFileToStorage: vi.fn().mockResolvedValue({ key: "fixture.pdf" }) }));
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  [0, "/api/funding-profiles"],
  [1, "/api/grant-deadlines"],
  [2, "/api/grant-applications/application/documents"],
  [3, "/api/grant-applications/application/documents"],
] as const)("saves grant form %i when its button is clicked", async (index, endpoint) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ documents: [], library: [{ id: "document", name: "Evidence" }], id: "link", documentId: "document" }) });
  vi.stubGlobal("fetch", fetch);
  const workspace = { projects: [{ id: "project", name: "Project" }], opportunities: [{ id: "grant", name: "Grant" }], applications: [{ id: "application", name: "Application" }], assets: [], calendarEvents: [] } as unknown as GrantsWorkspacePayload;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<GrantWorkspaceTools workspace={workspace} />));
  const form = container.querySelectorAll("form")[index];
  for (const field of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[required]")) {
    if (field instanceof HTMLSelectElement) field.value = field.options[field.options.length - 1].value;
    else if (field.type === "date") field.value = "2026-12-04";
  }
  if (index === 2) {
    // jsdom cannot populate a native file picker; supply its accepted FormData file.
    form.noValidate = true;
    const get = FormData.prototype.get;
    vi.spyOn(FormData.prototype, "get").mockImplementation(function (this: FormData, name) { return name === "file" ? new File(["evidence"], "evidence.pdf", { type: "application/pdf" }) : get.call(this, name); });
  }
  const reset = vi.spyOn(form, "reset");
  await act(async () => form.querySelector<HTMLButtonElement>("button")!.click());
  const saves = fetch.mock.calls.filter(([, options]) => options?.method === "POST");
  expect(saves).toHaveLength(1);
  expect(saves[0][0]).toBe(endpoint);
  expect(container.textContent).toContain("Saved.");
  if (index === 2) { expect(uploadFileToStorage).toHaveBeenCalled(); expect(reset).toHaveBeenCalledOnce(); }
});
