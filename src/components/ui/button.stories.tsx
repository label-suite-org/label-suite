import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import { Spinner } from "./spinner";

const meta = {
  title: "Library/Actions",
  component: Button,
  parameters: {
    docs: {
      description: {
        component:
          "One principal action per working area. Supporting actions use outline; row controls use ghost. Use the installed variants, without page-owned colors, corners or heights.",
      },
    },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Hierarchy: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button>Save changes</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="ghost">View history</Button>
      <Button variant="destructive">Remove image</Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Button disabled aria-busy="true">
        <Spinner aria-hidden="true" />
        Saving changes…
      </Button>
      <Button disabled>Save changes</Button>
      <Button variant="outline" disabled>
        Upload image
      </Button>
    </div>
  ),
};
