/* @vitest-environment jsdom */
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PitchEditor } from "./PitchEditor";

const id = "6948ae24-51ba-4a84-aedb-ed53af8d5f81";
const options: ComponentProps<typeof PitchEditor>["options"] = {
  campaignId: "campaign", syncId: null, contextTitle: "Fixture campaign", releaseId: "release", contactId: null,
  releases: [{ id: "release", title: "Fixture release" }], contacts: [{ id: "contact", name: "Recipient", email: "recipient@example.test" }], configured: true,
  files: [{ id: "file", trackId: "track", trackTitle: "Song", position: 1, version: "Instrumental", remoteBoxId: "box", remoteStackId: "stack", fileName: "Instrumental v2.wav", duration: 123, audioUrl: null, syncStatus: "synced", lastSyncedAt: null }],
};
const initial: NonNullable<ComponentProps<typeof PitchEditor>["initial"]> = {
  id, org_id: "org", campaign_id: "campaign", sync_deal_id: null, release_id: "release", contact_id: "contact", task_id: null,
  version: 1, title: "Fixture pitch", message: "Hello", credits: "Writer", rights_note: "Pending clearance", reply_email: "reply@example.test", artist_name: "Artist", artwork_url: null, remote_project_id: "project",
  recordings: [{ file_id: "file", track_id: "track", box_id: "box", title: "Song", file_name: "Instrumental v2.wav", version: "Instrumental", isrc: null }],
  downloads: false, token: "a".repeat(64), player_id: null, link_state: "draft", status: "draft", sent_date: null, response_note: "", created_at: new Date(), updated_at: new Date(),
  recipient: "Recipient", recipient_email: "recipient@example.test", next_action: "", due_date: null, task_status: null, public_path: null,
};

it("creates a link only on explicit action and does not record a send", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const ready = { ...initial, version: 2, link_state: "ready", player_id: "player", public_path: `/listen/org/${initial.token}` };
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ pitch: ready }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PitchEditor initial={initial} options={options} replyEmail="reply@example.test"/>));
    expect(fetchMock).not.toHaveBeenCalled();
    const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Create listening link")!;
    await act(async () => button.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/pitches/link");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "create", id, expected_version: 1 });
    expect(host.textContent).toContain("does not send this link automatically");
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("");
    expect(host.querySelector<HTMLFieldSetElement>("fieldset")!.disabled).toBe(true);
    expect(host.querySelector(`a[href="${ready.public_path}"]`)).toBeTruthy();
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});

it("refreshes a committed reservation after an uncertain provider response and offers recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ error: "Samply request timed out" }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ pitch: { ...initial, version: 2, link_state: "preparing" } }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<PitchEditor initial={initial} options={options} replyEmail="reply@example.test"/>));
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Create listening link")!.click());
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("timed out");
    expect(host.textContent).toContain("Recover listening link");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/pitches?id=${id}`);
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("Hello");
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
