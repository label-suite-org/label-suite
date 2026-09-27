/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SisenseTrackSnapshotImport from "./SisenseTrackSnapshotImport";

const artists = [
  { id: "artist-a", name: "True Blue" },
  { id: "artist-b", name: "Fountain" },
];
const file = new File(["track_title,combined_streams\nBlue,10"], "Tracks by Growth Rate.csv", {
  type: "text/csv",
});
const fileSha256 = "c57f946ccb48b8440b7af8c1f4cafb54fef034ee0867229cab74faaa176058cf";
const replacementFile = new File(["track_title,combined_streams\nRed,12"], "Replacement.csv", {
  type: "text/csv",
});
const preview = {
  kind: "preview",
  artistId: "artist-a",
  artistName: "True Blue",
  fileName: "Tracks-by-Growth-Rate.csv",
  sha256: fileSha256,
  previewFingerprint: "b".repeat(64),
  requestedDateRange: "2026-08-01 to 2026-08-08",
  reportingFrom: "2026-08-01",
  reportingThrough: "2026-08-08",
  aggregation: "Daily",
  counts: { sourceRows: 3, uniqueTracks: 2, matched: 2, unmatched: 0, ambiguous: 0, exactDuplicates: 1 },
  totals: { combinedStreams: 56_320, combinedViews: 0 },
  identitySamples: {
    total: 2,
    truncated: false,
    items: [{
      sourceRow: 2,
      trackTitle: "Blue",
      primaryArtist: "True Blue",
      releaseTitle: "Blue EP",
      isrc: "DKAAA2600001",
      trackId: "track-a",
      matchStatus: "matched",
    },
    {
      sourceRow: 3,
      trackTitle: "Sky",
      primaryArtist: "True Blue",
      releaseTitle: "Blue EP",
      isrc: "DKAAA2600002",
      trackId: "track-b",
      matchStatus: "matched",
    }],
  },
};

function latestFor(overrides: Record<string, unknown> = {}) {
  return {
    artistId: preview.artistId,
    artistName: preview.artistName,
    runId: "run-a",
    fileName: preview.fileName,
    sha256: preview.sha256,
    rowCount: preview.counts.sourceRows,
    importedAt: "2026-08-11T08:15:00.000Z",
    reportingFrom: preview.reportingFrom,
    reportingThrough: preview.reportingThrough,
    requestedDateRange: preview.requestedDateRange,
    aggregation: preview.aggregation,
    counts: preview.counts,
    totals: preview.totals,
    ...overrides,
  };
}

function importedResult(overrides: Record<string, unknown> = {}) {
  return {
    kind: "imported",
    runId: "run-a",
    inserted: 1,
    updated: 1,
    unchanged: 0,
    latest: latestFor(),
    ...overrides,
  };
}

async function renderImport(latestImports = [] as Array<Record<string, unknown>>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <SisenseTrackSnapshotImport
        artists={artists}
        latestImports={latestImports as never}
      />,
    );
  });
  return { container, root };
}

function controlByLabel<T extends HTMLInputElement | HTMLSelectElement>(container: HTMLElement, label: string): T {
  const labels = [...container.querySelectorAll("label")];
  const matched = labels.find((item) => item.textContent?.trim() === label);
  if (!matched?.htmlFor) throw new Error(`Missing native label: ${label}`);
  const control = container.ownerDocument.getElementById(matched.htmlFor);
  if (!(control instanceof HTMLInputElement) && !(control instanceof HTMLSelectElement)) {
    throw new Error(`Missing control for label: ${label}`);
  }
  return control as T;
}

function setSelect(control: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function setDate(control: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
}

function setFile(control: HTMLInputElement, value: File) {
  Object.defineProperty(control, "files", { configurable: true, value: [value] });
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function primaryButton(container: HTMLElement): HTMLButtonElement | null {
  return container.querySelector("button[data-primary-action]");
}

async function chooseCompleteForm(container: HTMLElement) {
  await act(async () => {
    setSelect(controlByLabel(container, "Artist"), "artist-a");
    setDate(controlByLabel(container, "Reporting from"), "2026-08-01");
    setDate(controlByLabel(container, "Reporting through"), "2026-08-08");
    setSelect(controlByLabel(container, "Aggregation"), "Daily");
    setFile(controlByLabel(container, "Tracks by Growth Rate CSV"), file);
  });
}

async function previewCompleteForm(container: HTMLElement) {
  await chooseCompleteForm(container);
  const button = primaryButton(container);
  expect(button?.textContent).toBe("Preview file");
  await act(async () => button?.click());
}

async function cleanup(container: HTMLElement, root: Root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(File.prototype, "arrayBuffer", {
    configurable: true,
    value(this: File) {
      const contents = this.name === "Replacement.csv"
        ? "track_title,combined_streams\nRed,12"
        : "track_title,combined_streams\nBlue,10";
      return Promise.resolve(new TextEncoder().encode(contents).buffer);
    },
  });
});

afterEach(() => {
  delete (File.prototype as unknown as { arrayBuffer?: () => Promise<ArrayBuffer> }).arrayBuffer;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SisenseTrackSnapshotImport", () => {
  it("previews one fully labelled cumulative snapshot with the exact reporting form", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      expect(container.textContent).toContain(
        "Import one cumulative Tracks by Growth Rate snapshot. The dates describe the reporting context used by Sisense; they are not a stream-period total.",
      );
      expect(primaryButton(container)?.disabled).toBe(true);

      const from = controlByLabel<HTMLInputElement>(container, "Reporting from");
      const through = controlByLabel<HTMLInputElement>(container, "Reporting through");
      const csv = controlByLabel<HTMLInputElement>(container, "Tracks by Growth Rate CSV");
      expect(from.type).toBe("date");
      expect(through.type).toBe("date");
      expect(csv.type).toBe("file");
      expect(csv.accept).toContain(".csv");

      await chooseCompleteForm(container);
      expect(primaryButton(container)?.disabled).toBe(false);
      await act(async () => primaryButton(container)?.click());

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/sisense-track-import",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      );
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect([...form.keys()]).toEqual([
        "action",
        "artist_id",
        "reporting_from",
        "reporting_through",
        "aggregation",
        "file",
      ]);
      expect(form.get("action")).toBe("preview");
      expect(form.get("artist_id")).toBe("artist-a");
      expect(form.get("reporting_from")).toBe("2026-08-01");
      expect(form.get("reporting_through")).toBe("2026-08-08");
      expect(form.get("aggregation")).toBe("Daily");
      expect(form.get("file")).toBe(file);
      expect(container.textContent).toContain("2 unique tracks");
      expect(container.textContent).toContain("2026-08-01 to 2026-08-08");
      expect(container.textContent).toContain("1 exact duplicate");
      expect(container.textContent).toContain("Identity-quality sample");
      expect(container.textContent).toContain("Blue · Blue EP · Matched · source row 2");
      expect(container.textContent).toContain("Showing 2 of 2 identities.");
      expect(container.querySelector("input[type='checkbox']")).toBeNull();
      expect(primaryButton(container)?.textContent).toBe("Import this snapshot");
      expect(primaryButton(container)?.disabled).toBe(false);
      expect(container.querySelectorAll("button[data-primary-action]")).toHaveLength(1);
    } finally {
      await cleanup(container, root);
    }
  });

  it.each([
    ["artist", (container: HTMLElement) => setSelect(controlByLabel(container, "Artist"), "artist-b")],
    ["reporting start", (container: HTMLElement) => setDate(controlByLabel(container, "Reporting from"), "2026-08-02")],
    ["reporting end", (container: HTMLElement) => setDate(controlByLabel(container, "Reporting through"), "2026-08-09")],
    ["aggregation", (container: HTMLElement) => setSelect(controlByLabel(container, "Aggregation"), "Weekly")],
    ["file", (container: HTMLElement) => setFile(controlByLabel(container, "Tracks by Growth Rate CSV"), replacementFile)],
  ])("invalidates the current preview when %s changes", async (_label, mutate) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { status: 200 })));
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      expect(primaryButton(container)?.textContent).toBe("Import this snapshot");

      await act(async () => mutate(container));

      expect(primaryButton(container)?.textContent).toBe("Preview file");
      expect(container.textContent).not.toContain("Preview ready");
    } finally {
      await cleanup(container, root);
    }
  });

  it("requires a preview-bound acknowledgement for unmatched rows and sends the full apply binding", async () => {
    const unmatchedPreview = {
      ...preview,
      previewFingerprint: "c".repeat(64),
      counts: { ...preview.counts, matched: 1, unmatched: 1 },
      identitySamples: {
        ...preview.identitySamples,
        items: [
        preview.identitySamples.items[0],
        {
          ...preview.identitySamples.items[1],
          trackId: null,
          matchStatus: "unmatched",
        },
      ]},
    };
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-a",
      fileName: preview.fileName,
      sha256: preview.sha256,
      rowCount: 3,
      importedAt: "2026-08-11T08:15:00.000Z",
      reportingFrom: preview.reportingFrom,
      reportingThrough: preview.reportingThrough,
      requestedDateRange: preview.requestedDateRange,
      aggregation: preview.aggregation,
      counts: unmatchedPreview.counts,
      totals: preview.totals,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(unmatchedPreview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "imported",
        runId: "run-a",
        inserted: 1,
        updated: 1,
        unchanged: 0,
        latest,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      const acknowledgement = controlByLabel<HTMLInputElement>(
        container,
        "Include 1 unmatched source row in this snapshot",
      );
      expect(acknowledgement.type).toBe("checkbox");
      expect(acknowledgement.checked).toBe(false);
      expect(acknowledgement.required).toBe(true);
      expect(acknowledgement.getAttribute("aria-required")).toBe("true");
      const descriptionId = acknowledgement.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      expect(container.ownerDocument.getElementById(descriptionId ?? "")?.textContent).toContain(
        "This acknowledgement is bound to the current preview hash",
      );
      expect(primaryButton(container)?.disabled).toBe(true);

      await act(async () => acknowledgement.click());
      expect(primaryButton(container)?.disabled).toBe(false);
      await act(async () => primaryButton(container)?.click());

      const form = fetchMock.mock.calls[1][1].body as FormData;
      expect([...form.keys()]).toEqual([
        "action",
        "artist_id",
        "reporting_from",
        "reporting_through",
        "aggregation",
        "file",
        "expected_sha256",
        "expected_preview_fingerprint",
        "include_unmatched",
      ]);
      expect(form.get("action")).toBe("apply");
      expect(form.get("artist_id")).toBe("artist-a");
      expect(form.get("reporting_from")).toBe("2026-08-01");
      expect(form.get("reporting_through")).toBe("2026-08-08");
      expect(form.get("aggregation")).toBe("Daily");
      expect(form.get("file")).toBe(file);
      expect(form.get("expected_sha256")).toBe(fileSha256);
      expect(form.get("expected_preview_fingerprint")).toBe("c".repeat(64));
      expect(form.get("include_unmatched")).toBe("true");
    } finally {
      await cleanup(container, root);
    }
  });

  it("clears an unmatched acknowledgement when a new preview binding is required", async () => {
    const unmatchedPreview = {
      ...preview,
      counts: { ...preview.counts, matched: 1, unmatched: 1 },
      identitySamples: {
        ...preview.identitySamples,
        items: [
        preview.identitySamples.items[0],
        {
          ...preview.identitySamples.items[1],
          trackId: null,
          matchStatus: "unmatched",
        },
      ]},
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(unmatchedPreview), { status: 200 })));
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      const acknowledgement = controlByLabel<HTMLInputElement>(
        container,
        "Include 1 unmatched source row in this snapshot",
      );
      await act(async () => acknowledgement.click());
      expect(acknowledgement.checked).toBe(true);

      await act(async () => setSelect(controlByLabel(container, "Aggregation"), "Weekly"));
      expect(container.querySelector("input[type='checkbox']")).toBeNull();
      expect(primaryButton(container)?.textContent).toBe("Preview file");
    } finally {
      await cleanup(container, root);
    }
  });

  it("shows the total ambiguity count and bounded corrective samples as an alert", async () => {
    const ambiguities = Array.from({ length: 8 }, (_, index) => ({
      identity: `Track ${index + 1} / Release ${index + 1}`,
      sourceRows: [index + 2, index + 12],
      reason: "Multiple catalog tracks match this identity",
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: "Sisense snapshot preview has identity ambiguities",
      ambiguities,
      totalAmbiguityCount: 27,
    }), { status: 409 })));
    const { container, root } = await renderImport();
    try {
      await chooseCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      const alert = container.querySelector("[role='alert']");
      expect(alert?.textContent).toContain("27 ambiguous identities prevent preview");
      expect(alert?.textContent).toContain("Showing 5 corrective samples");
      expect(alert?.textContent).toContain("Track 1 / Release 1");
      expect(alert?.textContent).toContain("Source rows 2, 12");
      expect(alert?.textContent).not.toContain("Track 6 / Release 6");
      expect(primaryButton(container)?.textContent).toBe("Preview file");
    } finally {
      await cleanup(container, root);
    }
  });

  it("locks every form control while preview is pending and restores the single action afterward", async () => {
    let resolvePreview: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolvePreview = resolve; })));
    const { container, root } = await renderImport();
    try {
      await chooseCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
      expect([...container.querySelectorAll("input, select, button")].every((item) => (
        (item as HTMLInputElement | HTMLSelectElement | HTMLButtonElement).disabled
      ))).toBe(true);
      expect(primaryButton(container)?.textContent).toBe("Previewing file…");
      expect(container.querySelectorAll("button[data-primary-action]")).toHaveLength(1);

      await act(async () => resolvePreview?.(new Response(JSON.stringify(preview), { status: 200 })));
      expect(primaryButton(container)?.textContent).toBe("Import this snapshot");
    } finally {
      await cleanup(container, root);
    }
  });

  it("locks every form control and removes competing actions while apply is pending", async () => {
    let resolveApply: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveApply = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("section")?.getAttribute("aria-busy")).toBe("true");
      expect([...container.querySelectorAll("input, select")].every((item) => (
        (item as HTMLInputElement | HTMLSelectElement).disabled
      ))).toBe(true);
      expect(primaryButton(container)).toBeNull();
      expect(container.textContent).toContain("Importing the previewed snapshot…");

      await act(async () => resolveApply?.(new Response(JSON.stringify({ error: "Import unavailable" }), { status: 503 })));
      expect(primaryButton(container)?.textContent).toBe("Preview file");
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders a specific safe server error and survives malformed success and error payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Sisense CSV exceeds 5 MiB" }), { status: 413 }))
      .mockResolvedValueOnce(new Response("not json", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "preview", sha256: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await chooseCompleteForm(container);
      await act(async () => primaryButton(container)?.click());
      expect(container.querySelector("[role='alert']")?.textContent).toContain("Sisense CSV exceeds 5 MiB");

      await act(async () => primaryButton(container)?.click());
      expect(container.querySelector("[role='alert']")?.textContent).toContain("Sisense snapshot import could not be completed");

      await act(async () => primaryButton(container)?.click());
      expect(container.querySelector("[role='alert']")?.textContent).toContain("The server did not return a valid Sisense snapshot preview");
    } finally {
      await cleanup(container, root);
    }
  });

  it("reports an exact duplicate as a no-op and emits only after the successful apply response", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-duplicate",
      fileName: preview.fileName,
      sha256: preview.sha256,
      rowCount: 3,
      importedAt: "2026-08-11T08:15:00.000Z",
      reportingFrom: preview.reportingFrom,
      reportingThrough: preview.reportingThrough,
      requestedDateRange: preview.requestedDateRange,
      aggregation: preview.aggregation,
      counts: preview.counts,
      totals: preview.totals,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "duplicate",
        runId: "run-duplicate",
        latest,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const imported = vi.fn();
    window.addEventListener("sisense-track-snapshot-imported", imported);
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      expect(imported).not.toHaveBeenCalled();
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("[aria-live='polite']")?.textContent).toContain(
        "Duplicate snapshot: no rows were written. The replay matched completed run run-duplicate; the latest evidence shown below remains authoritative.",
      );
      expect(imported).toHaveBeenCalledTimes(1);
      expect((imported.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
        kind: "duplicate",
        runId: "run-duplicate",
      });
    } finally {
      window.removeEventListener("sisense-track-snapshot-imported", imported);
      await cleanup(container, root);
    }
  });

  it("reports imported, updated, and unchanged counts and does not emit after a failed apply", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-imported",
      fileName: preview.fileName,
      sha256: preview.sha256,
      rowCount: 3,
      importedAt: "2026-08-11T08:15:00.000Z",
      reportingFrom: preview.reportingFrom,
      reportingThrough: preview.reportingThrough,
      requestedDateRange: preview.requestedDateRange,
      aggregation: preview.aggregation,
      counts: preview.counts,
      totals: preview.totals,
    };
    const successFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "imported",
        runId: "run-imported",
        inserted: 1,
        updated: 1,
        unchanged: 0,
        latest,
      }), { status: 200 }));
    vi.stubGlobal("fetch", successFetch);
    const imported = vi.fn();
    window.addEventListener("sisense-track-snapshot-imported", imported);
    const first = await renderImport();
    try {
      await previewCompleteForm(first.container);
      await act(async () => primaryButton(first.container)?.click());
      expect(first.container.textContent).toContain(
        "Import completed: 1 imported (inserted), 1 updated, and 0 unchanged rows.",
      );
      expect(imported).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup(first.container, first.root);
    }

    const failedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Metric persistence failed safely" }), { status: 500 }));
    vi.stubGlobal("fetch", failedFetch);
    const second = await renderImport();
    try {
      await previewCompleteForm(second.container);
      await act(async () => primaryButton(second.container)?.click());
      expect(second.container.querySelector("[role='alert']")?.textContent).toContain("Metric persistence failed safely");
      expect(imported).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("sisense-track-snapshot-imported", imported);
      await cleanup(second.container, second.root);
    }
  });

  it("rejects a malformed successful apply payload without emitting or claiming success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "imported",
        runId: "run-malformed",
        inserted: "2",
        updated: 0,
        unchanged: 0,
        latest: {},
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const imported = vi.fn();
    window.addEventListener("sisense-track-snapshot-imported", imported);
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("[role='alert']")?.textContent).toContain(
        "The server did not return a valid Sisense snapshot import result",
      );
      expect(container.textContent).not.toContain("Import completed");
      expect(imported).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("sisense-track-snapshot-imported", imported);
      await cleanup(container, root);
    }
  });

  it.each([
    ["artist", { ...preview, artistId: "artist-b" }],
    ["sanitized file name", { ...preview, fileName: "another-file.csv" }],
    ["file hash", { ...preview, sha256: "f".repeat(64) }],
    ["reporting start", { ...preview, reportingFrom: "2026-07-31" }],
    ["reporting end", { ...preview, reportingThrough: "2026-08-09" }],
    ["canonical reporting range", { ...preview, requestedDateRange: "2026-07-31 to 2026-08-08" }],
    ["aggregation", { ...preview, aggregation: "Weekly" }],
    ["count arithmetic", {
      ...preview,
      counts: { ...preview.counts, matched: 1 },
    }],
    ["identity sample truncation", {
      ...preview,
      identitySamples: { ...preview.identitySamples, items: preview.identitySamples.items.slice(0, 1) },
    }],
    ["unsafe cumulative totals", {
      ...preview,
      totals: { ...preview.totals, combinedStreams: Number.MAX_SAFE_INTEGER + 1 },
    }],
  ])("rejects a preview whose %s is not bound to the submitted workflow", async (_label, responsePreview) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(responsePreview), { status: 200 })));
    const { container, root } = await renderImport();
    try {
      await chooseCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("[role='alert']")?.textContent).toContain(
        "The server did not return a valid Sisense snapshot preview",
      );
      expect(primaryButton(container)?.textContent).toBe("Preview file");
      expect(container.textContent).not.toContain("Preview ready");
    } finally {
      await cleanup(container, root);
    }
  });

  it.each([
    ["latest run", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), runId: "run-other" },
    })],
    ["latest artist", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), artistId: "artist-b" },
    })],
    ["latest file hash", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), sha256: "f".repeat(64) },
    })],
    ["latest date", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), reportingThrough: "2026-08-09" },
    })],
    ["latest aggregation", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), aggregation: "Weekly" },
    })],
    ["latest row count", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: { ...(result.latest as Record<string, unknown>), rowCount: 99 },
    })],
    ["latest count arithmetic", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      latest: {
        ...(result.latest as Record<string, unknown>),
        counts: { ...preview.counts, uniqueTracks: 3 },
      },
    })],
    ["import result count", (result: ReturnType<typeof importedResult>) => ({
      ...result,
      inserted: 2,
      updated: 1,
      unchanged: 0,
    })],
  ])("rejects an apply result whose %s is not bound to the accepted preview", async (_label, mutate) => {
    const result = mutate(importedResult());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const imported = vi.fn();
    window.addEventListener("sisense-track-snapshot-imported", imported);
    const { container, root } = await renderImport();
    try {
      await previewCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      expect(container.querySelector("[role='alert']")?.textContent).toContain(
        "The server did not return a valid Sisense snapshot import result",
      );
      expect(container.textContent).not.toContain("Import completed");
      expect(imported).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("sisense-track-snapshot-imported", imported);
      await cleanup(container, root);
    }
  });

  it("accepts authoritative newer evidence after replaying an older duplicate", async () => {
    const newer = latestFor({
      runId: "run-newer",
      fileName: "Correction.csv",
      sha256: "e".repeat(64),
      rowCount: 4,
      importedAt: "2026-08-12T08:15:00.000Z",
      counts: { sourceRows: 4, uniqueTracks: 3, matched: 3, unmatched: 0, ambiguous: 0, exactDuplicates: 1 },
      totals: { combinedStreams: 60_000, combinedViews: 100 },
    });
    const previouslyListed = latestFor({ runId: "run-listed", importedAt: "2026-08-10T08:15:00.000Z" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        kind: "duplicate",
        runId: "run-older",
        latest: newer,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport([previouslyListed]);
    try {
      await previewCompleteForm(container);
      await act(async () => primaryButton(container)?.click());

      const evidence = container.querySelector("[aria-label='Latest dated Sisense track snapshot imports']");
      expect(evidence?.textContent).toContain(new Date("2026-08-12T08:15:00.000Z").toLocaleString());
      expect(evidence?.textContent).toContain("Correction.csv");
      expect(evidence?.textContent).not.toContain(new Date("2026-08-10T08:15:00.000Z").toLocaleString());
      expect(container.querySelector("[role='alert']")).toBeNull();
    } finally {
      await cleanup(container, root);
    }
  });

  it("hands focus to the new primary action after error, preview, and success", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Review the reporting context" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(importedResult()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await chooseCompleteForm(container);
      await act(async () => primaryButton(container)?.click());
      expect(document.activeElement).toBe(primaryButton(container));
      expect(primaryButton(container)?.textContent).toBe("Preview file");

      await act(async () => primaryButton(container)?.click());
      expect(document.activeElement).toBe(primaryButton(container));
      expect(primaryButton(container)?.textContent).toBe("Import this snapshot");

      await act(async () => primaryButton(container)?.click());
      expect(document.activeElement).toBe(primaryButton(container));
      expect(primaryButton(container)?.textContent).toBe("Preview file");
    } finally {
      await cleanup(container, root);
    }
  });

  it("aborts a pending preview request when the component unmounts", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>(() => undefined);
    }));
    const { container, root } = await renderImport();
    await chooseCompleteForm(container);
    await act(async () => primaryButton(container)?.click());

    await cleanup(container, root);

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
  });

  it("suppresses state and global events when apply completes after unmount", async () => {
    let resolveApply: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveApply = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const imported = vi.fn();
    window.addEventListener("sisense-track-snapshot-imported", imported);
    const { container, root } = await renderImport();
    await previewCompleteForm(container);
    await act(async () => primaryButton(container)?.click());
    await cleanup(container, root);

    await act(async () => {
      resolveApply?.(new Response(JSON.stringify(importedResult()), { status: 200 }));
      await Promise.resolve();
    });

    expect(imported).not.toHaveBeenCalled();
    window.removeEventListener("sisense-track-snapshot-imported", imported);
  });

  it("renders dated latest evidence with artist, file, time, counts, and hash but no private storage location", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-existing",
      fileName: "Tracks-by-Growth-Rate.csv",
      sha256: "d".repeat(64),
      rowCount: 11,
      importedAt: "2026-08-11T08:15:00.000Z",
      reportingFrom: "2026-08-01",
      reportingThrough: "2026-08-08",
      requestedDateRange: "2026-08-01 to 2026-08-08",
      aggregation: "Daily",
      counts: { sourceRows: 11, uniqueTracks: 8, matched: 7, unmatched: 1, ambiguous: 0, exactDuplicates: 3 },
      totals: { combinedStreams: 1000, combinedViews: 200 },
      storageUrl: "https://private.example/secret.csv",
      storageKey: "analytics/sisense/private-secret.csv",
    };
    vi.stubGlobal("fetch", vi.fn());
    const { container, root } = await renderImport([latest]);
    try {
      const evidence = container.querySelector("[aria-label='Latest dated Sisense track snapshot imports']");
      expect(evidence?.textContent).toContain("True Blue");
      expect(evidence?.textContent).toContain("2026-08-01 to 2026-08-08");
      expect(evidence?.textContent).toContain("Daily");
      expect(evidence?.textContent).toContain("Tracks-by-Growth-Rate.csv");
      expect(evidence?.textContent).toContain(new Date(latest.importedAt).toLocaleString());
      expect(evidence?.textContent).toContain("11 source rows");
      expect(evidence?.textContent).toContain("8 unique");
      expect(evidence?.textContent).toContain("7 matched");
      expect(evidence?.textContent).toContain("1 unmatched");
      expect(evidence?.textContent).toContain("3 exact duplicates");
      expect(evidence?.textContent).toContain("dddddddddddd");
      expect(evidence?.textContent).not.toContain("private.example");
      expect(evidence?.textContent).not.toContain("private-secret");
    } finally {
      await cleanup(container, root);
    }
  });
});
