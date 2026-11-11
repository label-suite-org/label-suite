import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { ArtistCreateDialog } from "../artists/ArtistCreateDialog";
import { ArtistRoster } from "../artists/ArtistRoster";
import { ReleaseRoster } from "../releases/ReleaseRoster";
import { WorksList } from "../works/WorksList";
import { ReleaseCreateDialog } from "../releases/ReleaseCreateDialog";
import { ReleaseForm } from "../releases/ReleaseForm";
import { TrackEditorWorkspace } from "../tracks/TrackEditorWorkspace";
import { WorkClearanceWorkspace } from "../works/WorkClearanceWorkspace";
import { WorkForm } from "../works/WorkForm";
import { WorkCreateDialog } from "../works/WorkActionButtons";
import type { ArtistRosterRow } from "../../server/artists";
import type { ReleaseRosterRow } from "../../server/releases";
import type { WorkPriorityRow } from "../../server/works";

const meta = {
  title: "Catalog/Working views",
  beforeEach: () => {
    const originalUrl = window.location.href;
    const originalFetch = window.fetch;
    const url = new URL(originalUrl);
    for (const key of ["q", "filter", "relationship", "sort", "view"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", url);
    window.fetch = async (input, init) => {
      const target = new URL(input instanceof Request ? input.url : input, window.location.href);
      if (target.origin === "http://localhost:4747") return originalFetch(input, init);
      return Response.json({ error: "Preview save failed. Your draft is still here." }, { status: 503 });
    };
    return () => {
      window.history.replaceState(null, "", originalUrl);
      window.fetch = originalFetch;
    };
  },
  parameters: { docs: { description: { component: "Actual Catalog lists and forms using the shared component baseline. Fictional records; save attempts fail locally without sending mutations. Identity and the next useful action stay visible, while evidence and metadata open through disclosures." } } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const artist: ArtistRosterRow = {
  id: "story-artist", name: "June Vale", relationship: "roster", contact_id: null,
  image_url: null, bio: null, spotify_id: null, spotify_followers: null, spotify_popularity: null,
  pro: null, ipi: null, instagram: null, tiktok: null, release_count: 1, campaign_count: 1,
  open_task_count: 0, next_release_id: "story-release", next_release_title: "Low Tide",
  next_release_date: "2027-03-01", next_release_status: "draft", next_release_cover_art_url: null,
  latest_release_id: null, latest_release_title: null, latest_release_date: null,
  latest_release_cover_art_url: null, missing_profile_fields: [],
};
const release: ReleaseRosterRow = {
  id: "story-release", title: "Low Tide", artist_id: artist.id, artist_name: artist.name,
  parent_release_id: null, format: "EP", status: "draft", delivery_status: null,
  release_date: "2027-03-01", upc_ean: null, cover_art_url: null, catalog_number: "JV001",
  catalog_number_locked: false, release_ready: false, release_missing: "UPC/EAN, Cover art",
  track_count: 4, ready_track_count: 2, audio_ready_count: 4, isrc_ready_count: 2,
  avg_clearance: 50, pitch_count: 0, sent_pitch_count: 0, approved_pitch_count: 0,
  budget_item_count: 0, budget_planned: 0, budget_committed: 0, budget_paid: 0,
  missing_release_fields: ["UPC/EAN", "Cover art"],
};
const work: WorkPriorityRow = {
  id: "story-work", title: "Low Tide", artistNames: artist.name, releaseTitles: release.title,
  isrc: null, iswc: null, genre: null, audio_url: null, duration: null, trackCount: 1,
  releaseStatuses: "released", latestReleaseDate: "2026-06-01", pubRoleCount: 1,
  masterRoleCount: 1, creditCount: 2, pubProgress: 100, masterProgress: 50,
  pubEntered: 100, masterEntered: 100, pendingRoleCount: 1, releasedTrackCount: 1,
  activeReleaseCount: 0, payoutRows: 2, payoutNet: 240, isUnknown: false, priorityScore: 10,
};

export const Artists: Story = {
  render: () => <ArtistRoster artists={[artist, { ...artist, id: "story-collaborator", name: "Eli Moss", relationship: "collaborator", airtable_record_id: "story-mapping", release_count: 0, next_release_id: null, next_release_title: null }]} canMutate={false} />,
  play: async ({ canvasElement, canvas }) => {
    await expect(canvas.getByRole("link", { name: "Low Tide" })).toHaveAttribute("href", "/releases/story-release");
    await userEvent.click(canvas.getByRole("combobox", { name: "Filter artists by relationship" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Collaborators" }));
    await expect(canvas.queryByRole("link", { name: "June Vale" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Details for Eli Moss" }));
    await expect(canvas.getByText("Evidence: Label Suite current value · Airtable mapping story-mapping")).toBeVisible();
    await expect(canvas.queryByRole("button", { name: /Edit Eli/ })).not.toBeInTheDocument();
  },
};
export const Comparison: Story = {
  render: () => <ArtistRoster artists={[artist]} canMutate={false} />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Compare" }));
    await expect(canvas.getByRole("table")).toBeVisible();
    await expect(canvas.getByRole("columnheader", { name: "Audience" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Low Tide" })).toHaveAttribute("href", "/releases/story-release");
  },
};
export const Releases: Story = {
  render: () => <ReleaseRoster releases={[release]} artists={[artist]} canMutate={false} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Low Tide" })).toHaveAttribute("href", "/releases/story-release");
    await userEvent.click(canvas.getByRole("button", { name: "Details for Low Tide" }));
    await expect(canvas.getByText(/2 of 4 tracks ready/)).toBeVisible();
  },
};
export const Works: Story = {
  render: () => <WorksList works={[work, { ...work, id: "story-cleared", title: "Open Water", masterProgress: 100, payoutRows: 0, payoutNet: 0, priorityScore: 0 }]} canMutate={false} />,
  play: async ({ canvasElement, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "Show all blocked" }));
    await expect(canvas.getByRole("combobox", { name: "Filter works" })).toHaveTextContent("Payout blocked (1)");
    await userEvent.click(canvas.getByRole("button", { name: "Clearance & details for Low Tide" }));
    await expect(canvas.getByRole("link", { name: "Open rights editor" })).toHaveAttribute("href", "/works/story-work");
    await expect(canvas.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("combobox", { name: "Filter works" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Cleared (1)" }));
    await expect(canvas.getByRole("link", { name: "Open Water" })).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Low Tide" })).not.toBeInTheDocument();
  },
};
export const ReleaseEditor: Story = {
  render: () => <div className="max-w-lg"><ReleaseForm initial={{ ...release, id: "story-single", title: "First Light", format: "single", parent_release_id: release.id }} artists={[artist]} parentReleases={[release]} onClose={() => {}} /></div>,
  play: async ({ canvasElement, canvas }) => {
    const parent = canvas.getByRole("combobox", { name: "Part of an EP rollout" });
    await expect(parent).toHaveTextContent("Low Tide (EP)");
    const format = canvas.getByRole("combobox", { name: "Format" });
    await userEvent.click(format);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "EP" }));
    await expect(canvas.queryByRole("combobox", { name: "Part of an EP rollout" })).not.toBeInTheDocument();
    await userEvent.click(format);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Single" }));
    await expect(canvas.getByRole("combobox", { name: "Part of an EP rollout" })).toHaveTextContent("Independent release");
  },
};
export const CreateRelease: Story = {
  render: () => <ReleaseCreateDialog artists={[artist]} parentReleases={[release]} />,
  play: async ({ canvasElement, canvas }) => {
    const trigger = canvas.getByRole("button", { name: "New Release" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole("dialog")).toBeVisible());
    await expect(body.getByRole("textbox", { name: "Title *" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const WorkEditor: Story = {
  render: () => <div className="max-w-lg"><WorkForm initial={work} onClose={() => {}} /></div>,
};

export const WorkList: Story = {
  render: () => <WorksList works={[work, { ...work, id: "story-long-work", title: "A work with a long title that still needs to be readable on a phone", payoutRows: 0, payoutNet: 0 }]} />,
};
export const EmptyWorks: Story = { render: () => <WorksList works={[]} /> };
export const ClearWorkFilters: Story = {
  render: () => <WorksList works={[{ ...work, pubProgress: 100, masterProgress: 100, priorityScore: 0, payoutRows: 0, payoutNet: 0 }]} canMutate={false} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("No works match this view.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByRole("link", { name: work.title })).toBeVisible();
    await expect(canvas.getByRole("combobox", { name: "Filter works" })).toHaveTextContent("All (1)");
  },
};
export const CreateWork: Story = {
  render: () => <WorkCreateDialog />,
  play: async ({ canvasElement, canvas }) => {
    const trigger = canvas.getByRole("button", { name: "New Work" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole("textbox", { name: "Work Title *" })).toHaveFocus());
    await userEvent.type(body.getByRole("textbox", { name: "Work Title *" }), "Cancelled draft");
    await userEvent.click(body.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    await userEvent.click(trigger);
    await expect(body.getByRole("textbox", { name: "Work Title *" })).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const WorkSaveFailure: Story = {
  render: () => <WorkCreateDialog />,
  play: async ({ canvasElement, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "New Work" }));
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(body.getByRole("textbox", { name: "Work Title *" }), "Retained work draft");
    await userEvent.type(body.getByRole("textbox", { name: "Genre" }), "Indie pop");
    await userEvent.click(body.getByRole("button", { name: "Create Work" }));
    await expect(await body.findByRole("alert")).toHaveTextContent("Preview save failed. Your draft is still here.");
    await expect(body.getByRole("textbox", { name: "Work Title *" })).toHaveValue("Retained work draft");
    await expect(body.getByRole("textbox", { name: "Genre" })).toHaveValue("Indie pop");
  },
};

// Manual review states render the exact list and dialog components used by the routes.
export const ArtistList: Story = {
  render: () => <ArtistRoster artists={[artist, { ...artist, id: "story-long-artist", name: "An artist with a long name that still needs to be readable on a phone", relationship: "collaborator" }]} />,
};
export const ReleaseList: Story = {
  render: () => <ReleaseRoster releases={[release, { ...release, id: "story-long-release", title: "A release with a long title that still needs to be readable on a phone", status: "in_production" }]} artists={[artist]} />,
};
export const EmptyArtists: Story = { render: () => <ArtistRoster artists={[]} /> };
export const EmptyReleases: Story = { render: () => <ReleaseRoster releases={[]} artists={[]} /> };
export const ClearArtistFilters: Story = {
  render: () => <ArtistRoster artists={[artist]} canMutate={false} />,
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search artists" }), "No matching name");
    await expect(canvas.getByText("No artists match this view.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByRole("link", { name: artist.name })).toBeVisible();
  },
};
export const ClearReleaseFilters: Story = {
  render: () => <ReleaseRoster releases={[release]} artists={[artist]} canMutate={false} />,
  play: async ({ canvas }) => {
    await userEvent.type(canvas.getByRole("textbox", { name: "Search releases" }), "No matching title");
    await expect(canvas.getByText("No releases match this catalog view.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Clear filters" }));
    await expect(canvas.getByRole("link", { name: release.title })).toBeVisible();
  },
};
export const CreateArtist: Story = {
  render: () => <ArtistCreateDialog />,
  play: async ({ canvasElement, canvas }) => {
    const trigger = canvas.getByRole("button", { name: "New Artist" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() => expect(body.getByRole("dialog")).toBeVisible());
    await waitFor(() => expect(body.getByRole("textbox", { name: "Name *" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const ArtistSaveFailure: Story = {
  render: () => <ArtistCreateDialog />,
  play: async ({ canvasElement, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "New Artist" }));
    const body = within(canvasElement.ownerDocument.body);
    const name = await body.findByRole("textbox", { name: "Name *" });
    await userEvent.type(name, "Draft artist");
    await userEvent.click(body.getByRole("button", { name: "Create Artist" }));
    await expect(await body.findByRole("alert")).toHaveTextContent("Your draft is still here.");
    await expect(name).toHaveValue("Draft artist");
    await expect(body.getByRole("button", { name: "Create Artist" })).toBeEnabled();
  },
};
export const ReleaseSaveFailure: Story = {
  render: () => <ReleaseCreateDialog artists={[artist]} parentReleases={[release]} />,
  play: async ({ canvasElement, canvas }) => {
    await userEvent.click(canvas.getByRole("button", { name: "New Release" }));
    const body = within(canvasElement.ownerDocument.body);
    const title = await body.findByRole("textbox", { name: "Title *" });
    await userEvent.type(title, "Draft release");
    await userEvent.click(body.getByRole("button", { name: "Create Release" }));
    await expect(await body.findByRole("alert")).toHaveTextContent("Your draft is still here.");
    await expect(title).toHaveValue("Draft release");
    await expect(body.getByRole("button", { name: "Create Release" })).toBeEnabled();
  },
};


export const TrackCorrections: Story = {
  render: () => <TrackEditorWorkspace
    release={{ id: "story-release", title: "Low Tide" }}
    tracks={[{ id: "story-track", release_id: "story-release", title: "Low Tide", work_id: "story-work", track_ready: false, track_missing: "Audio file, Publishing clearance 25%" }]}
    works={[{ id: "story-work", title: "Low Tide", isrc: null }]}
  />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText("Audio files up to 100 MB.")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Edit work and rights" })).toHaveAttribute("href", "/works/story-work?release=story-release&track=story-track");
  },
};

export const RightsCorrectionReturn: Story = {
  render: () => <WorkClearanceWorkspace
    work={{ id: "story-work", title: "Low Tide" }}
    roles={[{ id: "story-role", role: "Writer", ownership_type: "Rights", scope: "Publishing", percent_share: 100, clearance_status: "Pending" }]}
    contacts={[]}
    tracks={[{ id: "story-track", release_id: "story-release", title: "Low Tide" }]}
    initialSearch="?release=story-release&track=story-track&returnTo=today"
  />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Back to track" })).toHaveAttribute("href", "/releases/story-release/tracks?track=story-track&focus=work&returnTo=today");
    await expect(canvas.getByRole("combobox", { name: "Clearance status" })).toHaveValue("Pending");
  },
};
