import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ArtistHeader, ArtistReleaseSection, ArtistSectionNavigation } from "./artists/ArtistWorkspace";
import { ReleaseHeader, ReleaseSectionNavigation, ReleaseTracklist } from "./releases/ReleaseWorkspace";
import { Tabs, TabsContent } from "./ui/tabs";

const artist = { id: "preview-artist", name: "Artist name" };
const release = { id: "preview-release", title: "Release title", artist_name: artist.name, format: "EP", status: "draft", release_ready: false };
const releases = [release, { ...release, id: "preview-ready", title: "Ready release", release_ready: true }];
const tracks = [
  { id: "preview-track-1", release_id: release.id, title: "Track title", position: 1, track_ready: true },
  { id: "preview-track-2", release_id: release.id, title: "Track awaiting clearance", position: 2, track_ready: false },
];

const meta = {
  title: "Existing website/Design language",
  parameters: {
    docs: { description: { component: "A component reference extracted from the current artist and release pages. Every example renders the same component used by its page. Neutral labels keep private records out of the public repository. Forms are disconnected; links show their real routing shape but do not navigate from this reference." } },
  },
  beforeEach: () => {
    const originalFetch = window.fetch;
    window.fetch = async () => Response.json({ error: "Saving is disconnected in the design reference." }, { status: 403 });
    return () => { window.fetch = originalFetch; };
  },
  decorators: [(Story) => <main className="min-w-0 space-y-10 text-foreground" onClickCapture={event => {
    if (event.target instanceof Element && event.target.closest("a")) event.preventDefault();
  }}><Story /></main>],
} satisfies Meta;
export default meta;
type Story = StoryObj<{ onShowAll?: () => void }>;

export const Reference: Story = {
  render: () => <>
    <header className="max-w-prose space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Artist & release language</h1>
      <p className="text-sm text-muted-foreground">Existing website components: artwork, identity, actions, section navigation and quiet working rows. The shared stylesheet supplies type, colour, corners and focus.</p>
    </header>
    <section aria-label="Artist identity" className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Artist identity</h2>
      <ArtistHeader artist={artist} heroImageLink={null} relationshipDetail="Signed to the label" releaseCount={2} profileComplete={50} canMutate onManageImages={() => {}} />
    </section>
    <section aria-label="Release identity" className="space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">Release identity</h2>
      <ReleaseHeader release={release} canManage onOpenCover={() => {}} />
    </section>
    <section aria-label="Artist release rows"><ArtistReleaseSection releases={releases} /></section>
    <section aria-label="Release track rows"><ReleaseTracklist releaseId={release.id} tracks={tracks} /></section>
    <p className="max-w-prose text-sm text-muted-foreground">Identity: 24/30px. Record section headings: 18px. Controls and body: 14px. Metadata: 12px. Header actions use a 12px gap and wrap. Preserve the artist’s line tabs and the release’s URL links with More; they have different navigation behaviour.</p>
  </>,
};

export const ArtistNavigation: Story = {
  render: function Navigation() {
    const [value, setValue] = useState("overview");
    return <Tabs value={value} onValueChange={value => setValue(String(value))} className="min-w-0 gap-5">
      <ArtistSectionNavigation />
      <TabsContent value={value}><p>Selected artist section: {value}</p></TabsContent>
    </Tabs>;
  },
  play: async ({ canvas }) => {
    const overview = canvas.getByRole("tab", { name: "Overview" });
    await userEvent.click(overview);
    await userEvent.keyboard("{ArrowRight}{Enter}");
    await expect(canvas.getByRole("tab", { name: "Releases" })).toHaveAttribute("aria-selected", "true");
    await expect(canvas.getByRole("tabpanel")).toHaveTextContent("Selected artist section: releases");
  },
};

export const ReleaseNavigation: Story = {
  render: function Navigation() {
    const [value, setValue] = useState<"overview" | "tracks" | "timeline" | "campaigns" | "budget" | "assets" | "analytics" | "details">("overview");
    return <div className="min-w-0 space-y-5">
      <ReleaseSectionNavigation releaseId={release.id} routeSearch="returnTo=today&focus=upc" activeSection={value} onSelect={setValue} />
      <p>Selected release section: {value}</p>
    </div>;
  },
  play: async ({ canvas, canvasElement }) => {
    const tracks = canvas.getByRole("link", { name: "Tracks & rights" });
    await expect(tracks).toHaveAttribute("href", "/releases/preview-release?returnTo=today&section=tracks#release-tracks");
    await userEvent.click(tracks);
    await expect(tracks).toHaveAttribute("aria-current", "page");
    await userEvent.click(canvas.getByRole("button", { name: "More release sections" }));
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole("menuitem", { name: "Details" }));
    await expect(canvas.getByText("Selected release section: details")).toBeVisible();
  },
};

export const EmptyLists: Story = {
  render: () => <>
    <ArtistReleaseSection releases={[]} />
    <ReleaseTracklist releaseId={release.id} tracks={[]} />
  </>,
};

export const LongNames: Story = {
  render: () => <>
    <ArtistHeader artist={{ ...artist, name: "An artist with a long name that must remain readable on a phone" }} heroImageLink={null} relationshipDetail="Signed to the label" releaseCount={2} profileComplete={50} canMutate onManageImages={() => {}} />
    <ReleaseHeader release={{ ...release, title: "A long release title with an extended edition description", artist_name: "An artist with a long name" }} canManage onOpenCover={() => {}} />
    <ArtistReleaseSection releases={[{ ...release, title: "An extended release title with additional edition information" }]} />
    <ReleaseTracklist releaseId={release.id} tracks={[{ ...tracks[0], title: "A long track title including a remix artist and an extended version description" }]} />
  </>,
};

export const ArtistReleaseSelection: Story = {
  args: { onShowAll: fn() },
  render: args => <ArtistReleaseSection releases={Array.from({ length: 5 }, (_, index) => ({ ...release, id: `preview-${index}`, title: `Release ${index + 1}` }))} onShowAll={args.onShowAll} />,
  play: async ({ canvas, args }) => {
    await expect(canvas.getAllByRole("link")).toHaveLength(4);
    await userEvent.click(canvas.getByRole("button", { name: "View all 5 releases" }));
    await expect(args.onShowAll).toHaveBeenCalledOnce();
  },
};
