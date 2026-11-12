import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor } from "storybook/test";
import correctionMeta from "./ReleaseWorkspace.stories";
import { ReleaseWorkspace } from "./ReleaseWorkspace";

// Short, synthetic PCM tone: no provider credentials or private music in Storybook.
function tone(frequency: number) {
  const rate = 8000, samples = rate * 8;
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((char, i) => bytes[offset + i] = char.charCodeAt(0));
  text(0, "RIFF"); view.setUint32(4, bytes.length - 8, true); text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.sin(i * frequency * Math.PI * 2 / rate) * 500, true);
  return `data:audio/wav;base64,${btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))}`;
}

const inventory = ["Selected take", "Alternative take", "Unmapped demo"].map((name, i) => ({
  id: `file-${i}`, trackId: null, trackTitle: null, position: null, version: `v${i + 1}`,
  remoteBoxId: `file-${i}`, remoteStackId: i < 2 ? "stack" : null, fileName: `${name}.wav`,
  duration: 8, audioUrl: tone(220 + i * 110), syncStatus: "unmatched", lastSyncedAt: null,
}));

const meta = {
  title: "Releases/Samply streaming",
  component: ReleaseWorkspace,
  parameters: { layout: "padded", docs: { description: { component: "Real release player with fictional recordings and quiet synthetic tones. Comments are simulated. This verifies browser playback, not Samply availability or master approval." } } },
  args: {
    ...correctionMeta.args, initialSearch: "?section=tracks", canManage: false,
    tracks: [{ ...correctionMeta.args.tracks[0], audio_url: inventory[0].audioUrl }],
    samplyReview: { project: { id: "project", remoteProjectId: "demo", remoteProjectName: "Low Tide sessions", uploadEnabled: false, primaryPlayerId: null }, player: null, fileCount: inventory.length, inventory, lastSyncedAt: null, artworkUrl: null },
  },
  beforeEach: () => {
    const originalFetch = window.fetch;
    const originalUrl = window.location.href;
    const url = new URL(originalUrl); url.searchParams.set("section", "tracks"); url.hash = "";
    window.history.replaceState(null, "", url);
    window.fetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (target.protocol === "data:" || target.origin === "http://localhost:4747") return originalFetch(input, init);
      if (target.origin === window.location.origin && /^\/api\/releases\/story-release\/samply\/files\/file-[0-2]\/comments$/.test(target.pathname)) {
        return Response.json({ comments: [{ id: "comment", message: "Check the transition", audioTimestamp: 3, completed: false }] });
      }
      return Response.json({ error: "Only fictional playback and comments are enabled." }, { status: 403 });
    };
    return () => { window.fetch = originalFetch; window.history.replaceState(null, "", originalUrl); };
  },
} satisfies Meta<typeof ReleaseWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Browse: Story = {};
export const PlayAndSwitch: Story = {
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Review Low Tide" }));
    const audio = () => canvasElement.querySelector("audio")!;
    // Storybook clicks are synthetic; the route acceptance uses trusted browser clicks for playback.
    await waitFor(() => expect(audio().readyState).toBe(4));
    await expect(audio().getAttribute("src")).toBe(inventory[0].audioUrl);
    await userEvent.click(canvas.getByRole("button", { name: "Jump to comment at 0:03" }));
    await waitFor(() => expect(audio().currentTime).toBeGreaterThanOrEqual(3));
    await userEvent.click(canvas.getByRole("button", { name: "v2", exact: true }));
    await expect(audio().getAttribute("src")).toBe(inventory[1].audioUrl);
    await userEvent.click(canvas.getByRole("button", { name: "Samply recordings (3)" }));
    await userEvent.click(canvas.getByRole("button", { name: "Play Unmapped demo.wav" }));
    await expect(audio().getAttribute("src")).toBe(inventory[2].audioUrl);

    await userEvent.click(canvas.getAllByRole("button", { name: "Close reviewer" })[0]);
    await expect(canvasElement.querySelector("audio")).toBeNull();
  },
};
