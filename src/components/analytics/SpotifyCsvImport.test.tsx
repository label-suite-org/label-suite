/* @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SpotifyCsvImport from "./SpotifyCsvImport";

const artists = [{ id: "artist-a", name: "True Blue" }];
const file = new File(["date,streams\n2024-01-01,1"], "audience.csv", { type: "text/csv" });
const preview = {
  kind: "preview",
  artistId: "artist-a",
  fileName: "audience.csv",
  sha256: "a".repeat(64),
  byteSize: 1234,
  rowCount: 908,
  dateFrom: "2024-01-01",
  dateThrough: "2026-06-26",
  canonicalRange: "2024-01-01 to 2026-06-26",
};

async function renderImport(latestImports = [] as Array<Record<string, string | number>>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SpotifyCsvImport artists={artists} latestImports={latestImports as never} />);
  });
  return { container, root };
}

function chooseArtistAndFile(container: HTMLDivElement) {
  const select = container.querySelector("select") as HTMLSelectElement;
  const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
  select.value = "artist-a";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
}

async function cleanup(container: HTMLDivElement, root: Root) {
  await act(async () => root.unmount());
  container.remove();
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SpotifyCsvImport", () => {
  it("previews the selected Audience timeline export before enabling import", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      expect(previewButton.disabled).toBe(true);
      expect(container.querySelector("button[data-action='apply']")).toBeNull();

      await act(async () => {
        chooseArtistAndFile(container);
      });
      expect(previewButton.disabled).toBe(false);

      await act(async () => previewButton.click());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/analytics/spotify-import",
        expect.objectContaining({ method: "POST", credentials: "same-origin" }),
      );
      const form = fetchMock.mock.calls[0][1].body as FormData;
      expect(form.get("action")).toBe("preview");
      expect(form.get("artist_id")).toBe("artist-a");
      expect(form.get("file")).toBeInstanceOf(File);
      expect(container.textContent).toContain("908 daily rows");
      expect(container.textContent).toContain("2024-01-01 to 2026-06-26");
      expect(container.querySelector("button[data-action='apply']")).not.toBeNull();
      expect(container.textContent).toContain("Spotify for Artists — Audience timeline");
    } finally {
      await cleanup(container, root);
    }
  });

  it("invalidates a preview when the operator changes artist", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      expect(container.querySelector("button[data-action='apply']")).not.toBeNull();

      const select = container.querySelector("select") as HTMLSelectElement;
      await act(async () => {
        select.value = "";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(container.querySelector("button[data-action='apply']")).toBeNull();
      expect(previewButton.disabled).toBe(true);
    } finally {
      await cleanup(container, root);
    }
  });

  it("invalidates a preview when the operator changes file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(preview), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      expect(container.querySelector("button[data-action='apply']")).not.toBeNull();

      const fileInput = container.querySelector("input[type='file']") as HTMLInputElement;
      const replacement = new File(["replacement"], "replacement.csv", { type: "text/csv" });
      await act(async () => {
        Object.defineProperty(fileInput, "files", { configurable: true, value: [replacement] });
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(container.querySelector("button[data-action='apply']")).toBeNull();
    } finally {
      await cleanup(container, root);
    }
  });

  it("applies the preview hash and renders truthful duplicate evidence", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-1",
      fileName: "audience.csv",
      sha256: "a".repeat(64),
      rowCount: 908,
      importedAt: "2026-08-10T10:00:00.000Z",
      reportingThrough: "2026-06-26",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "duplicate", runId: "run-1", reportingThrough: "2026-06-26", latest }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      const apply = container.querySelector("button[data-action='apply']") as HTMLButtonElement;
      await act(async () => apply.click());

      const form = fetchMock.mock.calls[1][1].body as FormData;
      expect(form.get("action")).toBe("apply");
      expect(form.get("expected_sha256")).toBe("a".repeat(64));
      expect(container.textContent).toContain("already imported");
      expect(container.textContent).not.toContain("Imported 908 new rows");
      expect(container.textContent).toContain("True Blue");
      expect(container.textContent).toContain("Reporting through: 2026-06-26");
      expect(container.textContent).toContain("audience.csv");
      expect(container.textContent).toContain("908 rows");
      expect(container.textContent).toContain(new Date(latest.importedAt).toLocaleString());
      expect(container.textContent).toContain("aaaaaaaaaaaa");
      expect(container.textContent).not.toContain("http");
      expect(container.textContent).not.toContain("Sisense");
    } finally {
      await cleanup(container, root);
    }
  });

  it("renders inserted, updated, and unchanged row counts after an applied import", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-2",
      fileName: "audience.csv",
      sha256: "a".repeat(64),
      rowCount: 908,
      importedAt: "2026-08-10T10:00:00.000Z",
      reportingThrough: "2026-06-26",
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ kind: "imported", runId: "run-2", inserted: 7, updated: 8, unchanged: 893, reportingThrough: "2026-06-26", latest }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      await act(async () => (container.querySelector("button[data-action='apply']") as HTMLButtonElement).click());
      expect(container.textContent).toContain("7 inserted");
      expect(container.textContent).toContain("8 updated");
      expect(container.textContent).toContain("893 unchanged rows");
    } finally {
      await cleanup(container, root);
    }
  });

  it("keeps controls busy during requests and exposes server validation as an alert", async () => {
    let resolvePreview: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolvePreview = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      expect(previewButton.disabled).toBe(true);
      expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
      expect((container.querySelector("input[type='file']") as HTMLInputElement).disabled).toBe(true);

      await act(async () => resolvePreview?.(new Response(JSON.stringify({ error: "CSV headers are not supported" }), { status: 415 })));
      const alert = container.querySelector("[role='alert']");
      expect(alert?.textContent).toContain("CSV headers are not supported");
      expect(previewButton.disabled).toBe(false);
    } finally {
      await cleanup(container, root);
    }
  });

  it("keeps every import control locked while apply is pending", async () => {
    const latest = {
      artistId: "artist-a",
      artistName: "True Blue",
      runId: "run-3",
      fileName: "audience.csv",
      sha256: "a".repeat(64),
      rowCount: 908,
      importedAt: "2026-08-10T10:00:00.000Z",
      reportingThrough: "2026-06-26",
    };
    let resolveApply: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(preview), { status: 200 }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveApply = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    const { container, root } = await renderImport();
    try {
      await act(async () => chooseArtistAndFile(container));
      const previewButton = [...container.querySelectorAll("button")].find((button) => button.textContent === "Preview file") as HTMLButtonElement;
      await act(async () => previewButton.click());
      const applyButton = container.querySelector("button[data-action='apply']") as HTMLButtonElement;
      await act(async () => applyButton.click());

      expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
      expect((container.querySelector("input[type='file']") as HTMLInputElement).disabled).toBe(true);
      expect(previewButton.disabled).toBe(true);
      expect(container.querySelector("button[data-action='apply']")).toBeNull();
      expect(container.textContent).toContain("Request in progress. File and artist selection are locked.");
      expect(container.textContent).toContain("Importing the previewed file…");

      await act(async () => resolveApply?.(new Response(JSON.stringify({ kind: "duplicate", runId: "run-3", reportingThrough: "2026-06-26", latest }), { status: 200 })));
    } finally {
      await cleanup(container, root);
    }
  });
});
