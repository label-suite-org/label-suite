import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within, waitFor } from "storybook/test";
import { Button } from "./button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "./dialog";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  SheetClose,
} from "./sheet";

const meta = {
  title: "Library/Layers",
  component: Dialog,
  parameters: {
    docs: {
      description: {
        component:
          "Dialog for a focused confirmation. Sheet for contextual information and mobile navigation. Both keep keyboard focus inside while open and return it to the trigger when closed.",
      },
    },
  },
} satisfies Meta<typeof Dialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Confirmation: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>
        Review removal
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this image?</DialogTitle>
          <DialogDescription>
            This example is fictional. In the workspace, confirm which image
            will be removed before continuing.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Keep image
          </DialogClose>
          <DialogClose render={<Button variant="destructive" />}>
            Remove image
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement, canvas }) => {
    const trigger = canvas.getByRole("button", { name: "Review removal" });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(
        body.getByRole("dialog", { name: "Remove this image?" }),
      ).toBeVisible(),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
export const ContextPanel: Story = {
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>
        Open release details
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Low Tide</SheetTitle>
          <SheetDescription>
            June Vale · EP · fictional catalog
          </SheetDescription>
        </SheetHeader>
        <dl className="space-y-5 px-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Delivery</dt>
            <dd className="mt-1">Final master needed</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Rights</dt>
            <dd className="mt-1">Two collaborators, shares confirmed</dd>
          </div>
        </dl>
        <SheetFooter>
          <SheetClose render={<Button variant="outline" />}>
            Close details
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvasElement, canvas }) => {
    const trigger = canvas.getByRole("button", {
      name: "Open release details",
    });
    await userEvent.click(trigger);
    const body = within(canvasElement.ownerDocument.body);
    await waitFor(() =>
      expect(body.getByRole("dialog", { name: "Low Tide" })).toBeVisible(),
    );
    await userEvent.click(body.getByRole("button", { name: "Close details" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};
