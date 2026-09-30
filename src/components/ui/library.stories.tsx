import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent } from "storybook/test";
import { AlertTriangle, Music2 } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./accordion";
import {
  Item,
  ItemContent,
  ItemTitle,
  ItemDescription,
  ItemMedia,
  ItemActions,
} from "./item";
import {
  Table,
  TableCaption,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "./table";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
} from "./empty";
import { Alert, AlertTitle, AlertDescription } from "./alert";
import { Skeleton } from "./skeleton";

const meta = {
  title: "Library/Patterns",
  parameters: {
    docs: {
      description: {
        component:
          "Existing shared primitives assembled into quiet, unboxed working areas. Fictional data. Details stay available through deliberate selection; empty, loading and failed requests remain distinct.",
      },
    },
  },
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-3xl space-y-8 py-4">
        <Story />
      </main>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Foundations: Story = {
  render: () => (
    <>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Label Suite</h1>
        <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
          A light workspace for your artists, releases and the work around them.
          Artwork carries identity; controls and information share one visual
          language.
        </p>
      </header>
      <section className="space-y-4">
        <h2 className="text-base font-semibold">Typography & spacing</h2>
        <div className="space-y-2">
          <p className="text-2xl font-semibold tracking-tight">June Vale</p>
          <p className="text-base font-semibold">Upcoming releases</p>
          <p className="text-sm">Low Tide · EP</p>
          <p className="text-xs text-muted-foreground">
            Updated today · supporting metadata
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Tight related groups. More space between tasks. Geist throughout.
        </p>
      </section>
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-base font-semibold">Surfaces & state</h2>
        <div className="flex flex-wrap gap-3">
          <Badge variant="secondary">Draft</Badge>
          <Badge variant="success">Approved</Badge>
          <Badge variant="warning">Needs review</Badge>
          <Badge variant="destructive">Rejected</Badge>
          <Badge variant="outline">Not connected</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Status always has a name. Color reinforces its meaning.
        </p>
      </section>
      <section className="space-y-4 border-t pt-6">
        <h2 className="text-base font-semibold">Action hierarchy</h2>
        <div className="flex flex-wrap gap-3">
          <Button>Save changes</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">View history</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          The primary action is clear. Additional controls remain quiet.
        </p>
      </section>
    </>
  ),
};

export const ReleaseRows: Story = {
  render: function Rows() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <>
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">June Vale</h1>
          <p className="text-sm text-muted-foreground">
            Upcoming releases · fictional catalog
          </p>
        </div>
        <div role="list">
          {[
            { title: "Low Tide", type: "EP", status: "Needs review" },
            { title: "A Long Way Home", type: "Single", status: "Approved" },
          ].map((release) => (
            <Item
              key={release.title}
              role="listitem"
              className="rounded-none border-b-border px-0 py-4 last:border-b-transparent"
            >
              <ItemMedia
                className="grid size-14 place-items-center rounded-md bg-muted text-sm text-muted-foreground"
                aria-label="Artwork unavailable"
              >
                {release.title
                  .split(" ")
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join("")}
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{release.title}</ItemTitle>
                <ItemDescription>{release.type} · June Vale</ItemDescription>
              </ItemContent>
              <ItemActions className="flex-wrap">
                <Badge
                  variant={
                    release.status === "Approved" ? "success" : "warning"
                  }
                >
                  {release.status}
                </Badge>
                <Button
                  variant="ghost"
                  onClick={() => setSelected(release.title)}
                  aria-label={`View ${release.title}`}
                >
                  View
                </Button>
              </ItemActions>
            </Item>
          ))}
        </div>
        {selected && (
          <section
            aria-label="Selected release"
            className="space-y-2 border-t pt-6"
          >
            <h2 className="text-base font-semibold">{selected}</h2>
            <p className="text-sm text-muted-foreground">
              Selected record details stay here. This example does not load a
              catalog database.
            </p>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close details
            </Button>
          </section>
        )}
      </>
    );
  },
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "View Low Tide" }),
    );
    await expect(
      canvas.getByRole("region", { name: "Selected release" }),
    ).toHaveTextContent("Low Tide");
    await userEvent.click(
      canvas.getByRole("button", { name: "Close details" }),
    );
  },
};

export const ViewsAndDetails: Story = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabsList
        variant="line"
        aria-label="Artist views"
        className="max-w-full overflow-x-auto"
      >
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="rights">Rights</TabsTrigger>
        <TabsTrigger value="images">Images</TabsTrigger>
      </TabsList>
      <TabsContent value="overview" className="pt-6">
        <h1 className="text-xl font-semibold tracking-tight">June Vale</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Low Tide is waiting for a final master.
        </p>
        <Accordion className="mt-6">
          <AccordionItem value="evidence">
            <AccordionTrigger>Profile details & checks</AccordionTrigger>
            <AccordionContent>
              Biography and contact details are complete. Review the final
              master in the release workspace.
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </TabsContent>
      <TabsContent value="rights" className="pt-6">
        <Table>
          <TableCaption>Illustrative shares for Low Tide.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Collaborator</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>June Vale</TableCell>
              <TableCell>Writer</TableCell>
              <TableCell className="text-right tabular-nums">60%</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>Robin Lee</TableCell>
              <TableCell>Writer</TableCell>
              <TableCell className="text-right tabular-nums">40%</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TabsContent>
      <TabsContent value="images" className="pt-6">
        <p className="text-sm text-muted-foreground">
          Artist images belong in their own view, after the core collaboration
          work.
        </p>
      </TabsContent>
    </Tabs>
  ),
  play: async ({ canvas }) => {
    await userEvent.click(
      canvas.getByRole("button", { name: "Profile details & checks" }),
    );
    await expect(
      canvas.getByText(/Biography and contact details are complete/),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Rights" }));
    await expect(canvas.getByRole("table")).toHaveTextContent("60%");
  },
};

export const EmptyState: Story = {
  render: function EmptyExample() {
    const [started, setStarted] = useState(false);
    return started ? (
      <p role="status" className="text-sm">
        Release creation selected. The integrated workspace opens its release
        form here.
      </p>
    ) : (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Music2 aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No releases yet</EmptyTitle>
          <EmptyDescription>
            Add your first release to organize its tracks, collaborators and
            delivery.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => setStarted(true)}>Create release</Button>
        </EmptyContent>
      </Empty>
    );
  },
};
export const Loading: Story = {
  render: () => (
    <div role="status" aria-label="Loading releases" className="space-y-6">
      <p className="text-sm text-muted-foreground">Loading releases…</p>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex items-center gap-3" aria-hidden="true">
          <Skeleton className="size-14 shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  ),
};
export const FailedRequest: Story = {
  render: function Failure() {
    const [retried, setRetried] = useState(false);
    return retried ? (
      <p role="status" className="text-sm">
        Retry selected. The real request is handled by the integrated workspace.
      </p>
    ) : (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>Could not load releases</AlertTitle>
          <AlertDescription>
            Your catalog has not changed. Try loading it again.
          </AlertDescription>
        </Alert>
        <Button variant="outline" onClick={() => setRetried(true)}>
          Try again
        </Button>
      </div>
    );
  },
};
