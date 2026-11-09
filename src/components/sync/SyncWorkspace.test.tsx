/* @vitest-environment jsdom */
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SyncEditor } from "./SyncWorkspace";
import { syncSaveSchema } from "../../lib/sync";

const files = vi.hoisted(() => ({
  resolveFileUrl: vi.fn(),
  openExternalUrl: vi.fn(),
}));
vi.mock("../../lib/storage-client", () => ({
  resolveFileUrl: files.resolveFileUrl,
}));
vi.mock("../../lib/external-url", () => ({
  openExternalUrl: files.openExternalUrl,
}));

it("renders the same explicit revision timestamp across server and browser time zones", () => {
  const input = syncSaveSchema.parse({
    id: "6948ae24-51ba-4a84-aedb-ed53af8d5f81",
    expected_version: 1,
    production: "Synthetic placement",
    details: { recording_title: "Recording", version_name: "Instrumental", provenance: "Synthetic" },
  });
  const timestamp = new Date("2026-11-01T01:54:01.000Z");
  const initial: NonNullable<ComponentProps<typeof SyncEditor>["initial"]> = {
    deal: { ...input, org_id: "fixture", version: 1, task_id: null, created_at: timestamp, updated_at: timestamp },
    next_action: null, owner: null, due_date: null, task_status: null,
    receipts: [], money: { totals: {}, balance: null, status: "unknown" },
    revisions: [{ id: "revision", org_id: "fixture", deal_id: input.id, version: 1, snapshot: input, actor_id: "fixture", created_at: timestamp }],
  };
  const options = { artists: [], releases: [], tracks: [], contacts: [], documents: [], assets: [] };
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const server = renderToString(<SyncEditor initial={initial} options={options} />);
    process.env.TZ = "America/New_York";
    const browser = renderToString(<SyncEditor initial={initial} options={options} />);
    expect(browser).toBe(server);
    expect(server).toContain("2026-11-01 01:54:01 UTC");
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

it("refreshes and opens assets without losing edits or treating a linked file as delivered", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const options: ComponentProps<typeof SyncEditor>["options"] = {
    artists: [],
    releases: [],
    tracks: [],
    contacts: [],
    documents: [],
    assets: [],
  };
  const assets = [
    {
      id: "asset-a",
      label: "Instrumental candidate",
      file_link: "org/media-assets/master.wav",
    },
    { id: "asset-b", label: "Missing file", file_link: null },
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ options: { ...options, assets } }));
  vi.stubGlobal("fetch", fetchMock);
  files.resolveFileUrl.mockResolvedValue("https://signed.example/master.wav");
  files.openExternalUrl.mockReturnValue(true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const button = (text: string) =>
    [...host.querySelectorAll("button")].find(
      (item) => item.textContent === text,
    )!;
  try {
    await act(async () =>
      root.render(<SyncEditor initial={null} options={options} />),
    );
    const production = host.querySelector("input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(production, "Unsaved production");
      production.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Refresh media assets").click());
    expect(production.value).toBe("Unsaved production");
    const select = host.querySelector<HTMLSelectElement>(
      '[aria-label="Linked media asset"]',
    )!;
    await act(async () => {
      select.value = "asset-a";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Open selected file").click());
    expect(files.resolveFileUrl).toHaveBeenCalledWith(
      "org/media-assets/master.wav",
    );
    expect(files.openExternalUrl).toHaveBeenCalledWith(
      "https://signed.example/master.wav",
    );
    expect(
      host.querySelector<HTMLSelectElement>('[aria-label="Delivery status"]')
        ?.value,
    ).toBe("unknown");
    expect(
      host.querySelector<HTMLSelectElement>('[aria-label="Master clearance"]')
        ?.value,
    ).toBe("unknown");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/sync");
    expect(
      host.querySelector('a[href="/media-assets"]')?.getAttribute("target"),
    ).toBe("_blank");

    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Refresh unavailable" }, { status: 503 }),
    );
    await act(async () => button("Refresh media assets").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "Refresh unavailable",
    );
    expect(select.value).toBe("asset-a");
    expect(production.value).toBe("Unsaved production");
    files.openExternalUrl.mockReturnValue(false);
    await act(async () => button("Open selected file").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "valid HTTP or HTTPS",
    );
    await act(async () => {
      select.value = "asset-b";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Open selected file").click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "has no file",
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  }
});
