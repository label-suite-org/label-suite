import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { ReleaseHeader } from "./ReleaseWorkspace";

const meta = {
  title: "Existing website/Release header",
  component: ReleaseHeader,
  parameters: { docs: { description: { component: "The identity, artwork review and actions used by ReleaseWorkspace on /releases/[id]. Same component and tokens as the website. Neutral data; saving is disconnected." } } },
  args: {
    release: { id: "preview-release", title: "Release title", artist_name: "Artist name", format: "EP", status: "draft", release_ready: false },
    onOpenCover: fn(),
  },
  beforeEach: () => {
    const original = window.fetch;
    window.fetch = async () => Response.json({ error: "Saving is disconnected in this reference." }, { status: 403 });
    return () => { window.fetch = original; };
  },
} satisfies Meta<typeof ReleaseHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Editable: Story = {
  args: { canManage: true },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Review release cover" }));
    await expect(args.onOpenCover).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("button", { name: "Edit Release title" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Sync deals" })).toHaveAttribute("href", "/sync?release=preview-release");
  },
};
export const ReadOnly: Story = {
  args: { release: { ...meta.args.release, release_ready: true } },
  play: async ({ canvas, args }) => {
    await expect(canvas.queryByRole("button", { name: "Edit Release title" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("link", { name: "Sync deals" })).not.toBeInTheDocument();
    await expect(canvas.getByText("Ready", { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Review release cover" }));
    await expect(args.onOpenCover).toHaveBeenCalledOnce();
  },
};
