import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArtistWorkspace } from "./ArtistWorkspace";
import { expect, userEvent } from "storybook/test";

const meta = {
  title: "Artists/Workspace",
  component: ArtistWorkspace,
  args: {
    artist: { id: "story-artist", name: "June Vale", relationship: "roster" },
    releases: [], assets: [], campaigns: [], documents: [], rights: [], tasks: [],
    primaryContact: null, contactOptions: [], canMutate: false,
  },
} satisfies Meta<typeof ArtistWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithReleases: Story = {
  args: {
    releases: [
      { id: "story-release-1", title: "Hollow River", format: "EP", status: "draft", release_date: "2026-11-14" },
      { id: "story-release-2", title: "Mallow & Ash", format: "Single", status: "released", release_date: "2026-06-12", release_ready: true },
    ],
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("tab", { name: "Releases" }));
    await expect(canvas.getByRole("link", { name: /Hollow River/ })).toHaveAttribute("href", "/releases/story-release-1");
    await userEvent.click(canvas.getByRole("tab", { name: "Overview" }));
    await expect(canvas.getByRole("link", { name: /Hollow River/ })).toBeVisible();
  },
};
export const EditProfile: Story = { args: { canMutate: true, initialFocusField: "pro" } };
export const Images: Story = { args: { canMutate: true, initialTab: "visuals" } };
export const Team: Story = {
  args: {
    initialTab: "team",
    primaryContact: { id: "story-contact", name: "June Vale", role: "Artist" },
    rights: [{ id: "story-right", contact_id: "story-collaborator", contact_name: "Eli Moss", role: "Producer", work_id: "story-work", work_title: "Hollow River" }],
  },
};
export const AnalyticsAwaitingConnection: Story = { args: { initialTab: "analytics" } };
export const RightsByWork: Story = {
  args: {
    initialTab: "rights",
    rights: [
      { id: "story-right-1", work_id: "story-work", work_title: "Hollow River", contact_name: "June Vale", role: "Songwriter", scope: "Publishing", percent_share: 60, clearance_status: "confirmed" },
      { id: "story-right-2", work_id: "story-work", work_title: "Hollow River", contact_name: "Eli Moss", role: "Songwriter", scope: "Publishing", percent_share: 40, clearance_status: "pending" },
    ],
  },
  play: async ({ canvas }) => {
    await expect(canvas.queryByText("60% - confirmed")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Hollow River/ }));
    await expect(canvas.getByText("60% - confirmed")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Open work and edit rights" })).toHaveAttribute("href", "/works/story-work");
  },
};
