import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { ReleaseTimeline } from "./ReleaseTimeline";
import { buildReleaseTimeline } from "../../server/release-timeline-core";

const timeline = buildReleaseTimeline({ releaseDate: "2026-12-04", today: "2026-11-11", budgetItems: [], milestones: [], tasks: [
  { id: "story-delivery", revision: 1, title: "Deliver Low Tide", phase: "distribution_dsp", dueDate: "2026-11-06", owner: "June Vale", status: "todo", priority: "P1", milestoneId: null },
] });
const meta = {
  title: "Releases/Task rescheduling",
  component: ReleaseTimeline,
  args: { releaseId: "story-release", canManage: true, timeline, initialTaskId: "story-delivery", returnToToday: true },
  beforeEach: () => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? new Request(input, init) : new Request(new URL(input, window.location.href), init);
      const path = new URL(request.url).pathname;
      if (path === "/api/release-milestones") return Response.json(timeline);
      if (path === "/api/calendar") return Response.json({ configured: false, connected: false, enabled: false, links: [] });
      return Response.json({ error: "Preview save failed. Your deadline is still here." }, { status: 503 });
    };
    return () => { window.fetch = original; };
  },
} satisfies Meta<typeof ReleaseTimeline>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FromToday: Story = {};
export const RetainedDeadline: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByLabelText("Title")).toHaveValue("Deliver Low Tide");
    await expect(canvas.getByRole("link", { name: /Back to Today/ })).toHaveAttribute("href", "/today#today-tasks");
    await userEvent.click(canvas.getByRole("button", { name: "Save", exact: true }));
    await expect(await canvas.findByRole("alert")).toHaveTextContent("Preview save failed");
    await expect(canvas.getByLabelText("Deadline")).toHaveValue("2026-11-06");
  },
};
