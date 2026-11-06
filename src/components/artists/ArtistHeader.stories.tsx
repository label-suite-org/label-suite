import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent } from "storybook/test";
import { ArtistHeader } from "./ArtistWorkspace";

const meta = {
  title: "Existing website/Artist header",
  component: ArtistHeader,
  parameters: {
    docs: { description: { component: "The header used by ArtistWorkspace on /artists/[id]. Its markup, styles and actions are shared with the website. These neutral values demonstrate states; they are not a separate artist or proposed redesign." } },
  },
  args: {
    artist: { id: "preview-artist", name: "Artist name" },
    heroImageLink: null,
    relationshipDetail: "Signed to the label",
    releaseCount: 0,
    profileComplete: 0,
  },
} satisfies Meta<typeof ArtistHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReadOnly: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.queryByRole("link", { name: "Sync deals" })).not.toBeInTheDocument();
  },
};
export const Editable: Story = {
  args: { canMutate: true, onManageImages: fn() },
  play: async ({ canvas, args }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Add artist image" }));
    await expect(args.onManageImages).toHaveBeenCalledOnce();
    await expect(canvas.getByRole("button", { name: "Edit Artist name" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Sync deals" })).toHaveAttribute("href", "/sync?artist=preview-artist");
  },
};
