import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./select";
import { expect, userEvent, within } from "storybook/test";

const meta = {
  title: "Forms/Select",
  component: Select,
  args: { value: "press_photo", options: [{ value: "press_photo", label: "Press photo" }, { value: "cover_art", label: "Cover art" }], "aria-label": "Asset type", onValueChange: () => {} },
  render: function Selection(args) {
    const [value, setValue] = useState(args.value);
    return <Select {...args} value={value} onValueChange={value => setValue(value ?? "")} />;
  },
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;
export const AssetType: Story = {
  play: async ({ canvasElement, canvas }) => {
    const select = canvas.getByRole("combobox", { name: "Asset type" });
    await userEvent.click(select);
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Cover art" }));
    await expect(select).toHaveTextContent("Cover art");
  },
};
export const Disabled: Story = { args: { disabled: true } };
