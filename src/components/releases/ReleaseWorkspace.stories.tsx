import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import { ReleaseWorkspace } from "./ReleaseWorkspace";
import type { ReleaseReadinessSnapshot } from "../../server/release-correction";

const snapshot: ReleaseReadinessSnapshot = {
  release: {
    id: "story-release", title: "Low Tide", updated_at: "2026-11-03T12:00:00.000Z",
    cover_art_url: new URL("../../../public/favicon.svg?no-inline", import.meta.url).href, upc_ean: null, release_date: "2026-12-04", format: "single",
  },
  readiness: { isReady: false, missing: ["UPC/EAN"] },
  observed_at: "2026-11-03T12:00:00.000Z",
};

const meta = {
  title: "Releases/Correction workflow",
  component: ReleaseWorkspace,
  parameters: {
    layout: "padded",
    docs: { description: { component: "Actual release workspace with fictional records. Only the UPC correction is simulated in memory; other API requests are rejected. Reloading resets the example. This does not verify backend persistence." } },
  },
  args: {
    release: { ...snapshot.release, artist_name: "June Vale", status: "draft", release_ready: false },
    readiness: snapshot,
    tracks: [{ id: "story-track", title: "Low Tide", release_id: "story-release", work_id: "story-work", position: 1, duration: 192, track_ready: true, clearance_pub: 1, clearance_master: 1 }],
    budgetItems: [], pitches: [], works: [{ id: "story-work", title: "Low Tide", isrc: null }], artists: [],
    cockpit: null, samplyReview: null, canManage: true, timeline: null,
    parentReleases: [], campaigns: [], documents: [], mediaAssets: [],
  },
  beforeEach: ({ parameters }) => {
    const originalFetch = window.fetch;
    const originalUrl = window.location.href;
    let current = structuredClone(snapshot);
    const url = new URL(originalUrl);
    url.searchParams.delete("section");
    url.searchParams.delete("focus");
    url.hash = "";
    window.history.replaceState(null, "", url);
    window.fetch = async (input, init) => {
      const request = input instanceof Request
        ? new Request(input, init)
        : new Request(new URL(input, window.location.href), init);
      const target = new URL(request.url);
      // Agentation is a deliberate local development connection, not app data.
      if (target.origin === "http://localhost:4747") return originalFetch(input, init);
      if (target.origin !== window.location.origin || target.pathname !== "/api/releases/story-release/readiness") {
        return Response.json({ error: "This action is not enabled in the fictional release story." }, { status: 403 });
      }
      if (request.method === "GET") return Response.json(current);
      if (request.method !== "PUT") return Response.json({ error: "Unsupported story action" }, { status: 405 });
      if (parameters.saveFails) return Response.json({ error: "Simulated save failure. Compare the latest record before retrying." }, { status: 503 });
      const body = await request.json();
      if (body.field !== "upc_ean" || !body.value) return Response.json({ error: "Use the UPC/EAN correction for this trial." }, { status: 400 });
      current = { ...current, release: { ...current.release, upc_ean: body.value, updated_at: "2026-11-03T12:01:00.000Z" }, readiness: { isReady: true, missing: [] }, observed_at: "2026-11-03T12:01:00.000Z" };
      return Response.json({ ok: true, ...current });
    };
    return () => {
      window.fetch = originalFetch;
      window.history.replaceState(null, "", originalUrl);
    };
  },
} satisfies Meta<typeof ReleaseWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

// A manual entry point stays at the initial state for visual review/Builder.
export const Review: Story = {};

export const CorrectAndConfirm: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("button", { name: "Edit Low Tide" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Review checks" }));
    const trigger = canvas.getByRole("button", { name: "Correct UPC/EAN" });
    await userEvent.click(trigger);
    const input = canvas.getByRole("textbox", { name: "UPC/EAN" });
    await waitFor(() => expect(input).toHaveFocus());
    await userEvent.type(input, "123456789012");
    await userEvent.click(canvas.getByRole("button", { name: "Save UPC/EAN" }));
    await expect(await canvas.findByText("UPC/EAN saved. Release checks pass.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Close correction" }));
    await waitFor(() => expect(trigger).toHaveFocus());
    await expect(canvas.getByRole("heading", { name: "Required release checks pass" })).toBeVisible();
  },
};

export const SaveFailure: Story = {
  parameters: { saveFails: true },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Review checks" }));
    await userEvent.click(canvas.getByRole("button", { name: "Correct UPC/EAN" }));
    const input = canvas.getByRole("textbox", { name: "UPC/EAN" });
    await userEvent.type(input, "123456789012");
    await userEvent.click(canvas.getByRole("button", { name: "Save UPC/EAN" }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Your correction is retained.");
    await expect(input).toHaveValue("123456789012");
    await expect(canvas.getByRole("button", { name: "Save UPC/EAN" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Compare latest record" })).toBeEnabled();
  },
};

export const ReadOnly: Story = {
  args: { canManage: false },
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("button", { name: "Edit Low Tide" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Review checks" }));
    await userEvent.click(canvas.getByRole("button", { name: "Inspect UPC/EAN" }));
    await expect(canvas.getByText(/You have read-only access/)).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Save UPC/EAN" })).not.toBeInTheDocument();
  },
};
