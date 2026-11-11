import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { PitchEditor } from "./PitchEditor";

const meta = {
  title: "Pitches/Follow-up",
  component: PitchEditor,
  beforeEach: () => {
    const original = window.fetch;
    window.fetch = async () => Response.json({ error: "Preview save failed. Your draft is still here." }, { status: 503 });
    return () => { window.fetch = original; };
  },
  args: {
    replyEmail: "reply@example.test", returnToToday: true,
    options: {
      campaignId: "story-campaign", syncId: null, contextTitle: "Low Tide", releaseId: "story-release", contactId: "story-contact",
      configured: false, files: [], releases: [{ id: "story-release", title: "Low Tide" }], contacts: [{ id: "story-contact", name: "Alex Morgan", email: "recipient@example.test" }],
    },
    initial: {
      id: "6948ae24-51ba-4a84-aedb-ed53af8d5f81", org_id: "story-org", campaign_id: "story-campaign", sync_deal_id: null,
      release_id: "story-release", contact_id: "story-contact", task_id: "story-task", version: 1,
      title: "Low Tide — music selection", message: "A selection for your review.", credits: "June Vale", rights_note: "Clearance pending", reply_email: "reply@example.test",
      artist_name: "June Vale", artwork_url: null, remote_project_id: "story-project", recordings: [], downloads: false,
      token: "a".repeat(64), player_id: null, player_embed_id: null, link_state: "revoked", status: "replied", sent_date: "2026-11-01",
      response_note: "Requested an instrumental version.", created_at: new Date("2026-11-01"), updated_at: new Date("2026-11-02"),
      recipient: "Alex Morgan", recipient_email: "recipient@example.test", next_action: "Review the requested version", due_date: "2026-11-12", task_status: "todo", public_path: null,
    },
  },
} satisfies Meta<typeof PitchEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReturnFromToday: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: /Back to Today/ })).toHaveAttribute("href", "/today#today-tasks");
    await expect(canvas.getByRole("link", { name: "Manage the follow-up in Tasks" })).toHaveAttribute("href", "/ops-tasks?task=story-task");
    await userEvent.selectOptions(canvas.getByRole("combobox", { name: "Status" }), "closed");
    await expect(canvas.getByText(/Saving a closed pitch completes its follow-up task/)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Save follow-up" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Preview save failed");
    await expect(canvas.getByLabelText("Response / internal notes")).toHaveValue("Requested an instrumental version.");
  },
};
